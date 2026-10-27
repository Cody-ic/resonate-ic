import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const args=process.argv.slice(2);
if(!args.includes('--local'))throw new Error('Only local preview seeding is supported; pass --local.');
const owner='local_seedy',now=Date.now(),quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const sources=[
  {id:'a1000000-0000-4000-8000-000000000001',title:'RT1064 视觉智能车',category:'智能车与控制',summary:'从六层PCB到视觉路线识别、路径记忆与闭环控制，正在为实际参赛持续完善。',tags:['RT1064','机器视觉','六层PCB'],hardware:'RT1064主控、摄像头、编码器、舵机及电机。具体配置以各版本文档为准。',description:'一个由硬件、固件、标定与试跑共同推进的智能车项目。视觉部分持续处理单边路线、透视、路口和背景干扰，并将真实观测与推算结果分别记录。\n初始收录页面：项目仍在开发和参赛准备阶段，不能据此认定已获奖或全部功能成熟。',url:'https://github.com/Cody-ic/smart-car-pcb'},
  {id:'a1000000-0000-4000-8000-000000000002',title:'SmartWatch 智能手表',category:'嵌入式系统',summary:'连接传感器、FreeRTOS、端侧AI与手机应用，探索从外设入门到个性化识别的学习路径。',tags:['STM32U5','FreeRTOS','端侧AI'],hardware:'STM32U5、CH582M、LSM6DSOX、MAX30102、圆屏与麦克风。',description:'由STM32手表主控、CH582M蓝牙桥接和配套应用组成。覆盖活动识别、语音关键词、睡眠相关算法与原型个性化。\n目前工程和教程仍需完善，已知代码问题、模型依赖与验证范围需要进一步整理。初始页面尚未提供公开工程包。'},
  {id:'a1000000-0000-4000-8000-000000000003',title:'FPGA 空中超声触觉',category:'FPGA',summary:'通过超声阵列探索空中触觉图形显示，让电子系统的交互从屏幕走向空间。',tags:['FPGA','超声阵列','触觉交互'],hardware:'FPGA与超声换能器阵列，硬件细节以项目仓库为准。',description:'面向FPGA竞赛的空中超声触觉图形显示项目。手机端提交图形，板端承担高速扫描和设备控制。\n初始收录页只介绍方向，完成状态和具体复现步骤以仓库当前文档为准。',url:'https://github.com/Cody-ic/fpga-air-haptics'},
  {id:'a1000000-0000-4000-8000-000000000004',title:'虚拟民防体验馆',category:'创意软件',summary:'把民防知识变成可以点击、拖动和体验的互动展项，一次关于网页科普的探索。',tags:['互动科普','原生JavaScript','创意作品'],hardware:'浏览器，无需专用硬件。',description:'把参观中见到的民防互动展项转化为网页体验，包括知识问答、警报试听和应急情景互动。以创意软件作品收录。\n科普演示不代替专业培训。具体内容和使用方式以项目仓库为准。',url:'https://github.com/Cody-ic/jiangsu-minfang-hall',demo:'https://cody-ic.github.io/jiangsu-minfang-hall/'}
];
let sql=`INSERT INTO users(id,name,created_at) VALUES(${quote(owner)},'Cody-ic',${now}) ON CONFLICT(id) DO NOTHING;\n`;
for(const [i,p] of sources.entries()){
  const rid=p.id.replace('a1000000','b1000000');
  const body={title:p.title,summary:p.summary,category:p.category,tags:p.tags,version:'初始收录',stage:p.demo?'可体验':'进行中',description:p.description,hardware:p.hardware,
    instructions:p.url?'本页为初始目录收录。请进入项目仓库查看对应版本的环境、硬件配置和运行说明；网站内的完整复现教程正在整理。':'公开资料与复现教程正在整理。本页仅作项目介绍，暂不能据此完成复现。',
    evidence:'初始目录收录，不表示本站已独立复现，也不作为精选或获奖证据。',limitations:'工程示意封面不是实物照片。项目状态与使用限制应以作者更新的具体版本说明为准。',license:'以项目原始许可和作者说明为准',links:[...(p.url?[{type:'repository',label:'项目仓库',url:p.url}]:[]),...(p.demo?[{type:'demo',label:'在线体验',url:p.demo}]:[])],fileIds:[]};
  const snapshot=JSON.stringify(body),hash=createHash('sha256').update(snapshot).digest('hex'),time=now-i*1000;
  sql+=`INSERT INTO projects(id,owner_id,kind,head_id,published_id,created_at,updated_at) VALUES(${quote(p.id)},${quote(owner)},'project',${quote(rid)},${quote(rid)},${time},${time}) ON CONFLICT(id) DO NOTHING;\n`;
  sql+=`INSERT INTO revisions(id,project_id,number,snapshot,digest,status,created_at) VALUES(${quote(rid)},${quote(p.id)},1,${quote(snapshot)},${quote(hash)},'published',${time}) ON CONFLICT(id) DO NOTHING;\n`;
}
mkdirSync('outputs',{recursive:true});writeFileSync('outputs/local-seed.sql',sql);
const result=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--file','outputs/local-seed.sql'],{stdio:'inherit'});
process.exit(result.status??1);
