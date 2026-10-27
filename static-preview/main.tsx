import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Community from '../app/community';
import {previewResponse} from './data';
import '../app/globals.css';
import '../app/course-fixes.css';
import '../app/classification.css';
import '../app/community-features.css';
import '../app/workflows.css';
import '../app/workspace.css';
import '../app/standards.css';
import '../app/featured-intro.css';
import '../app/project-cover.css';
import './preview.css';

const base=import.meta.env.BASE_URL;
const nativeFetch=window.fetch.bind(window);
window.fetch=async(input,options)=>{
 const url=new URL(input instanceof Request?input.url:String(input),location.href);
 if(url.origin===location.origin&&url.pathname.startsWith('/api/'))return previewResponse(url,options?.method??(input instanceof Request?input.method:'GET'));
 return nativeFetch(input,options);
};
function previewLink(href:string){return base+'#'+href;}
// Real components use root-relative links; rewrite those for a project Pages URL.
function rewriteLinks(){for(const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')){const href=link.getAttribute('href')!;if(!href.startsWith('//')&&!href.startsWith(base+'#'))link.setAttribute('href',previewLink(href));}}
const observer=new MutationObserver(rewriteLinks);observer.observe(document.getElementById('root')!,{childList:true,subtree:true});
document.addEventListener('click',event=>{
 const target=event.target instanceof Element?event.target:null;
 if(target?.closest('[role="link"].author-link')){event.preventDefault();event.stopImmediatePropagation();location.hash='/authors';}
},true);
const privateRoutes=new Set(['login','register','submit','admin','dashboard','notifications','reports','resource-drafts','verify-email','reset-password','feedback','authors','users','reviews']);
function App(){
 const [route,setRoute]=useState(location.hash.slice(1)||'/');
 useEffect(()=>{const change=()=>{setRoute(location.hash.slice(1)||'/');window.scrollTo(0,0);};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
 const routeURL=new URL(route,location.origin),path=routeURL.pathname.split('/').filter(Boolean);let view:any=path[0]||'projects',entityId=path[1],lessonId=path[3];
 useEffect(()=>{if(routeURL.hash){const frame=requestAnimationFrame(()=>document.getElementById(decodeURIComponent(routeURL.hash.slice(1)))?.scrollIntoView());return()=>cancelAnimationFrame(frame);}},[route]);
 if(view==='projects'&&entityId)view='detail';
 if(view==='courses')view=entityId?(path[2]==='lessons'?'lesson':'course'):'courses';
 const unavailable=privateRoutes.has(path[0])||(path[0]==='courses'&&entityId==='new');
 const supported=['projects','detail','featured','resources','courses','course','lesson','about','standards','privacy','contact','forum'].includes(view);
 return <><div className="preview-banner"><strong>共振 · 静态预览</strong><span>示例内容仅用于展示界面；登录、投稿、评论与审核暂未开放。</span><a href="https://github.com/Cody-ic/resonate-ic" target="_blank" rel="noreferrer">GitHub ↗</a></div>{unavailable||!supported?<div className="preview-unavailable"><a className="brand" href={previewLink('/')}>共振 · 集成电路与电子社区</a><h1>{unavailable?'这个功能将在正式网站开放':'预览中没有这个页面'}</h1><p>你可以先浏览项目、精选、课程和开发资源，体验筛选与阅读界面。</p><p>此预览不会注册账号、接收投稿或发送邮件。欢迎通过联系页反馈界面建议。</p><div><a className="button dark" href={previewLink('/')}>返回项目广场</a><a className="button outline" href={previewLink('/courses')}>看看课程</a><a href={previewLink('/contact')}>联系维护者</a></div></div>:<Community key={route} view={view} entityId={entityId} lessonId={lessonId}/>}</>;
}
createRoot(document.getElementById('root')!).render(<App/>);
