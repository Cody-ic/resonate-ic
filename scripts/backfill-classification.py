"""Local additive classification index; original revisions/digests stay intact."""
import argparse,json,re,sqlite3,time
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--local',action='store_true');args=parser.parse_args()
if not args.local:raise SystemExit('Pass --local. Remote data is never changed by this script.')
root=Path(__file__).resolve().parents[1]
paths=[p for p in (root/'.wrangler/state/v3/d1').rglob('*.sqlite') if p.name!='metadata.sqlite']
assert len(paths)==1
db=sqlite3.connect(paths[0]);db.row_factory=sqlite3.Row
(root/'outputs').mkdir(exist_ok=True)
with sqlite3.connect(root/'outputs'/f'before-classification-{time.time_ns()}.sqlite') as backup:db.backup(backup)
rows=db.execute("SELECT p.id,p.published_id,r.snapshot,r.digest FROM projects p JOIN revisions r ON r.id=p.published_id WHERE r.status='published'").fetchall()
patterns={'ST':r'\bSTM32','CH':r'\bCH(?:32|58|59)','ESP':r'\bESP(?:32|8266)','NXP':r'\bRT10\d{2}|\bNXP','51':r'\b(?:8051|STC(?:8|12|15|89))','赛灵思':r'\bXilinx|\bZynq','高云':r'\bGOWIN|\bGW[12][AN]'}
with db:
    for row in rows:
        snapshot=json.loads(row['snapshot']);category=snapshot['category']
        if category in ['智能车与控制','物联网']:category='嵌入式系统'
        if category=='电子设计':category=''
        existing=db.execute('SELECT resolved,digest FROM revision_taxonomy WHERE revision_id=?',(row['published_id'],)).fetchone()
        if existing and existing['digest']==row['digest']:resolved=json.loads(existing['resolved'])
        else:
            resolved={key:snapshot.get(key,[]) for key in ['sources','platforms','tags']}
            if 'platforms' not in snapshot:
                hardware=snapshot.get('hardware','')+' '+' '.join(snapshot.get('tags',[]))
                resolved['platforms']=[{'name':name,'family':'fpga' if name in ['赛灵思','高云'] else 'mcu'} for name,pattern in patterns.items() if re.search(pattern,hardware,re.I)]
            if row['id']=='a1000000-0000-4000-8000-000000000001' and 'sources' not in snapshot:
                resolved['sources']=[{'name':'智能车','division':'','year':None,'detail':'参赛准备','proposedName':'','proposedDivision':''}]
                resolved['tags']=list(dict.fromkeys([*resolved['tags'],'智能车','控制']))
            db.execute('INSERT OR IGNORE INTO revision_taxonomy(revision_id,digest,resolved,updated_at) VALUES(?,?,?,?)',(row['published_id'],row['digest'],json.dumps(resolved,ensure_ascii=False),int(time.time()*1000)))
        facets=[('category','',category)]
        for s in resolved['sources']:
            facets.append(('source','',s['name']))
            if s.get('division'):facets.append(('division',s['name'],s['division']))
            if s.get('year'):facets.append(('year',s['name'],str(s['year'])))
        facets.extend(('platform','',p['name']) for p in resolved['platforms'])
        facets.extend(('tag','',t) for t in resolved['tags'])
        db.execute('DELETE FROM content_facets WHERE project_id=?',(row['id'],))
        for kind,parent,value in set(facets):
            db.execute('INSERT INTO content_facets(key,project_id,revision_id,kind,parent,value) VALUES(?,?,?,?,?,?)',(json.dumps([row['id'],kind,parent,value],ensure_ascii=False,separators=(',',':')),row['id'],row['published_id'],kind,parent,value))
            if kind not in ['category','year']:
                family=next((p['family'] for p in resolved['platforms'] if p['name']==value),'') if kind=='platform' else ''
                db.execute('INSERT OR IGNORE INTO taxonomy_terms(key,kind,parent,name,family,created_at) VALUES(?,?,?,?,?,?)',(json.dumps([kind,parent,value],ensure_ascii=False,separators=(',',':')),kind,parent,value,family,int(time.time()*1000)))
print(json.dumps({'indexedPublishedItems':len(rows),'originalSnapshotsChanged':0},ensure_ascii=False))
