"""One explicit Messages experiment. Credential stays in process memory."""
import getpass,json,pathlib,sys,time,urllib.request,urllib.error

base='https://www.micuapi.ai'
out=pathlib.Path('outputs')/('sonnet-pcb-probe-'+str(time.time_ns()))
out.mkdir(parents=True,exist_ok=False)
key=getpass.getpass('API key (hidden; not saved): ')
headers={'Authorization':'Bearer '+key,'User-Agent':'claude-cli/2.0.76 (external, cli)','anthropic-version':'2023-06-01','Accept':'application/json'}
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise RuntimeError('Redirect refused; credential not forwarded')
opener=urllib.request.build_opener(NoRedirect())
def call(path,payload=None):
 data=None if payload is None else json.dumps(payload,ensure_ascii=False).encode()
 req=urllib.request.Request(base+path,data=data,headers={**headers,**({'Content-Type':'application/json'} if data else {})})
 try:
  with opener.open(req,timeout=180) as response:return json.loads(response.read(4000000))
 except urllib.error.HTTPError as error:
  body=error.read(3000).decode('utf-8','replace').replace(key,'[redacted]')
  raise RuntimeError('HTTP '+str(error.code)+': '+body) from None
try:
 listing=call('/v1/models');ids=[r['id'] for r in listing.get('data',[])]
 matches=[m for m in ids if 'sonnet' in m.lower()]
 (out/'models.json').write_text(json.dumps(matches,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'output':str(out.resolve()),'sonnetModels':matches},ensure_ascii=False),flush=True)
 print('Ready for request JSON on stdin (model and payloadFile; no credential).',flush=True)
 command=json.loads(input());model=command['model']
 if model not in ids:raise RuntimeError('Requested model is not in the returned model list')
 payload=json.loads(pathlib.Path(command['payloadFile']).read_text(encoding='utf-8-sig'))
 payload.update(model=model,max_tokens=4096,output_config={'effort':'high'},thinking={'type':'adaptive'})
 (out/'request.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
 started=time.monotonic();response=call('/v1/messages',payload);elapsed=time.monotonic()-started
 (out/'private-response.json').write_text(json.dumps(response,ensure_ascii=False,indent=2).replace(key,'[redacted]'),encoding='utf-8')
 text='\n'.join(b.get('text','') for b in response.get('content',[]) if b.get('type')=='text')
 (out/'answer.txt').write_text(text,encoding='utf-8')
 summary={'returnedModel':response.get('model'),'stopReason':response.get('stop_reason'),'elapsedSeconds':round(elapsed,2),'usage':response.get('usage'),'answerFile':str((out/'answer.txt').resolve()),'requestEffort':'high','complete':response.get('stop_reason')=='end_turn'}
 (out/'result.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(summary,ensure_ascii=False),flush=True)
except Exception as error:
 message=str(error).replace(key,'[redacted]');(out/'error.json').write_text(json.dumps({'error':message},ensure_ascii=False),encoding='utf-8');print(json.dumps({'output':str(out.resolve()),'error':message},ensure_ascii=False),flush=True);sys.exit(1)
