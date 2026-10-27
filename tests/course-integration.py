"""Local HTTP acceptance tests. Temporary rows are removed in finally.

Run with --admin after enabling ADMIN_USER_IDS=local_seedy in .dev.vars.
No model key or external service is used. Back up the local SQLite first.
"""
import argparse, copy, hashlib, json, sqlite3, subprocess, time, urllib.error, urllib.request, uuid
from pathlib import Path

args=argparse.ArgumentParser();args.add_argument('--admin',action='store_true');args=args.parse_args()
BASE='http://127.0.0.1:5173'
root=Path(__file__).resolve().parents[1]
databases=[p for p in (root/'.wrangler/state/v3/d1').rglob('*.sqlite') if p.name!='metadata.sqlite']
assert len(databases)==1,'Use one local development DB.'
database=databases[0]
backup=root/'outputs'/f'before-course-tests-{time.time_ns()}.sqlite'
backup.parent.mkdir(exist_ok=True)
with sqlite3.connect(database) as con,sqlite3.connect(backup) as saved:con.backup(saved)
with sqlite3.connect(database) as con:previous_limits=list(con.execute("SELECT key,count,expires_at FROM limits WHERE key LIKE 'local_seedy:%'"))
checks=[];pids=[];review_ids=[];fids=[];other='test-owner-'+uuid.uuid4().hex
suffix=uuid.uuid4().hex[:8]

def call(method,path,body=None,auth=False,headers=None,raw=False):
    h={**(headers or {})}
    if auth:h['Cookie']='__sites_local_auth=1'
    if body is not None and not isinstance(body,bytes):
        body=json.dumps(body,ensure_ascii=False).encode();h['Content-Type']='application/json'
    req=urllib.request.Request(BASE+'/api/'+path,data=body,headers=h,method=method)
    try:
        r=urllib.request.urlopen(req);data=r.read();return r.status,data if raw else json.loads(data),r.headers
    except urllib.error.HTTPError as e:
        data=e.read()
        try: data=json.loads(data)
        except (json.JSONDecodeError,UnicodeDecodeError):data={'error':data.decode(errors='replace')}
        return e.code,data,e.headers
def check(name,condition):
    assert condition,name
    checks.append(name)
def create(payload):
    code,value,_=call('POST','courses',payload,True)
    assert code==201,(code,value)
    pids.append(value['id']);return value
def decision(review_id):
    return call('POST',f'admin/reviews/{review_id}/decision',{'decision':'pass','reason':'本地自动化验收的临时课程，仅用于核对发布与版本隔离。'},True)
def submit(pid):
    result=call('POST',f'courses/{pid}/submit',{},True)
    if result[0]==200:review_ids.append(result[1]['reviewId'])
    return result

course={'title':'验收课程 '+suffix,'summary':'验证所有作者都可以投稿、关联项目和维护课程版本。','category':'嵌入式系统','version':'v1','stage':'连载中',
    'description':'这是一套仅供本地自动化验收的临时课程，不作为真实教学内容展示。','prerequisites':'能够读懂最基本的 C 函数和数组。','outcomes':'理解课程的草稿、送审与公开版本之间的区别。',
    'instructions':'先准备电脑与文本编辑器，阅读第一章，再对照配套说明运行示例，最后核对输出与学习目标。','license':'MIT',
    'projectId':'a1000000-0000-4000-8000-000000000002','projectRevisionId':None,
    'modules':[{'title':'第一个模块','description':'从原理到实验。','lessons':[{'id':'first','title':'第一章','summary':'能够独立阅读的章节。','practice':'computer',
        'body':'<script>window.__course_xss=1</script>\n这段文本只应作为课程正文显示，不能当作 HTML 执行。请阅读并核对章节中的字面代码。','links':[]}]}]}
