"""Local account, ownership and content lifecycle checks; exact fixtures cleaned in finally."""
import copy,hashlib,http.cookiejar,json,secrets,sqlite3,time,urllib.error,urllib.request,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BASE='http://127.0.0.1:5173'
DB=next(p for p in (ROOT/'.wrangler/state/v3/d1').rglob('*.sqlite') if p.name!='metadata.sqlite')
suffix=uuid.uuid4().hex;emails=[f'qa-{suffix}-{i}@example.com' for i in range(2)];password=secrets.token_urlsafe(24)
users=[];pids=[];tids=[];rids=[];checks=[]
with sqlite3.connect(DB) as con,sqlite3.connect(ROOT/'outputs'/f'before-account-tests-{time.time_ns()}.sqlite') as backup:con.backup(backup)
def client():return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
a,b,anon=client(),client(),client()
def call(c,method,path,body=None,headers=None):
    data=None if body is None else json.dumps(body,ensure_ascii=False).encode()
    req=urllib.request.Request(BASE+'/api/'+path,data=data,headers={'Content-Type':'application/json','Origin':BASE,**(headers or {})},method=method)
    try:
        with c.open(req) as r:return r.status,json.loads(r.read()),r.headers
    except urllib.error.HTTPError as e:
        raw=e.read()
        try:body=json.loads(raw)
        except:body={'error':raw.decode(errors='replace')[:300]}
        return e.code,body,e.headers
def check(name,value):
    assert value,name
    checks.append(name)
def ok(c,method,path,body=None):
    code,value,_=call(c,method,path,body);assert code in (200,201),(method,path,code,value);return value
try:
    check('cross origin registration blocked',call(anon,'POST','account/register',{}, {'Origin':'https://evil.example.com'})[0]==403)
    check('short password rejected',call(anon,'POST','account/register',{'name':'验收甲','email':emails[0],'password':'short'})[0]==422)
    for c,email,name in [(a,emails[0],'验收甲'),(b,emails[1],'验收乙')]:
        code,v,h=call(c,'POST','account/register',{'name':name,'email':email,'password':password})
        assert code==200,(code,v)
        me=ok(c,'GET','me')['user'];users.append(me['id'])
        check('registered session belongs to '+name,me['name']==name and me['provider']=='password' and not me['admin'])
        check('session cookie is HttpOnly','HttpOnly' in h.get('Set-Cookie',''))
    check('anonymous has no identity',ok(anon,'GET','me')['user'] is None)
    check('fake platform headers cannot impersonate',call(anon,'GET','me',headers={'oai-authenticated-user-id':users[0],'oai-authenticated-user-email':emails[0]})[1]['user'] is None)
    check('wrong password rejected',call(anon,'POST','auth/sign-in/email',{'email':emails[0],'password':password+'wrong'})[0]==401)
    ok(a,'PATCH','me',{'name':'验收甲改名','bio':'测试简介，不是正式用户数据。'})
    public=ok(anon,'GET','users/'+users[0]);check('public profile has bio but no email',public['user']['bio'].startswith('测试简介') and 'email' not in json.dumps(public))
    payload={'title':'临时验收工程 '+suffix[:6],'summary':'只用于本地账号和内容管理验收，完成后清理。','category':'嵌入式系统','version':'v1','stage':'进行中','description':'这是一个仅供本地接口验收的临时工程，验证编辑与删除的所有权边界。','hardware':'STM32 开发板与本地工具链','license':'MIT','sections':[{'title':'自由标题','body':'自定义章节正文'}],'tags':['验收标签'],'links':[{'type':'repository','label':'代码仓库','url':'https://example.com/source'}]}
    check('missing required hardware rejected',call(a,'POST','projects',{**payload,'hardware':''})[0]==422)
    project=ok(a,'POST','projects',payload);pid=project['id'];pids.append(pid)
    check('draft absent from public profile',ok(anon,'GET','users/'+users[0]+'/content')['total']==0)
    check('owner sees draft in content manager',ok(a,'GET','me/content')['items'][0]['id']==pid)
    check('other author cannot patch project',call(b,'PATCH','projects/'+pid,payload)[0]==403)
    check('other author cannot delete project',call(b,'DELETE','projects/'+pid)[0]==403)
    # Optional body sections may remain empty at submission.
    job=ok(a,'POST','projects/'+pid+'/submit',{});check('optional instructions may be omitted',job['status']=='queued')
    ok(a,'DELETE','projects/'+pid)
    check('deleted project inaccessible even to author',call(a,'GET','projects/'+pid)[0]==404)
    check('deleted project listed in own recycle bin',ok(a,'GET','me/content?state=deleted')['items'][0]['id']==pid)
    check('GET cannot restore a project',call(a,'GET','projects/'+pid+'/restore')[0]!=200)
    check('another author cannot restore project',call(b,'POST','projects/'+pid+'/restore',{})[0]==403)
    ok(a,'POST','projects/'+pid+'/restore',{});check('restore preserves queued state',ok(a,'GET','projects/'+pid)['project']['status']=='queued')
    topic=ok(a,'POST','topics',{'title':'验收讨论 '+suffix[:6],'body':'这是正常的技术讨论，用于验证修改和回收站。','board':'经验交流','projectId':'a1000000-0000-4000-8000-000000000002'});tid=topic['id'];tids.append(tid)
    check('project discussion filter matches relation',any(t['id']==tid for t in ok(anon,'GET','topics?projectId=a1000000-0000-4000-8000-000000000002')['items']))
    check('other project does not contain discussion',not any(t['id']==tid for t in ok(anon,'GET','topics?projectId=a1000000-0000-4000-8000-000000000001')['items']))
    check('other user cannot load edit data',call(b,'GET','topics/'+tid+'/edit')[0]==403)
    check('other user cannot edit topic',call(b,'PATCH','topics/'+tid,{})[0]==403)
    edit=ok(a,'GET','topics/'+tid+'/edit');old=ok(anon,'GET','topics/'+tid)['topic']['body']
    pending=ok(a,'PATCH','topics/'+tid,{'title':'修改待审标题','board':'经验交流','body':'新用户补充一个外部链接 https://example.com/waiting','editToken':edit['editToken']})
    check('suspicious edit queued',pending['status']=='queued')
    check('pending edit leaves public body intact',ok(anon,'GET','topics/'+tid)['topic']['body']==old)
    check('pending edit is private',call(anon,'GET','topics/'+tid+'/edit')[0]==401)
    check('stale editing rejected',call(a,'PATCH','topics/'+tid,{'body':'过时的修改不应覆盖新稿件。','editToken':edit['editToken']})[0]==409)
    edit=ok(a,'GET','topics/'+tid+'/edit');result=ok(a,'PATCH','topics/'+tid,{'title':'规则通过的新标题','body':'不带外链的正常技术补充内容，应该通过规则检查。','editToken':edit['editToken']})
    check('ordinary edit publishes through rules without AI',result['status']=='published' and ok(anon,'GET','topics/'+tid)['topic']['body'].startswith('不带外链'))
    reply=ok(b,'POST','topics/'+tid+'/replies',{'body':'这是验收乙提供的正常技术回复。'});rid=reply['id'];rids.append(rid)
    check('topic owner cannot delete another users reply',call(a,'DELETE','replies/'+rid)[0]==403)
    re=ok(b,'GET','replies/'+rid+'/edit');ok(b,'PATCH','replies/'+rid,{'body':'这是作者本人编辑后的回复内容。','editToken':re['editToken']})
    check('own reply appears on profile',ok(anon,'GET','users/'+users[1]+'/content?kind=reply')['total']==1)
    ok(b,'DELETE','replies/'+rid);check('deleted reply absent from topic',len(ok(anon,'GET','topics/'+tid)['replies'])==0)
    ok(b,'POST','replies/'+rid+'/restore',{});check('reply can be restored',len(ok(anon,'GET','topics/'+tid)['replies'])==1)
    ok(a,'DELETE','topics/'+tid);check('deleted topic absent for everyone',call(anon,'GET','topics/'+tid)[0]==404)
    check('reply under deleted topic absent from public profile',ok(anon,'GET','users/'+users[1]+'/content?kind=reply')['total']==0)
    ok(a,'POST','topics/'+tid+'/restore',{});check('topic restored',call(anon,'GET','topics/'+tid)[0]==200)
    with sqlite3.connect(DB) as con:
        count=con.execute('SELECT count(*) FROM forum_edits WHERE owner_id IN (?,?)',users).fetchone()[0]
        hashes=[r[0] for r in con.execute('SELECT password FROM auth_account WHERE user_id IN (?,?)',users)]
    check('forum edit history retained',count>=5)
    check('passwords hashed rather than stored in plaintext',all(v and v!=password and password not in v for v in hashes))
    ok(a,'POST','auth/sign-out',{});check('sign out invalidates session',ok(a,'GET','me')['user'] is None)
    ok(a,'POST','auth/sign-in/email',{'email':emails[0],'password':password});check('real password login survives logout',ok(a,'GET','me')['user']['id']==users[0])
    print(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False,indent=2))
