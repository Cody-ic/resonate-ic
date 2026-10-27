"""Run the provider-required genuine Claude Code client, without tools or saved auth."""
import getpass,json,pathlib,subprocess,os,shutil,time,sys
root=pathlib.Path.cwd();out=root/'outputs/sonnet-pcb-probe-1793076499828022600'
payload=json.loads((out/'pcb-payload.json').read_text(encoding='utf-8'))
key=getpass.getpass('API key (hidden; not saved): ')
env={k:v for k,v in os.environ.items() if not k.startswith(('ANTHROPIC_','CLAUDE_'))}
env.update(ANTHROPIC_API_KEY=key,ANTHROPIC_BASE_URL='https://www.micuapi.ai',CLAUDE_CONFIG_DIR=str(out/'isolated-cli-config'))
cli=pathlib.Path.home()/'AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe'
args=[str(cli),'--bare','-p','--model','claude-sonnet-5-5','--effort','high','--tools','','--no-session-persistence','--max-turns','1','--max-budget-usd','0.20','--output-format','json']
prompt=payload['system']+'\n\n'+payload['messages'][0]['content']
report={'requestedModel':'claude-sonnet-5-5','effort':'high','client':'genuine Claude Code','toolAccess':False,'maxTurns':1,'maxBudgetUsd':0.20}
started=time.monotonic();process=subprocess.Popen(args,cwd=out,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
print('Standard client request started; tools disabled.',flush=True)
try:
 stdout,stderr=process.communicate(prompt,timeout=240)
 stdout=stdout.replace(key,'[redacted]');stderr=stderr.replace(key,'[redacted]')
 (out/'cli-private-response.json').write_text(stdout,encoding='utf-8');(out/'cli-stderr.txt').write_text(stderr,encoding='utf-8')
 response=json.loads(stdout);report.update(exitCode=process.returncode,elapsedSeconds=round(time.monotonic()-started,2),isError=response.get('is_error'),subtype=response.get('subtype'),usage=response.get('usage'),modelUsage=response.get('modelUsage'),estimatedCostUsd=response.get('total_cost_usd'),numTurns=response.get('num_turns'))
 (out/'cli-answer.txt').write_text(response.get('result',''),encoding='utf-8')
 if response.get('is_error'):report['error']=response.get('result','')[:2000]
except subprocess.TimeoutExpired:
 process.kill();process.communicate();report.update(error='Client timed out; no automatic retry, billing uncertain',exitCode=None)
except Exception as error:report.update(error=str(error).replace(key,'[redacted]'))
(out/'cli-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False),flush=True)
sys.exit(1 if report.get('error') or report.get('isError') else 0)