try:
    check('anonymous course creation blocked',call('POST','courses',course)[0]==401)
    check('cross-origin course creation blocked',call('POST','courses',course,True,{'Origin':'https://evil.example.com'})[0]==403)
    check('imported course catalog is public',any(c['title'].endswith('SmartWatch 的嵌入式实践') for c in call('GET','courses')[1]['items']))
    check('maintenance role is explicit',call('GET','admin/budget',auth=True)[0]==(200 if args.admin else 403))
    created=create(course);pid=created['id']
    check('draft course hidden from anonymous',call('GET',f'courses/{pid}')[0]==404)
    detail=call('GET',f'courses/{pid}',auth=True)[1]
    check('project relationship pins published revision',detail['course']['projectRevisionId']=='b2000000-0000-4000-8000-000000000002')
    check('course cannot be read from project endpoint',call('GET',f'projects/{pid}',auth=True)[0]==404)
    check('ordinary author can save course',any(c['id']==pid for c in call('GET','me/courses',auth=True)[1]['items']))
    job=submit(pid);check('complete course enters review queue',job[0]==200 and job[1]['status']=='queued')
    check('review snapshot hidden from anonymous',call('GET',f'reviews/{job[1]["reviewId"]}')[0]==404)
    check('author can read exact submitted snapshot',call('GET',f'reviews/{job[1]["reviewId"]}',auth=True)[1]['snapshot']['modules'][0]['lessons'][0]['body']==course['modules'][0]['lessons'][0]['body'])
    check('duplicate submit rejected',submit(pid)[0]==409)
    course['version']='v2'
    newer=call('PATCH',f'courses/{pid}',course,True)
    check('course update appends immutable revision',newer[0]==201 and newer[1]['revisionId']!=created['revisionId'])
    history=call('GET',f'courses/{pid}',auth=True)[1]['history']
    check('course history retained',len(history)==2)
    with sqlite3.connect(database) as con:
        con.execute('INSERT INTO users(id,name,created_at) VALUES(?,?,?)',(other,'测试隔离用户',int(time.time()*1000)))
        foreign=str(uuid.uuid4());pids.append(foreign)
        con.execute('INSERT INTO projects(id,owner_id,kind,created_at,updated_at) VALUES(?,?,?,?,?)',(foreign,other,'course',1,1))
    check('cannot edit another author course',call('PATCH',f'courses/{foreign}',course,True)[0]==403)
    if args.admin:
        check('AI disabled by default without a charge',call('POST',f'admin/reviews/{job[1]["reviewId"]}/run',{},True)[0]==503)
        check('old revision review can finish',decision(job[1]['reviewId'])[0]==200)
        check('old approval cannot publish newer draft',call('GET',f'courses/{pid}')[0]==404)
        second=submit(pid);check('new revision queues independently',second[0]==200)
        check('current approval publishes course',decision(second[1]['reviewId'])[0]==200 and call('GET',f'courses/{pid}')[0]==200)
        public=call('GET',f'courses/{pid}')[1]
        check('untrusted HTML has no executable snapshot mapping',public['trusted'] is None)
        check('course appears on associated project',any(c['id']==pid for c in call('GET',f'projects/{course["projectId"]}')[1]['courses']))
        check('courses excluded from featured projects',call('POST','admin/featured',{'projectId':pid,'criteria':['teaching'],'evidence':'用于自动化验收推荐入口的内容，课程应当与完整项目保持独立。'},True)[0]==422)
        course['version']='v3';third=call('PATCH',f'courses/{pid}',course,True)
        check('new draft preserves old public course',call('GET',f'courses/{pid}')[1]['course']['version']=='v2')
        check('unpublished revision query denied',call('GET',f'courses/{pid}?revision={third[1]["revisionId"]}')[0]==404)
        check('historical public version available',call('GET',f'courses/{pid}?revision={created["revisionId"]}')[0]==200)
        boundary='test-'+suffix
        content=b'example source code\n'
        multipart=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="example.txt"\r\nContent-Type: text/plain\r\n\r\n'.encode()+content+f'\r\n--{boundary}--\r\n'.encode())
        code,file,_=call('POST','files',multipart,True,{'Content-Type':f'multipart/form-data; boundary={boundary}'})
        check('course file upload persists',code==201 and file['digest']==hashlib.sha256(content).hexdigest());fids.append(file['id'])
        check('private attachment hidden',call('GET',f'files/{file["id"]}')[0]==404)
        code,data,headers=call('GET',f'files/{file["id"]}',auth=True,raw=True)
        check('download forced as non-executable attachment',code==200 and data==content and headers.get('Content-Type')=='application/octet-stream' and 'attachment' in headers.get('Content-Disposition',''))
        course['fileIds']=[file['id']];course['version']='v4';call('PATCH',f'courses/{pid}',course,True);fourth=submit(pid);decision(fourth[1]['reviewId'])
        check('published course grants attachment download',call('GET',f'files/{file["id"]}',raw=True)[0]==200)
        withdrawn=call('POST',f'admin/reviews/{fourth[1]["reviewId"]}/decision',{'decision':'revise','reason':'临时验收：该课程需要补充说明，验证撤回后的公开范围。'},True)
        check('withdrawn course removed from public catalog',withdrawn[0]==200 and not any(c['id']==pid for c in call('GET','courses')[1]['items']))
        check('withdrawn course attachment no longer public',call('GET',f'files/{file["id"]}')[0]==404)
    large=copy.deepcopy(course);large['version']='large';large['fileIds']=[]
    large['modules'][0]['lessons'][0]['body']='长篇课程正文。'*2700
    second_lesson=copy.deepcopy(large['modules'][0]['lessons'][0]);second_lesson['id']='second';large['modules'][0]['lessons'].append(second_lesson)
    long=create(large);large_job=submit(long['id'])
    check('long course not silently truncated or auto published',large_job[0]==200 and large_job[1]['status']=='disputed' and call('GET',f'courses/{long["id"]}')[0]==404)
    with sqlite3.connect(database) as con:
        calls=con.execute('SELECT COUNT(*) FROM ai_calls WHERE review_id IN (SELECT id FROM reviews WHERE entity_id IN (SELECT id FROM revisions WHERE project_id IN (%s)))'%','.join('?' for _ in pids),pids).fetchone()[0]
        check('all verification made zero model calls',calls==0)
    print(json.dumps({'passed':len(checks),'checks':checks,'backup':str(backup)},ensure_ascii=False,indent=2))
