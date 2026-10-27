import {ArrowRight,ArrowUpRight,Check,Layers3} from "lucide-react";
import {criteriaLabels} from "../lib/domain";

const descriptions={
  competition:"提供一套可以直接用于参赛，或能显著简化比赛准备与实现的工程。重点看后来者能否真正复用这些成果，帮助学院同学参加电赛、嵌赛、智能车等竞赛。",
  teaching:"有清晰的学习主线，能帮助同学理解原理、动手实践，并逐步建立各个模块与系统层次之间的联系。基于一个具体项目展开的完整教程，同样可以体现教学意义。",
  depth:"在硬件设计、算法、系统架构、可靠性或工程实现等方面，有足够深入的技术积累，能让后来者学到有分量的方法与经验。",
  creativity:"在问题选择、交互形式、技术组合或实现思路上有鲜明创意，呈现值得分享和继续探索的新想法。",
};

export default function StandardsContent(){
  return <section className="standards-page">
    <header className="standards-heading"><div className="eyebrow">COLLECTION & SELECTION</div><h1>收录与推荐标准</h1><p>把正在做的分享出来，也让值得复用的作品更容易被找到。</p></header>
    <section className="standards-admission"><span className="standards-icon"><Layers3 size={22}/></span><div><h2>什么作品可以发布？</h2><p>以嵌入式、FPGA 和电子系统项目为主要内容，也收录有创意的软件作品。进行中的项目可以发布，请如实说明目前完成了什么、还有哪些局限。</p><p>项目介绍、硬件与环境是正文的基础内容。优先推荐通过 GitHub 仓库开源，保留版本记录、使用说明和许可声明。资料也可以来自其他代码平台、EDA 工程、网盘、视频或上传的资源包；教程可以关联项目，也可以在课程栏目独立发布。</p></div></section>
    <section className="standards-threshold"><div className="eyebrow">THE FOUNDATION</div><h2>精选的基本门槛</h2><div><span><Check size={17}/>文档清晰</span><span><Check size={17}/>可以复现</span></div><p>资料足以让后来者理解项目，并具备复现条件。说明可以放在站内正文，也可以由关联的仓库或工程文档提供。</p></section>
    <div className="standards-section-heading"><h2>再满足以下任意一项</h2><p>四个方向，满足其中一项即可。</p></div>
    <div className="standards-criteria">{Object.entries(criteriaLabels).map(([key,label],index)=><section id={key} key={key}><span className="criteria-number">0{index+1}</span><div><h3>{label}</h3><p>{descriptions[key as keyof typeof descriptions]}</p></div></section>)}</div>
    <section className="standards-process"><h2>精选如何确定？</h2><p>管理员核对基本门槛与推荐理由后，将符合条件的项目加入精选，并记录推荐依据。精选绑定具体的公开版本，更新后需重新核对。</p><p>课程有独立的学习栏目；可复用的驱动、硬件模块、算法组件和测试工具可放入开发资源栏目。</p></section>
    <div className="standards-actions"><a className="button dark" href="/featured">浏览精选项目<ArrowRight size={15}/></a><a className="button outline" href="/submit">分享我的作品<ArrowUpRight size={15}/></a></div>
  </section>;
}
