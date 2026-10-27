import {env} from 'cloudflare:workers';
import {resourceDraftSchema} from './resource-draft-schema';
import {resourceSchema,HTTPError,digest,json} from './domain';
import {textZip} from './text-zip';
import {notify} from './notifications';
import {reviewFiles} from './review-files';
import {repositoryFiles} from './repository-review';
import {hasQuote} from './review-results';
const uuid=async(seed:string)=>{const h=await digest(seed);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
async function packageDraft(draft:any,source:any,owner:string,seed:string){
  const verification=source.verification??{steps:['none'],scope:'本资源为从来源项目整理的独立组件，尚未对提取后的组件执行核验。',unverified:'提取后的编译、运行、兼容性与硬件表现尚未核验。',evidence:''};
  const contents=[...draft.files,{name:'RESOURCE-INFO.txt',content:`${draft.title}\n\n${draft.description}\n\n环境与依赖：\n${draft.hardware}\n\n使用说明：\n${draft.instructions}\n\n局限与未验证范围：\n${draft.limitations}\n\n许可与署名：${source.license}\n由原项目作者确认投稿；AI辅助整理不等于可靠性审核通过。`}];
  if(draft.files.some((f:any)=>f.name.toLowerCase()==='resource-info.txt'))throw new HTTPError(422,'RESOURCE-INFO.txt 为自动生成的说明文件，请换一个文件名');
  const bytes=textZip(contents),fileId=await uuid('resource-file:'+seed),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const quota=await env.DB!.prepare('SELECT COALESCE(SUM(size),0) total FROM files WHERE owner_id=?').bind(owner).first<any>();if((quota?.total??0)+bytes.length>100*1024*1024)throw new HTTPError(413,'资源草稿会超过账号附件总额度');
  await env.BUCKET!.put(fileId,bytes,{httpMetadata:{contentType:'application/octet-stream'}});
  const snapshot=resourceSchema.parse({...source,...draft,verification,license:source.license,version:source.version??'0.1.0',stage:'可体验',sections:[],links:[],fileIds:[fileId],coverFileId:null,instructions:draft.instructions,evidence:'AI辅助整理的待审资源，可靠性范围见说明；未经实际执行的测试不得视为已验证。',platforms:[],sources:[]});
  return {fileId,fileName:draft.title+'.zip',size:bytes.length,hash,snapshot:JSON.stringify(snapshot)};
}
export async function requireOfferSource(projectId:string){
  const row=await env.DB!.prepare('SELECT p.admin_lock_at,p.deleted_at FROM resource_offers o JOIN projects p ON p.id=o.source_project_id WHERE o.project_id=?').bind(projectId).first<any>();
  if(row&&(row.admin_lock_at||row.deleted_at))throw new HTTPError(409,'来源作品已被下架或删除，请先处理来源作品；不能通过组件投稿绕过限制');
}
export async function createResourceOffer(review:any,result:any,info:any,readNames:string[]){
  if(info.kind!=='project'||!result.resourceDraft||!['pass','qualify','not_qualify'].includes(result.decision))return;
  const draft=resourceDraftSchema.parse(result.resourceDraft);
  if(!readNames.includes(draft.sourcePath))throw new Error('资源提取缺少已读取的来源文件');
  const db=env.DB!,existing=await db.prepare('SELECT project_id FROM resource_offers WHERE source_review_id=?').bind(review.id).first<any>();if(existing)return;
  const source=await db.prepare('SELECT owner_id,admin_lock_at,deleted_at FROM projects WHERE id=?').bind(info.projectId).first<any>();
  if(!source||source.owner_id!==review.ownerId||source.admin_lock_at||source.deleted_at)return;
  const material=await reviewFiles(info.snapshot.fileIds??[],review.ownerId);let origin=material.files.find(f=>f.name===draft.sourcePath);
  if(!origin&&review.task==='featured')origin=(await repositoryFiles(review.id,info.snapshot.links??[],env.BUCKET!)).files.find(f=>f.name===draft.sourcePath);
  if(!origin||!hasQuote(await origin.read(),draft.quote))throw new Error('组件草稿的来源路径与引文不对应，不能交给作者确认');
  const projectId=await uuid('resource-project:'+review.id),revisionId=await uuid('resource-revision:'+review.id),now=Date.now(),pack=await packageDraft(draft,info.snapshot,review.ownerId,review.id);
  await db.batch([
    db.prepare("INSERT INTO files(id,owner_id,name,size,digest,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(pack.fileId,review.ownerId,pack.fileName,pack.size,pack.hash,now),
    db.prepare("INSERT INTO projects(id,owner_id,kind,head_id,created_at,updated_at) VALUES(?,?,'resource',?,?,?) ON CONFLICT(id) DO NOTHING").bind(projectId,review.ownerId,revisionId,now,now),
    db.prepare("INSERT INTO revisions(id,project_id,number,snapshot,digest,status,created_at) VALUES(?,?,1,?,?,'draft',?) ON CONFLICT(id) DO NOTHING").bind(revisionId,projectId,pack.snapshot,await digest(pack.snapshot),now),
    db.prepare('INSERT INTO resource_offers(project_id,source_project_id,source_review_id,owner_id,payload,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(source_review_id) DO NOTHING').bind(projectId,info.projectId,review.id,review.ownerId,JSON.stringify(draft),now)
  ]);
  await notify(review.ownerId,'resource-offer:'+review.id,{title:'已为你整理一份可投稿的组件',body:`已从《${info.snapshot.title}》整理好“${draft.title}”的源码、使用说明和资源包。你可以直接同意投稿或拒绝，也可以现在或以后修改。同意后仍须经过独立的资源可靠性与内容审核，通过后才公开；未审核的资源不会上架。许可与署名沿用原项目，请在预览中核对。`},{href:'/resource-drafts?offer='+projectId,email:false,kind:'resource_offer'});
}
export async function resourceOffersApi(request:Request,path:string[],user:any,submit:(projectId:string)=>Promise<Response>){
  if(path[0]!=='resource-offers')return null;
  if(!user)throw new HTTPError(401,'请先登录');
  const db=env.DB!,projectId=path[1],action=path[2];
  if(request.method==='GET'&&!projectId){const rows=await db.prepare('SELECT o.*,p.head_id,p.deleted_at,r.status,r.snapshot FROM resource_offers o JOIN projects p ON p.id=o.project_id JOIN revisions r ON r.id=p.head_id WHERE o.owner_id=? ORDER BY o.created_at DESC LIMIT 30').bind(user.id).all<any>();return json({items:rows.results.map(r=>({...r,payload:JSON.parse(r.payload),snapshot:JSON.parse(r.snapshot)}))});}
  const offer=await db.prepare('SELECT o.*,p.head_id,p.deleted_at,p.admin_lock_at,r.status,r.number,r.snapshot FROM resource_offers o JOIN projects p ON p.id=o.project_id JOIN revisions r ON r.id=p.head_id WHERE o.project_id=? AND o.owner_id=?').bind(projectId,user.id).first<any>();
  if(!offer)throw new HTTPError(404,'资源草稿不存在');
  if(request.method==='POST'&&action==='accept'){
    await requireOfferSource(projectId);if(offer.deleted_at||offer.admin_lock_at)throw new HTTPError(409,'请先恢复草稿或处理下架限制');
    if(offer.status!=='draft'){const job=await db.prepare("SELECT id FROM reviews WHERE entity_id=? AND task='publish' ORDER BY created_at DESC LIMIT 1").bind(offer.head_id).first<any>();if(job)return json({reviewId:job.id,message:'该版本已经送审',status:offer.status});throw new HTTPError(409,'请先修改并生成新版本再投稿');}
    const response=await submit(projectId);if(response.ok)await db.prepare("UPDATE resource_offers SET state='accepted' WHERE project_id=? AND owner_id=?").bind(projectId,user.id).run();return response;
  }
  if(request.method==='POST'&&action==='decline'){
    if(offer.status!=='draft')throw new HTTPError(409,'该版本已经送审，请在内容管理中处理');
    await db.batch([db.prepare("UPDATE projects SET deleted_at=?,updated_at=? WHERE id=? AND head_id=? AND EXISTS(SELECT 1 FROM revisions WHERE id=? AND status='draft')").bind(Date.now(),Date.now(),projectId,offer.head_id,offer.head_id),db.prepare("UPDATE resource_offers SET state='declined' WHERE project_id=? AND EXISTS(SELECT 1 FROM projects WHERE id=? AND deleted_at IS NOT NULL)").bind(projectId,projectId)]);return json({message:'已拒绝，草稿保留在回收站，可稍后恢复修改'});
  }
  if(request.method==='PATCH'&&!action){
    if(Number(request.headers.get('content-length')??0)>90000)throw new HTTPError(413,'草稿过大');const raw=await request.text();if(new TextEncoder().encode(raw).length>90000)throw new HTTPError(413,'草稿过大');const body=JSON.parse(raw),draft=resourceDraftSchema.parse({...body.draft,sourcePath:JSON.parse(offer.payload).sourcePath,quote:JSON.parse(offer.payload).quote});
    if(offer.status!=='draft'||offer.deleted_at||offer.admin_lock_at||body.headId!==offer.head_id)throw new HTTPError(409,'草稿已变化或已送审，请刷新；已公开资源请使用版本编辑入口');
    const source=resourceSchema.parse({...JSON.parse(offer.snapshot),license:body.license,...(body.verification?{verification:body.verification}:{})}),revisionId=crypto.randomUUID(),pack=await packageDraft(draft,source,user.id,revisionId),now=Date.now();
    const result=await db.batch([
      db.prepare("INSERT INTO files(id,owner_id,name,size,digest,created_at) VALUES(?,?,?,?,?,?)").bind(pack.fileId,user.id,pack.fileName,pack.size,pack.hash,now),
      db.prepare("INSERT INTO revisions(id,project_id,number,snapshot,digest,status,created_at) SELECT ?,?,?,?,?, 'draft',? WHERE EXISTS(SELECT 1 FROM projects p JOIN revisions r ON r.id=p.head_id WHERE p.id=? AND p.head_id=? AND r.status='draft' AND p.deleted_at IS NULL AND p.admin_lock_at IS NULL)").bind(revisionId,projectId,offer.number+1,pack.snapshot,await digest(pack.snapshot),now,projectId,offer.head_id),
      db.prepare('UPDATE projects SET head_id=?,updated_at=? WHERE id=? AND head_id=? AND EXISTS(SELECT 1 FROM revisions WHERE id=?)').bind(revisionId,now,projectId,offer.head_id,revisionId),
      db.prepare('UPDATE resource_offers SET payload=? WHERE project_id=? AND EXISTS(SELECT 1 FROM projects WHERE id=? AND head_id=?)').bind(JSON.stringify(draft),projectId,projectId,revisionId)
    ]);if(result[1].meta.changes!==1)throw new HTTPError(409,'草稿已在其他页面更新，请刷新');return json({message:'草稿已保存，尚未投稿',headId:revisionId});
  }
  throw new HTTPError(405,'不支持的操作');
}
