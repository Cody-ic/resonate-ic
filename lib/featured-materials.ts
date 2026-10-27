import {env} from "cloudflare:workers";
import {hasQuote} from "./review-results";
import {featuredCourseFiles} from "./featured";

export async function prepareFeaturedEvidence(review:any,snapshot:any){
  const files=featuredCourseFiles(snapshot),currentCourses=JSON.stringify((snapshot.relatedCourses??[]).map((c:any)=>[c.id,c.revisionId]).sort());
  const rows=await env.DB!.prepare("SELECT b.digest,b.result,r.id review_id,r.snapshot FROM review_material_batches b JOIN reviews r ON r.id=b.review_id WHERE r.entity_id=? AND r.digest=? AND b.result IS NOT NULL ORDER BY json_array_length(b.result,'$.covered') DESC").bind(review.entityId,review.digest).all<any>();
  const seen=new Set<string>(),notes:any[]=[],readNames=new Set<string>(),readSources:string[]=[],reusedReviewIds=new Set<string>();
  for(const row of rows.results){
    if(seen.has(row.digest))continue;
    const old=JSON.parse(row.snapshot),refs=JSON.stringify((old.relatedCourses??[]).map((c:any)=>[c.id,c.revisionId]).sort());
    if(refs!==currentCourses)continue;
    const note=JSON.parse(row.result);let valid=true;
    for(const e of note.evidence??[]){const path=e.id.replace(/#\d+$/,''),file=files.find(f=>f.name===path);if(!file||!hasQuote(await file.read(),e.quote)){valid=false;break;}}
    if(!valid)continue;
    seen.add(row.digest);notes.push({sourceReviewId:row.review_id,...note});reusedReviewIds.add(row.review_id);
    for(const id of note.covered??[])readNames.add(id.replace(/#\d+$/,''));
    for(const e of note.evidence??[])readSources.push(e.quote);
  }
  const checkpoint=review.result?JSON.parse(review.result).evidenceCheckpoint:null;
  if(checkpoint){for(const path of checkpoint.readNames??[])if(files.some(f=>f.name===path))readNames.add(path);readSources.push(...(checkpoint.readSources??[]));notes.push(...(checkpoint.notes??[]));}
  const chaptersTotal=(snapshot.relatedCourses??[]).reduce((n:number,c:any)=>n+(c.modules??[]).reduce((m:number,module:any)=>m+module.lessons.length,0),0);
  return {notes,readNames:[...readNames],readSources,reusedReviewIds:[...reusedReviewIds],chaptersTotal};
}
