"""Import a reviewed course snapshot, without changing the original publication."""
import argparse, hashlib, html, json, re, uuid
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--source',required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
source=Path(args.source).resolve()
tutorial=source/'tutorial'
course_map=json.loads((tutorial/'course-map.json').read_text(encoding='utf-8'))
version=course_map['version']
assert re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?',version)
course_id='c1000000-0000-4000-8000-000000000001'
revision_id='d1000000-0000-4000-8000-000000000001'
project_id='a1000000-0000-4000-8000-000000000002'
base=f'/course-content/smartwatch/{version}'
destination=root/'public'/base.lstrip('/')
metadata_path=root/'content'/'smartwatch-import.json'
allowed={'.html','.css','.js','.json','.svg','.png','.bmp','.md','.txt','.c','.h','.dart','.py','.yaml'}
files=[]
for path in sorted(tutorial.rglob('*')):
    if not path.is_file() or path.is_symlink() or any(p.startswith('.') or p=='__pycache__' for p in path.relative_to(tutorial).parts): continue
    if path.suffix.lower() not in allowed: continue
    data=path.read_bytes()
    files.append((path.relative_to(tutorial).as_posix(),data,hashlib.sha256(data).hexdigest()))
source_digest=hashlib.sha256('\n'.join(f'{name}\t{digest}' for name,_,digest in files).encode()).hexdigest()
if version!='0.2.0':revision_id=str(uuid.uuid5(uuid.UUID(course_id),version+':'+source_digest))
if metadata_path.exists():
    previous=json.loads(metadata_path.read_text(encoding='utf-8'))
    if previous['sourceDigest']!=source_digest and previous['version']==version:
        raise SystemExit('Snapshot changed under an existing version. Preserve it and import a new version instead.')

def text(value):return html.unescape(re.sub('<[^>]+>','',value)).strip()
groups=[{'title':title,'description':description,'lessons':[]} for title,description in [
    ('主线一 · 裸机开发','从外设与采样开始，把独立实验接回手表。'),
    ('主线二 · FreeRTOS','从函数与多任务到调度、通信、资源和整机组织。'),
    ('支线一 · 显示驱动与 LVGL','完成 SPI 后，可以开始屏幕与界面实验。'),
    ('支线二 · CH582M 与蓝牙桥接','沿串口、事件循环、GATT 与双向消息理解蓝牙桥接。'),
    ('支线三 · Dart 与 Flutter App','先从模拟电量小应用开始，再接入协议与蓝牙。'),
    ('支线四 · 数据、训练与部署','从 Python、数据与训练走到评估和 STM32 部署。'),
    ('支线五 A · 原型学习与个性化','从二维类别中心理解 embedding、会话、评估与备份。'),
    ('支线五 B · 固件升级设计','用普通文件演练暂存、试运行与回退；整机 OTA 尚未实现。')]]
lesson_paths={}
for lesson in course_map['lessons']:
    relative=lesson['path'];page=(tutorial/relative).read_text(encoding='utf-8')
    assert (tutorial/relative).resolve().is_relative_to(tutorial)
    title=text(re.search(r'<h1[^>]*>(.*?)</h1>',page,re.S).group(1))
    if relative.startswith('main/'):
        group=1 if '/freertos/' in relative or relative in ['main/14-freertos.html','main/15-sync.html'] else 0
    else:
        prefix=relative.split('/')[1]
        group={'lvgl':2,'ch582m':3,'flutter':4,'ai':5,'proto':6,'ota':7}[prefix]
    desc=re.search(r'<meta\s+name="description"\s+content="([^"]*)"',page)
    groups[group]['lessons'].append({'id':lesson['id'],'title':title,'summary':html.unescape(desc.group(1))[:500] if desc else '',
        'body':'','practice':'computer' if group>=4 else 'board',
        'links':[{'type':'other','label':'章节源文件与引用','url':f'https://github.com/Cody-ic/SmartWatch/blob/tutorial-v{version}/tutorial/{relative}'}]})
    lesson_paths[lesson['id']]=relative
