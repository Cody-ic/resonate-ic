from pathlib import Path
source=Path('tests/moderation-classification.py').read_text(encoding='utf-8')
exec(source[:source.index("try:\n metadata=")])
ok('POST','account/register',{'name':'分类审核验收','email':email,'password':pwd});uid=ok('GET','me')['user']['id']
state=ROOT/'outputs'/('acceptance-state-'+suffix);DB=state/ROOT_DB.relative_to(ROOT/'.wrangler/state');DB.parent.mkdir(parents=True,exist_ok=True)
with sqlite3.connect(ROOT_DB) as con,sqlite3.connect(DB) as clone:con.backup(clone)
runtime=ROOT/'outputs'/('acceptance-runtime-'+suffix);shutil.copytree(ROOT/'dist',runtime/'dist');(runtime/'dist/server/src').mkdir()
cfg=runtime/'dist/server/wrangler.json';value=json.loads(cfg.read_text());value['name']='acceptance-'+suffix;cfg.write_text(json.dumps(value))
test_vars=runtime/'dist/server/.dev.vars';test_vars.write_bytes((ROOT/'.dev.vars').read_bytes())
Path('outputs/review-test-context.json').write_text(json.dumps({'uid':uid,'runtime':str(runtime),'state':str(state),'database':str(DB),'cookies':cookies,'email':email,'suffix':suffix}))
print(json.dumps({'uid':uid,'runtime':str(runtime),'state':str(state)}))
