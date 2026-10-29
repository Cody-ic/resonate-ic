// Operator import of a bundled, hash-verified course. Publication still goes
// through the normal persistent review queue; no review result is fabricated.
import {readFileSync,realpathSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
export async function importCampusCourse({db,root,bindings,projectId}){
  if(!/^[0-9a-f-]{36}$/i.test(projectId??''))throw Error('Pass --project with a published project UUID');
  const state=execFileSync('systemctl',['--user','show','resonate-campus.service','--property=ActiveState','--value'],{encoding:'utf8'}).trim();
  if(state!=='inactive'&&state!=='failed')throw Error('Stop the campus service before importing');
  const metadata=JSON.parse(readFileSync(path.join(root,'content/smartwatch-import.json'),'utf8'));
  const registry=JSON.parse(readFileSync(path.join(root,'content/trusted-courses.json'),'utf8'));
  const trusted=registry.find(s=>s.courseId===metadata.courseId&&s.revisionId===metadata.revisionId&&s.sourceDigest===metadata.sourceDigest);
  if(!trusted)throw Error('Course is not in the bundled trusted registry');
  const base=realpathSync(path.join(root,'public',metadata.basePath.replace(/^\//,'')));
  for(const file of metadata.files){
    const source=realpathSync(path.join(base,file.path));
    if(!source.startsWith(base+path.sep)||hash(readFileSync(source))!==file.servedSha256)throw Error('Course asset verification failed: '+file.path);
  }
  if(hash(metadata.files.map(f=>`${f.path}\t${f.sourceSha256}`).join('\n'))!==metadata.sourceDigest)throw Error('Course source manifest mismatch');
  const project=await db.prepare("SELECT p.owner_id,p.published_id FROM projects p JOIN revisions r ON r.id=p.published_id WHERE p.id=? AND p.kind='project' AND p.deleted_at IS NULL AND p.admin_lock_at IS NULL AND r.status='published'").bind(projectId).first();
  if(!project||!(bindings.ADMIN_USER_IDS??'').split(',').includes(project.owner_id))throw Error('Linked project must belong to the configured administrator');
  const owner=await db.prepare('SELECT id FROM auth_user WHERE id=? AND email_verified=1').bind(project.owner_id).first();
  if(!owner)throw Error('Owner must complete normal email verification');
  const existing=await db.prepare('SELECT id FROM projects WHERE id=?').bind(metadata.courseId).first();
  if(existing)throw Error('Course already exists; use normal revision editing rather than overwriting it');
  const course={...metadata.course,projectId,projectRevisionId:project.published_id,
    platforms:[{name:'ST',family:'mcu'},{name:'CH',family:'mcu'}],sources:[{name:'自主项目',division:'',year:2026,detail:'SmartWatch 配套学习课程'}]};
  const lessons=course.modules.flatMap(m=>m.lessons);
  if(lessons.length!==79||new Set(lessons.map(l=>l.id)).size!==79||lessons.some(l=>!trusted.lessonPaths[l.id]||!l.title||(!l.body&&!l.links.length)))throw Error('Incomplete bundled course');
  const snapshot=JSON.stringify(course),digest=hash(snapshot),now=Date.now(),reviewId=crypto.randomUUID();
  if(Buffer.byteLength(snapshot)>55000)throw Error('Course exceeds ordinary submission size; use the long-course review path');
  await db.batch([
    db.prepare("INSERT INTO projects(id,owner_id,kind,head_id,created_at,updated_at) VALUES(?,?,'course',?,?,?)").bind(metadata.courseId,project.owner_id,metadata.revisionId,now,now),
    db.prepare("INSERT INTO revisions(id,project_id,number,snapshot,digest,status,created_at) VALUES(?,?,1,?,?,'queued',?)").bind(metadata.revisionId,metadata.courseId,snapshot,digest,now),
    db.prepare("INSERT INTO reviews(id,entity_type,entity_id,owner_id,snapshot,digest,state,created_at,updated_at,task,lane) VALUES(?,'revision',?,?,?,?,'queued',?,?,'publish','project')").bind(reviewId,metadata.revisionId,project.owner_id,snapshot,digest,now,now),
    db.prepare("INSERT INTO moderation_actions(id,entity_type,entity_id,actor_id,action,reason,created_at) VALUES(?,'course',?,?,'import','导入已核对哈希的 SmartWatch v0.2.0 快照并进入正常审核队列，未直接发布',?)").bind(crypto.randomUUID(),metadata.courseId,project.owner_id,now),
  ]);
  console.log(JSON.stringify({courseId:metadata.courseId,revisionId:metadata.revisionId,reviewId,status:'queued',modules:course.modules.length,lessons:lessons.length,verifiedFiles:metadata.files.length,projectId}));
}
