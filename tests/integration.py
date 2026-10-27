"""Run against the local dev server. Uses only the Sites loopback mock identity."""
import json, urllib.request, urllib.error, uuid, time
BASE='http://127.0.0.1:5173'
results=[]
def call(method,path,body=None,auth=False,headers=None):
    h={'Content-Type':'application/json',**(headers or {})}
    if auth: h['Cookie']='__sites_local_auth=1'
    req=urllib.request.Request(BASE+'/api/'+path,data=json.dumps(body).encode() if body is not None else None,headers=h,method=method)
    try:
        r=urllib.request.urlopen(req);return r.status,json.loads(r.read())
    except urllib.error.HTTPError as e:
        raw=e.read().decode()
        try: value=json.loads(raw)
        except json.JSONDecodeError: value={'error':raw}
        return e.code,value
def check(name,condition):
    assert condition,name
    results.append(name)
suffix=uuid.uuid4().hex[:8]
check('health has durable bindings',call('GET','health')[1]['database'])
check('anonymous write rejected',call('POST','projects',{},False)[0]==401)
check('forged identity rejected in local preview',call('POST','projects',{},False,{'oai-authenticated-user-id':'fake','oai-authenticated-user-email':'fake@x.com'})[0]==401)
check('cross origin rejected',call('POST','projects',{},True,{'Origin':'https://evil.example.com'})[0]==403)
payload={'title':'集成测试项目 '+suffix,'summary':'用于验证版本、可见性和权限的临时工程。','category':'嵌入式系统','version':'v1','stage':'进行中','description':'这是自动化集成测试生成的工程，不是真实参赛作品。'*2,'instructions':'准备开发板和工具链，按照接线说明编译，连接调试器烧录后观察串口输出。','license':'MIT','links':[{'label':'工程','type':'eda','url':'https://oshwhub.com/example/test'}]}
code,p=call('POST','projects',payload,True);check('create draft with non-GitHub link',code==201)
pid=p['id']
check('draft invisible to anonymous',call('GET','projects/'+pid)[0]==404)
check('draft visible to owner',call('GET','projects/'+pid,auth=True)[0]==200)
code,job=call('POST','projects/'+pid+'/submit',{},True);check('submit enters queue',code==200 and job['status']=='queued')
check('duplicate submission rejected',call('POST','projects/'+pid+'/submit',{},True)[0]==409)
payload['version']='v2'
code,rev=call('PATCH','projects/'+pid,payload,True);check('immutable revision appended',code==201 and rev['revisionId']!=p['revisionId'])
detail=call('GET','projects/'+pid,auth=True)[1];check('history preserved',len(detail['history'])==2)
check('admin requires explicit role',call('GET','admin/budget',auth=True)[0]==403)
code,topic=call('POST','topics',{'title':'测试讨论 '+suffix,'board':'经验交流','body':'普通技术讨论测试 '+suffix},True)
check('normal discussion auto publishes without AI',code==201 and topic['status']=='published')
check('published topic is public',call('GET','topics/'+topic['id'])[0]==200)
print(json.dumps({'passed':len(results),'checks':results,'temporaryProject':pid,'temporaryTopic':topic['id']},ensure_ascii=False,indent=2))
