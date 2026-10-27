import {projects,course} from './examples';
import {categories,sourceGroups,platformOptions} from '../lib/classification';
import {boards,criteriaLabels} from '../lib/domain';
export function previewResponse(url:URL,method='GET') {
 const path=url.pathname.replace(/^\/api\/?/,'').split('/'),root=path[0],id=path[1];
 const reply=(value:unknown,status=200)=>Response.json(value,{status});
 if(method!=='GET'&&method!=='HEAD')return reply({error:'静态预览不接受提交，请等待正式网站开放。'},503);
 if(root==='me'&&!id)return reply({user:null});
 if(root==='config')return reply({categories,boards,criteria:criteriaLabels,platformLoginEnabled:false,emailVerificationEnabled:false,emailVerificationRequired:false,moderation:{projectPublicationEnabled:false,projectAIConfigured:false,discussionAIConfigured:false}});
 if(root==='taxonomy')return reply({sources:sourceGroups,platforms:platformOptions,tags:[...new Set([...projects,course].flatMap(p=>p.tags))]});
 if((root==='projects'||root==='courses')&&!id){
  const kind=root==='courses'?'course':url.searchParams.get('kind')??'project';
  let items=[...projects,course].filter(p=>p.kind===kind);
  const q=url.searchParams.get('q')?.trim().toLowerCase(),category=url.searchParams.get('category'),platform=url.searchParams.get('platform'),tags=url.searchParams.getAll('tag');
  if(url.searchParams.get('featured')==='true')items=items.filter(p=>'featured' in p&&p.featured);
  if(q)items=items.filter(p=>[p.title,p.summary,...p.tags].join(' ').toLowerCase().includes(q));
  if(category)items=items.filter(p=>p.category===category);
  if(platform)items=items.filter(p=>p.platforms.some(v=>v.name===platform));
  if(url.searchParams.get('source'))items=items.filter(p=>p.sources.some(s=>s.name===url.searchParams.get('source')));
  if(url.searchParams.get('division'))items=items.filter(p=>p.sources.some(s=>s.division===url.searchParams.get('division')));
  if(url.searchParams.get('year'))items=items.filter(p=>p.sources.some(s=>String(s.year)===url.searchParams.get('year')));
  if(tags.length)items=items.filter(p=>tags.every(t=>p.tags.includes(t)));
  const availability:Record<string,Record<string,number>>={category:{},source:{},division:{},platform:{},tag:{},year:{}};
  for(const p of items){availability.category[p.category]=(availability.category[p.category]??0)+1;for(const t of p.tags)availability.tag[t]=(availability.tag[t]??0)+1;for(const v of p.platforms)availability.platform[v.name]=(availability.platform[v.name]??0)+1;for(const s of p.sources){availability.source[s.name]=(availability.source[s.name]??0)+1;availability.year[String(s.year)]=(availability.year[String(s.year)]??0)+1;}}
  return reply({items,total:items.length,nextOffset:null,availability});
 }
 if(root==='projects'&&id){const project=projects.find(p=>p.id===id);return project?reply({project,attachments:[],courses:[],history:[{id:project.revisionId,number:1,status:'published',createdAt:project.createdAt}]}):reply({error:'预览中没有这个项目'},404);}
 if(root==='courses'&&id===course.id)return reply({course,trusted:null,attachments:[],history:[]});
 if(root==='topics')return reply({items:[]});
 return reply({error:'这个功能需要正式网站服务，静态预览暂不提供。'},503);
}
