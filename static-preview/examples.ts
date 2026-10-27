// Hand-written public examples, not an export of the live database.
const now=Date.UTC(2026,9,28);
const common={ownerId:'example-author',author:'共振示例',status:'published',version:'v1.0',stage:'可复现',updatedAt:now,createdAt:now,tags:[],sources:[{name:'自主项目',division:'',year:2026,detail:'界面示例'}],platforms:[],links:[],fileIds:[],sections:[],coverFileId:null,license:'仅为界面展示编写的示例说明，不提供可制造文件。',limitations:'这是静态界面示例，不代表真实作品的性能、可靠性或审核结论。',description:'把设计过程、验证依据与经验整理成可阅读的资料，让后来者能理解每一步取舍。',hardware:'工具和硬件条件应由作者在正式投稿时注明。',instructions:'这里展示正式网站的阅读结构。实际工程应提供版本、依赖、构建方式与复现步骤。',evidence:'示例内容没有经过工程实测，请勿据此采购或制作。'};
export const projects=[
 {...common,id:'example-watch',revisionId:'example-watch-v1',kind:'project',title:'示例 · SmartWatch 电子手表',summary:'从屏幕驱动到交互界面，记录一个可穿戴电子系统的设计过程。',category:'嵌入式系统',tags:['屏幕显示','低功耗'],platforms:[{name:'ST',family:'mcu'}]},
 {...common,id:'example-fpga',revisionId:'example-fpga-v1',kind:'project',title:'示例 · FPGA 波形发生器',summary:'通过数字电路理解信号生成，分享模块划分、仿真方法与验证思路。',category:'FPGA',tags:['数字电路','信号处理'],platforms:[{name:'赛灵思',family:'fpga'}]},
 {...common,id:'example-visual',revisionId:'example-visual-v1',kind:'project',title:'示例 · 信号可视化实验室',summary:'把抽象的采样和频率变成可以拖动、观察和比较的交互实验。',category:'创意软件',tags:['交互实验','教学'],featured:{criteria:['teaching'],evidence:'仅演示精选卡片样式，不代表对真实作品的推荐。',date:now}},
 {...common,id:'example-resource',revisionId:'example-resource-v1',kind:'resource',title:'示例 · 串口数据绘图组件',summary:'面向实验数据观察的可复用组件，展示资源的使用说明与验证记录。',category:'创意软件',tags:['串口','数据可视化'],verification:{steps:['none'],scope:'这是资源展示界面的示例，未附带可执行的资源包。',unverified:'全部工程功能；本条不提供可靠性结论。',evidence:''}},
];
export const course={...common,id:'example-course',revisionId:'example-course-v1',kind:'course',title:'示例 · 从外设驱动到电子系统',summary:'一条从读懂引脚、搭建最小实验到整理验证记录的学习路线。',category:'嵌入式系统',stage:'已完结',tags:['入门','实验'],projectId:null,description:'这套示例课程用来展示学习目录、章节阅读与前后章导航。正式课程应包含完整讲解、实验条件与可核验结果。',prerequisites:'了解 C 语言的基本语法。',outcomes:'学会描述实验条件、建立最小可复现案例，并记录结果。',modules:[{id:'basics',title:'建立自己的实验方法',summary:'从最小系统开始，形成有证据的调试习惯。',lessons:[
 {id:'observe',title:'先明确要观察什么',summary:'把“不能用”拆成能描述、能重复的现象。',practice:'computer',links:[],body:'这是用于展示阅读界面的示例章节。\n\n先写下预期现象，再记录实际现象。一次实验只改变一个条件，便于判断差异来自哪里。\n\n一份有用的记录通常包含版本、环境、操作步骤、结果和仍然不确定的地方。'},
 {id:'minimal',title:'搭建最小实验',summary:'缩小问题范围，再逐步加入功能。',practice:'board',links:[],body:'这是用于展示阅读界面的示例章节。\n\n在连接具体硬件前，先核对供电条件与引脚定义。使用作者提供的完整说明，并在自己的环境中重新验证。\n\n这里不提供真实电路与固件，请勿将示例文字当作制作依据。'},
 {id:'share',title:'把经验留给后来者',summary:'用清晰的说明和可追踪版本组织资料。',practice:'computer',links:[],body:'这是用于展示阅读界面的示例章节。\n\n推荐用 GitHub 仓库公开代码，保留版本与变更记录。\n\n整理依赖、构建方法、验证结果与局限，让阅读者知道哪些已经完成、哪些仍需检查。'},
 ]}]};
