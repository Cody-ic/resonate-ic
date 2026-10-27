"""Optional production-preview reproduction. Prepare with scripts/prepare-review-acceptance.py and run scripts/serve-review-acceptance.mjs first.
Run scripts/serve-review-acceptance.mjs after preparation. It disables file watching and uses an isolated production Worker runtime."""
import copy,http.cookiejar,json,secrets,sqlite3,subprocess,time,urllib.error,urllib.request,uuid,shutil,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];DB=next(p for p in (ROOT/'.wrangler/state/v3/d1').rglob('*.sqlite') if p.name!='metadata.sqlite')
ROOT_DB=DB
base='http://127.0.0.1:5173';jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(jar));suffix=uuid.uuid4().hex[:10];uid=None;process=None;pids=[];tids=[];checks=[]
test_vars=None
email=f'moderation-{suffix}@example.com';pwd=secrets.token_urlsafe(24)
cookies={}
def call(method,path,body=None,extra=None):
 from http.client import HTTPConnection
 from http.cookies import SimpleCookie
 conn=HTTPConnection('127.0.0.1',int(base.rsplit(':',1)[1]),timeout=15)
 headers={'Content-Type':'application/json','Origin':base,'Connection':'close','Cookie':'; '.join(k+'='+v for k,v in cookies.items())}
 headers.update(extra or {})
 conn.request(method,'/api/'+path,body=None if body is None else json.dumps(body,ensure_ascii=False).encode(),headers=headers)
 response=conn.getresponse();raw=response.read()
 for name,value in response.getheaders():
  if name.lower()=='set-cookie':
   parsed=SimpleCookie();parsed.load(value)
   for k,v in parsed.items():cookies[k]=v.value
 status=response.status;conn.close()
 try:value=json.loads(raw)
 except:value={'error':raw.decode(errors='replace')[:1200]}
 return status,value
def ok(method,path,body=None):
 code,value=call(method,path,body);assert code in [200,201],(method,path,code,value);return value
def check(name,condition):assert condition,name;checks.append(name)
def approve(job,plan=None):return ok('POST','admin/reviews/'+job+'/decision',{'decision':'pass','reason':'临时自动化验收，用于核对分类审核和版本发布，完成后清理测试数据。',**({'taxonomy':plan} if plan else {})})
def submit(pid):return ok('POST','projects/'+pid+'/submit',{})['reviewId']
try:
 metadata=json.loads((ROOT/'outputs/review-test-context.json').read_text())
 uid=metadata['uid'];cookies.update(metadata['cookies']);runtime=Path(metadata['runtime']);DB=Path(metadata['database']);email=metadata['email'];suffix=metadata['suffix'];base='http://127.0.0.1:5174';test_vars=runtime/'dist/server/.dev.vars'
 check('disposable admin role only in acceptance worker',ok('GET','me')['user']['admin'])
 saved_cookies=dict(cookies);cookies.clear()
 forged=call('GET','me',extra={'oai-authenticated-user-id':uid,'oai-authenticated-user-email':'forged@example.com'})
 check('production ignores untrusted platform identity headers',forged[1]['user'] is None)
 check('production header forgery cannot create content',call('POST','topics',{'title':'伪造身份','body':'应当被拒绝的冒充内容','board':'经验交流'},extra={'oai-authenticated-user-id':uid,'oai-authenticated-user-email':'forged@example.com'})[0]==401)
 cookies.update(saved_cookies)
 ok('GET','taxonomy')
 data={'title':'分类验收 '+suffix,'summary':'验证多维筛选、自定义标签和新来源审核。','category':'嵌入式系统','hardware':'ST 与 FPGA 平台组成的临时验收系统。','version':'v1','stage':'进行中','description':'临时接口验收内容，检查新标签在审核前不可进入词表、通过后能够参与筛选。','license':'MIT','links':[{'type':'repository','label':'代码仓库','url':'https://example.com/source'}],'sources':[{'name':'电赛','division':'控制类','year':2025},{'name':'电赛','division':'电源类','year':2026},{'name':'其他','proposedName':'临时新来源'+suffix,'proposedDivision':'新赛道','year':2026}],'platforms':[{'name':'ST','family':'mcu'},{'name':'验收平台'+suffix,'family':'other'}],'tags':['验收甲'+suffix,'验收乙'+suffix]}
 p=ok('POST','projects',data);pid=p['id'];pids.append(pid);job=submit(pid)
 check('pending tags remain out of public vocabulary',data['tags'][0] not in ok('GET','taxonomy')['tags'])
 approve(job);published=ok('GET','projects/'+pid)['project'];check('new tags are allowed by default',published['tags']==data['tags'])
 check('other source stays Other unless explicitly promoted',published['sources'][2]['name']=='其他' and not published['sources'][2]['proposedName'])
 check('approved tags enter vocabulary',all(t in ok('GET','taxonomy')['tags'] for t in data['tags']))
 from urllib.parse import urlencode
 def query(**kwargs):return ok('GET','projects?'+urlencode(kwargs,doseq=True))
 check('multiple tags use intersection',query(tag=data['tags'])['total']==1)
 check('nonmatching extra tag yields zero',query(tag=data['tags']+['不存在'+suffix])['total']==0)
 check('source division and year must match one entry',query(source='电赛',division='控制类',year=2026,tag=data['tags'][0])['total']==0)
 check('matching source entry selectable',query(source='电赛',division='电源类',year=2026,tag=data['tags'][0])['total']==1)
 check('unavailable division is greyed for the selected year',not query(source='电赛',year=2026,tag=data['tags'][0])['availability']['division'].get('控制类'))
 available=query(tag=data['tags'][0])['availability'];check('availability supports disabled UI',available['tag'][data['tags'][1]]==1 and 'FPGA' not in available['category'])
 original=ok('GET','projects/'+pid)['project']['revisionId']
 data['version']='v2';v2=ok('PATCH','projects/'+pid,data);job2=submit(pid)
 data['version']='v3';v3=ok('PATCH','projects/'+pid,data);job3=submit(pid)
 approve(job2);check('older approval cannot replace newer head',query(tag=data['tags'])['items'][0]['revisionId']==original)
 plan={'sources':[{'index':2,'name':'临时新来源'+suffix,'division':'新赛道','createSource':True,'createDivision':True}]}
 approve(job3,plan);check('approved new source and division become searchable',query(source='临时新来源'+suffix,division='新赛道',tag=data['tags'])['total']==1)
 terms=ok('GET','taxonomy');check('approved source enters shared vocabulary',any(s['name']=='临时新来源'+suffix and '新赛道' in s['divisions'] for s in terms['sources']))
 data['version']='v4';ok('PATCH','projects/'+pid,data);job4=submit(pid)
 invalid={'tags':[{'label':data['tags'][0],'action':'reject','reason':'这是新标签，我没有听说过'}]}
 check('unfamiliar label cannot be rejected without a real rule',call('POST','admin/reviews/'+job4+'/decision',{'decision':'pass','reason':'测试不合理标签拒绝，必须被校验拦截。','taxonomy':invalid})[0]==422)
 check('failed manual validation restores queue claim',ok('GET','reviews/'+job4)['state']=='queued')
 ok('DELETE','projects/'+pid);approve(job4);check('approval cannot restore deleted content',query(tag=data['tags'])['total']==0)
 ok('POST','projects/'+pid+'/restore',{});check('restore keeps last published version',query(tag=data['tags'])['items'][0]['revisionId']==v3['revisionId'])
 # Latest edit publication must not be overwritten by an older queued edit.
 t=ok('POST','topics',{'title':'编辑审核验收','body':'原来的公开技术正文，等待修改。','board':'经验交流'});tid=t['id'];tids.append(tid)
 edit=ok('GET','topics/'+tid+'/edit');queued=ok('PATCH','topics/'+tid,{'body':'新用户引用外链 https://example.com/queued','editToken':edit['editToken']})
 with sqlite3.connect(DB) as con:oldjob=con.execute('SELECT id FROM reviews WHERE entity_id=?',(queued['editId'],)).fetchone()[0]
 edit=ok('GET','topics/'+tid+'/edit');ok('PATCH','topics/'+tid,{'body':'后来通过规则检查的最新正文，不能被老审核覆盖。','editToken':edit['editToken']});approve(oldjob)
 check('old forum edit approval cannot overwrite latest edit',ok('GET','topics/'+tid)['topic']['body'].startswith('后来'))
 with sqlite3.connect(DB) as con:check('verification makes zero AI calls',con.execute('SELECT COUNT(*) FROM ai_calls WHERE review_id IN (SELECT id FROM reviews WHERE owner_id=?)',(uid,)).fetchone()[0]==0)
 print(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False,indent=2))