assert sum(len(g['lessons']) for g in groups)==course_map['lesson_count']==79
course={'title':'从外设到端侧 AI：基于 SmartWatch 的嵌入式实践',
    'summary':'以一块智能手表为贯穿案例，从裸机、FreeRTOS，逐步探索显示、蓝牙、手机应用、模型部署与原型个性化。',
    'category':'嵌入式系统','tags':['STM32U5','FreeRTOS','端侧AI'],'version':f'v{version} 预览版','stage':'连载中',
    'description':'基于 SmartWatch 项目的图解与交互课程。主线两章共29篇，五条支线共50篇，共79篇课程。通过原理、独立实验和项目源码对照，把外设、系统、通信与算法逐层接起来。各支线可按前置要求选择学习。',
    'prerequisites':'已经掌握 C 的变量、数组、函数和基本指针。Dart 与 Python 在各自支线补充入门；进入硬件实验前按对应章节准备工具与板卡。',
    'outcomes':'能沿数据采集、任务组织、蓝牙消息、手机显示和模型推理理解完整嵌入式系统；完成独立实验，并能定位 SmartWatch 中的对应实现。',
    'hardware':'主控 STM32U575、CH582M 蓝牙桥接、LSM6DSOX、MAX30102、GC9A01 圆屏与麦克风。语言、算法和部分 App 实验可在电脑完成；每章所需硬件以正文为准。',
    'instructions':'先阅读学习地图与起点，再沿裸机、FreeRTOS 两条主线学习；完成对应前置后选择支线。章节中的交互可直接在浏览器操作；运行 C、Python、Dart 或 Flutter 示例需要各章说明的工具环境。学习进度仅保存在当前浏览器。',
    'evidence':'发布说明记录了页面链接、电脑示例与软件流程验证。课程图示属于教学示意，不代表整机已完成硬件验收。',
    'limitations':'当前为 v0.2.0 预览版。模型实际效果需要真实佩戴数据；固件升级支线使用普通文件模拟，当前手表尚未实现完整固件 OTA。',
    'license':'遵循 SmartWatch 仓库的许可与各引用资料声明',
    'links':[{'type':'repository','label':'SmartWatch 项目源码','url':'https://github.com/Cody-ic/SmartWatch'},
             {'type':'other','label':f'教程离线包 v{version}','url':f'https://github.com/Cody-ic/SmartWatch/releases/tag/tutorial-v{version}'}],
    'fileIds':[],'projectId':project_id,'projectRevisionId':'b2000000-0000-4000-8000-000000000002','modules':groups}
bar=f'<div class="relay-coursebar"><a href="/courses/{course_id}">← 课程概览</a><a href="/projects/{project_id}">SmartWatch 项目</a><span>v{version} 预览版</span></div>'
css='.relay-coursebar{position:sticky;top:0;z-index:40;height:40px;display:flex;align-items:center;gap:20px;padding:0 28px;background:var(--paper);border-bottom:1px solid var(--line);font-size:12px}.relay-coursebar a{text-decoration:none}.relay-coursebar span{margin-left:auto;color:var(--muted)}header.top{top:40px}aside{top:108px;height:calc(100vh - 108px)}html{scroll-padding-top:130px}@media(max-width:760px){.relay-coursebar{padding:0 14px;gap:12px;font-size:11px}.relay-coursebar span{font-size:10px}aside{top:108px}}@media print{.relay-coursebar{display:none}}'
manifest=[]
for relative,data,original_hash in files:
    target=destination/relative
    if target.suffix=='.html':
        page=data.decode('utf-8')
        depth=len(Path(relative).parts)-1
        sheet='../'*depth+'assets/_relay.css'
        page=page.replace('</head>',f'<link rel="stylesheet" href="{sheet}"><script defer src="/course-reading.js"></script></head>',1)
        page=re.sub(r'(<body\b[^>]*>)',lambda m:m.group(1)+bar,page,count=1)
        data=page.encode('utf-8')
    if target.exists() and target.read_bytes()!=data:
        raise SystemExit(f'Refusing to overwrite existing snapshot file: {target}')
    target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    manifest.append({'path':relative,'sourceSha256':original_hash,'servedSha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
(destination/'assets'/'_relay.css').write_text(css,encoding='utf-8')
metadata={'courseId':course_id,'revisionId':revision_id,'projectId':project_id,'version':version,'basePath':base,
    'sourceDigest':source_digest,'lessonPaths':lesson_paths,'files':manifest,'course':course,'displayOverlay':'course-reading-v1'}
metadata_path.parent.mkdir(exist_ok=True)
metadata_path.write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
history_path=root/'content'/'smartwatch-imports'/f'{version}.json'
history_path.parent.mkdir(exist_ok=True)
serialized=json.dumps(metadata,ensure_ascii=False,indent=2)+'\n'
if history_path.exists():
    archived=json.loads(history_path.read_text(encoding='utf-8'))
    # Site reading controls may change served bytes, while the upstream course
    # and its original archive stay immutable.
    source_keys=['courseId','revisionId','projectId','version','basePath','sourceDigest','lessonPaths','course']
    same_source=all(archived.get(key)==metadata.get(key) for key in source_keys)
    same_files={item['path']:item['sourceSha256'] for item in archived['files']}=={item['path']:item['sourceSha256'] for item in manifest}
    if not same_source or not same_files:
        raise SystemExit('Refusing to replace an archived course manifest. Import a new version.')
else:
    history_path.write_text(serialized,encoding='utf-8')
registry_path=root/'content'/'trusted-courses.json'
registry=json.loads(registry_path.read_text(encoding='utf-8')) if registry_path.exists() else []
entry={key:metadata[key] for key in ['courseId','revisionId','version','basePath','sourceDigest','lessonPaths']}
existing=next((r for r in registry if r['revisionId']==revision_id),None)
if existing and existing!=entry:raise SystemExit('Refusing to rebind trusted HTML for an existing published revision.')
if not existing:registry.append(entry)
registry_path.write_text(json.dumps(registry,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
license_file=source/'LICENSE'
if license_file.exists():(destination/'PROJECT-LICENSE.txt').write_bytes(license_file.read_bytes())
print(json.dumps({'files':len(files),'lessons':79,'version':version,'sourceSha256':source_digest,'destination':str(destination)},ensure_ascii=False))
