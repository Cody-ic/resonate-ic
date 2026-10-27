import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { taxonomyTerms,revisionTaxonomy } from "../db/schema";
import { builtinTerms,normalizeSnapshot } from "./classification";
import type { Term } from "./classification";

export async function terms():Promise<Term[]> {
  const {results:custom}=await env.DB!.prepare("SELECT kind,parent,name,family FROM taxonomy_terms").all<Term>();
  return [...new Map([...builtinTerms,...custom].map(t=>[JSON.stringify([t.kind,t.parent,t.name]),t])).values()];
}
export async function snapshotView(revision:{id:string;snapshot:string;digest:string}){
  const value=normalizeSnapshot(JSON.parse(revision.snapshot));
  const resolution=await getDb().select().from(revisionTaxonomy).where(eq(revisionTaxonomy.revisionId,revision.id)).get();
  return resolution?.digest===revision.digest?{...value,...JSON.parse(resolution.resolved)}:value;
}
export async function taxonomyConfig(){
  const all=await terms();
  const sourceNames=all.filter(t=>t.kind==="source").map(t=>t.name);
  return {sources:sourceNames.map(name=>({name,divisions:all.filter(t=>t.kind==="division"&&t.parent===name).map(t=>t.name)})),
    platforms:all.filter(t=>t.kind==="platform").map(({name,family})=>({name,family})),tags:all.filter(t=>t.kind==="tag").map(t=>t.name)};
}
export async function publicCatalog(kind:string,params:URLSearchParams){
  const db=env.DB!;
  function criteria(exclude=''){
  const conditions=["p.kind=?","p.deleted_at IS NULL","p.admin_lock_at IS NULL","r.status='published'"],args:(string|number)[]=[kind];
  function facet(type:string,values:string[],parent?:string){
    if(!values.length)return;
    conditions.push(`EXISTS(SELECT 1 FROM content_facets f WHERE f.project_id=p.id AND f.revision_id=r.id AND f.kind=? AND f.value IN (${values.map(()=>"?").join(",")})${parent!==undefined?" AND f.parent=?":""})`);
    args.push(type,...values,...(parent!==undefined?[parent]:[]));
  }
  const category=params.get("category"),source=exclude==='source'?null:params.get("source"),division=['source','division'].includes(exclude)?null:params.get("division"),year=exclude==='year'?null:params.get("year");
  if(category&&exclude!=='category')facet("category",[category]);
  const sourceConditions:string[]=[],sourceArgs:string[]=[];
  for(const [name,value] of [['name',source],['division',division],['year',year]])if(value){sourceConditions.push(`CAST(json_extract(src.value,'$.${name}') AS TEXT)=?`);sourceArgs.push(value);}
  if(sourceConditions.length){conditions.push(`EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(t.resolved,'$.sources'),json_extract(r.snapshot,'$.sources'),'[]')) src WHERE ${sourceConditions.join(' AND ')})`);args.push(...sourceArgs);}
  if(exclude!=='platform')facet("platform",params.getAll("platform").slice(0,12));
  for(const tag of params.getAll("tag").slice(0,20))facet("tag",[tag]);
  const projectId=params.get("projectId");if(projectId){conditions.push("json_extract(r.snapshot,'$.projectId')=?");args.push(projectId);}
  if(params.get("featured")==="true")conditions.push("s.revision_id=r.id");
  const q=(params.get("q")??"").trim().slice(0,100).toLowerCase();
  if(q){conditions.push("instr(lower(json_extract(r.snapshot,'$.title')||' '||json_extract(r.snapshot,'$.summary')||' '||COALESCE(json_extract(t.resolved,'$.tags'),json_extract(r.snapshot,'$.tags'))),?)>0");args.push(q);}
  return {where:conditions.join(' AND '),args};
  }
  const joins="FROM projects p JOIN revisions r ON r.id=p.published_id LEFT JOIN users u ON u.id=p.owner_id LEFT JOIN selections s ON s.project_id=p.id LEFT JOIN revision_taxonomy t ON t.revision_id=r.id AND t.digest=r.digest";
  const {where,args}=criteria();
  const statements=[db.prepare(`SELECT COUNT(*) n ${joins} WHERE ${where}`).bind(...args)];
  const offset=Math.max(0,Math.min(1000000,Number(params.get("offset"))||0)),limit=24;
  statements.push(db.prepare(`SELECT p.id,p.owner_id AS ownerId,p.kind,p.updated_at AS updatedAt,r.id AS revisionId,r.status,r.snapshot,r.digest,t.resolved,u.name AS author,s.revision_id AS selectionRevision,s.criteria,s.evidence,s.created_at AS selectedAt ${joins} WHERE ${where} ORDER BY p.updated_at DESC,p.id DESC LIMIT ? OFFSET ?`).bind(...args,limit,offset));
  const availability:Record<string,Record<string,number>>={};
  for(const facetKind of ['category','source','division','platform','tag','year']){
    const c=criteria(facetKind);
    let query:string,bindings:(string|number)[];
    if(['source','division','year'].includes(facetKind)){
      const property=facetKind==='source'?'name':facetKind,extra:string[]=[],extraArgs:string[]=[];
      for(const [name,value] of [['name',facetKind==='source'?null:params.get('source')],['division',facetKind==='year'?params.get('division'):null],['year',facetKind==='year'?null:params.get('year')]])if(value){extra.push(`CAST(json_extract(af.value,'$.${name}') AS TEXT)=?`);extraArgs.push(value);}
      query=`SELECT CAST(json_extract(af.value,'$.${property}') AS TEXT) value,COUNT(DISTINCT p.id) n ${joins} JOIN json_each(COALESCE(json_extract(t.resolved,'$.sources'),json_extract(r.snapshot,'$.sources'),'[]')) af WHERE ${c.where} AND json_extract(af.value,'$.${property}') IS NOT NULL AND CAST(json_extract(af.value,'$.${property}') AS TEXT)!=''${extra.length?' AND '+extra.join(' AND '):''} GROUP BY value`;
      bindings=[...c.args,...extraArgs];
    }else{
      query=`SELECT f.value,COUNT(DISTINCT p.id) n ${joins} JOIN content_facets f ON f.project_id=p.id AND f.revision_id=r.id AND f.kind=? WHERE ${c.where} GROUP BY f.value`;bindings=[facetKind,...c.args];
    }
    statements.push(db.prepare(query).bind(...bindings));
  }
  const batch=await db.batch<any>(statements),count=batch[0].results[0];
  const items=batch[1].results.map(({snapshot,resolved,selectionRevision,criteria,evidence,selectedAt,...row})=>({...row,...normalizeSnapshot(JSON.parse(snapshot)),...(resolved?JSON.parse(resolved):{}),author:row.author??"社区成员",
    featured:selectionRevision===row.revisionId?{criteria:JSON.parse(criteria),evidence,date:selectedAt}:null}));
  for(const [i,kind] of ['category','source','division','platform','tag','year'].entries())availability[kind]=Object.fromEntries(batch[i+2].results.map(r=>[r.value,r.n]));
  return {items,total:count?.n??0,nextOffset:offset+items.length<(count?.n??0)?offset+items.length:null,availability};
}
