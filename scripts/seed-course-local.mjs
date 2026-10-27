import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
if(!process.argv.includes('--local'))throw new Error('Pass --local; this importer never writes remote data.');
const snapshot=JSON.parse(readFileSync('content/smartwatch-import.json','utf8'));
const registry=JSON.parse(readFileSync('content/trusted-courses.json','utf8'));
const owner='local_seedy',now=Date.now(),quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const hash=value=>createHash('sha256').update(value).digest('hex');
const pid=snapshot.projectId,rid='b2000000-0000-4000-8000-000000000002';
const project={title:'SmartWatch 智能手表',summary:'从 STM32U575 手表主控、CH582M 蓝牙桥接到 Flutter App，以完整工程串起外设、FreeRTOS、端侧 AI 与个性化识别。',category:'嵌入式系统',tags:['STM32U5','FreeRTOS','端侧AI'],version:'公开工程 / 教程 v0.2.0',stage:'进行中',
description:'基于 STM32U575 与 CH582M 的智能手表，配套 Flutter 手机应用与四层圆形 PCB。工程覆盖传感器采样、显示、蓝牙协议、活动识别、关键词与睡眠相关算法。图解课程作为独立内容发布，并与本项目版本关联。\nLSM6DSOX 内置 MLC 决策树用于辅助活动标签与分歧复核；原型学习用于讨论和实现个性化流程。',
hardware:'STM32U575、CH582M、LSM6DSOX、MAX30102、GC9A01 圆屏、麦克风与四层圆形 PCB；手机端使用 Flutter。',
instructions:'进入项目仓库，按根 README 和各模块 README 准备 STM32CubeIDE、MounRiver 与 Flutter 环境。STM32 工程在 firmware/stm32，蓝牙桥接在 firmware/ch582m，手机端在 app/flutter_app。先分别完成编译与软件验证，再按对应版本硬件配置进行烧录和三端联调。初学者可从关联课程的学习地图开始，先做独立实验，再逐步接回实际手表。',
evidence:'项目文档记录了两端固件和 Android Debug 构建、生产 C 回归等软件验证。板卡曾完成上电检查，但已有 Flash 故障尚未定位，整机功能与真实佩戴效果未完成验收。',
limitations:'硬件和整机功能仍需验证；AI 识别效果需要真实佩戴数据。MLC 的 other 标签不等于静止。完整固件 OTA 尚未实现，课程升级支线仅演示普通文件模型。工程示意图不代表实物照片。',
license:'遵循仓库现有许可与各第三方组件版权声明',links:[{type:'repository',label:'完整项目仓库',url:'https://github.com/Cody-ic/SmartWatch'},{type:'other',label:'教程离线包 v0.2.0',url:'https://github.com/Cody-ic/SmartWatch/releases/tag/tutorial-v0.2.0'}],fileIds:[]};
const pbody=JSON.stringify(project),cbody=JSON.stringify(snapshot.course);
let sql=`INSERT INTO users(id,name,created_at) VALUES(${quote(owner)},'Cody-ic',${now}) ON CONFLICT(id) DO UPDATE SET name=CASE WHEN users.name='Seedy' THEN excluded.name ELSE users.name END;\n`;
sql+=`INSERT INTO revisions(id,project_id,number,snapshot,digest,status,created_at) VALUES(${quote(rid)},${quote(pid)},2,${quote(pbody)},${quote(hash(pbody))},'published',${now}) ON CONFLICT(id) DO NOTHING;\n`;
sql+=`UPDATE projects SET head_id=${quote(rid)},published_id=${quote(rid)},updated_at=${now} WHERE id=${quote(pid)} AND head_id='b1000000-0000-4000-8000-000000000002';\n`;
sql+=`INSERT INTO projects(id,owner_id,kind,head_id,published_id,created_at,updated_at) VALUES(${quote(snapshot.courseId)},${quote(owner)},'course',${quote(snapshot.revisionId)},${quote(snapshot.revisionId)},${now},${now}) ON CONFLICT(id) DO NOTHING;\n`;
sql+=`INSERT INTO revisions(id,project_id,number,snapshot,digest,status,created_at) SELECT ${quote(snapshot.revisionId)},${quote(snapshot.courseId)},COALESCE(MAX(number),0)+1,${quote(cbody)},${quote(hash(cbody))},'published',${now} FROM revisions WHERE project_id=${quote(snapshot.courseId)} ON CONFLICT(id) DO NOTHING;\n`;
sql+=`UPDATE projects SET head_id=${quote(snapshot.revisionId)},published_id=${quote(snapshot.revisionId)},updated_at=${now} WHERE id=${quote(snapshot.courseId)} AND head_id IN (${registry.filter(s=>s.courseId===snapshot.courseId).map(s=>quote(s.revisionId)).join(',')});\n`;
mkdirSync('outputs',{recursive:true});writeFileSync('outputs/course-seed.sql',sql);
const result=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--file','outputs/course-seed.sql'],{stdio:'inherit'});
process.exit(result.status??1);