finally:
    with sqlite3.connect(DB) as con:
        # Register failures may create auth rows before the profile gets initialized.
        auth_ids=[r[0] for r in con.execute('SELECT id FROM auth_user WHERE email IN (?,?)',emails)]
        for uid in users:
            jobs=[r[0] for r in con.execute('SELECT id FROM reviews WHERE owner_id=?',(uid,))]
            for jid in jobs:
                con.execute('DELETE FROM decisions WHERE review_id=?',(jid,));con.execute('DELETE FROM ai_calls WHERE review_id=?',(jid,))
            con.execute('DELETE FROM reviews WHERE owner_id=?',(uid,));con.execute('DELETE FROM forum_edits WHERE owner_id=?',(uid,));con.execute('DELETE FROM replies WHERE owner_id=?',(uid,));con.execute('DELETE FROM topics WHERE owner_id=?',(uid,))
            for pid in pids:
                con.execute('DELETE FROM content_facets WHERE project_id=?',(pid,));con.execute('DELETE FROM revision_taxonomy WHERE revision_id IN (SELECT id FROM revisions WHERE project_id=?)',(pid,))
                con.execute('DELETE FROM revisions WHERE project_id=?',(pid,));con.execute('DELETE FROM projects WHERE id=?',(pid,))
            con.execute('DELETE FROM limits WHERE key LIKE ?',(uid+':%',));con.execute('DELETE FROM users WHERE id=?',(uid,))
        for uid in auth_ids:
            con.execute('DELETE FROM account_links WHERE auth_user_id=?',(uid,));con.execute('DELETE FROM auth_session WHERE user_id=?',(uid,));con.execute('DELETE FROM auth_account WHERE user_id=?',(uid,));con.execute('DELETE FROM auth_user WHERE id=?',(uid,))