finally:
 if process is not None:
  subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  process.wait(timeout=10);log.close()
 if test_vars is not None:test_vars.unlink(missing_ok=True)
 with sqlite3.connect(DB) as con:
  if uid:
   for jid, in con.execute('SELECT id FROM reviews WHERE owner_id=?',(uid,)).fetchall():
    con.execute('DELETE FROM taxonomy_terms WHERE review_id=?',(jid,));con.execute('DELETE FROM decisions WHERE review_id=?',(jid,));con.execute('DELETE FROM ai_calls WHERE review_id=?',(jid,))
   con.execute('DELETE FROM reviews WHERE owner_id=?',(uid,));con.execute('DELETE FROM forum_edits WHERE owner_id=?',(uid,));con.execute('DELETE FROM topics WHERE owner_id=?',(uid,))
   for pid in pids:
    con.execute('DELETE FROM content_facets WHERE project_id=?',(pid,));con.execute('DELETE FROM revision_taxonomy WHERE revision_id IN (SELECT id FROM revisions WHERE project_id=?)',(pid,));con.execute('DELETE FROM revisions WHERE project_id=?',(pid,));con.execute('DELETE FROM projects WHERE id=?',(pid,))
   con.execute('DELETE FROM limits WHERE key LIKE ?',(uid+':%',));con.execute('DELETE FROM users WHERE id=?',(uid,))
  for aid, in con.execute('SELECT id FROM auth_user WHERE email=?',(email,)).fetchall():
   con.execute('DELETE FROM auth_session WHERE user_id=?',(aid,));con.execute('DELETE FROM auth_account WHERE user_id=?',(aid,));con.execute('DELETE FROM auth_user WHERE id=?',(aid,))
 with sqlite3.connect(ROOT_DB) as con:
  if uid:
   con.execute('DELETE FROM users WHERE id=?',(uid,));con.execute('DELETE FROM auth_session WHERE user_id=?',(uid,));con.execute('DELETE FROM auth_account WHERE user_id=?',(uid,));con.execute('DELETE FROM auth_user WHERE id=?',(uid,))

# The synthetic login token becomes unusable when the temporary auth user is removed.
(ROOT/'outputs/review-test-context.json').unlink(missing_ok=True)