finally:
    # Delete only exact IDs created by this run. Preserve source project and course.
    with sqlite3.connect(database) as con:
        for pid in pids:
            rows=[r[0] for r in con.execute('SELECT id FROM reviews WHERE entity_id IN (SELECT id FROM revisions WHERE project_id=?)',(pid,))]
            for rid in rows:
                con.execute('DELETE FROM decisions WHERE review_id=?',(rid,));con.execute('DELETE FROM ai_calls WHERE review_id=?',(rid,));con.execute('DELETE FROM reviews WHERE id=?',(rid,))
            con.execute('DELETE FROM reports WHERE entity_id IN (SELECT id FROM revisions WHERE project_id=?)',(pid,))
            con.execute('DELETE FROM selections WHERE project_id=?',(pid,))
            con.execute('DELETE FROM content_facets WHERE project_id=?',(pid,))
            con.execute('DELETE FROM revision_taxonomy WHERE revision_id IN (SELECT id FROM revisions WHERE project_id=?)',(pid,))
            con.execute('DELETE FROM revisions WHERE project_id=?',(pid,));con.execute('DELETE FROM projects WHERE id=?',(pid,))
        for fid in fids:con.execute('DELETE FROM files WHERE id=?',(fid,))
        con.execute('DELETE FROM users WHERE id=?',(other,))
        # This suite uses the one loopback mock identity in an isolated preview.
        con.execute("DELETE FROM limits WHERE key LIKE 'local_seedy:%'")
        con.executemany('INSERT INTO limits(key,count,expires_at) VALUES(?,?,?)',previous_limits)
    for fid in fids:
        result=subprocess.run(['node','--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','r2','object','delete',f'site-creator-r2/{fid}','--local','--persist-to','.wrangler/state','--config','dist/server/wrangler.json'],cwd=root,capture_output=True,text=True)
        if result.returncode:print('Temporary object cleanup failed for '+fid)
