import {ArrowUpRight} from "lucide-react";

export default function FeaturedIntro(){
  return <section className="intro featured-intro">
    <div className="intro-copy"><div className="eyebrow"><span/>值得收藏，也值得继续</div><h1>让好作品，<br/>成为新的起点。</h1><p>一套能复用的工程，一条讲得清楚的学习路径。<br/>在竞赛、教学、技术深度或创意中，找到值得接力的作品。</p><a href="/standards">了解精选标准<ArrowUpRight size={15}/></a></div>
    <div className="featured-illustration"><div className="diagram-grid"/>
      <svg viewBox="0 0 480 320" role="img" aria-labelledby="featured-illustration-title">
        <title id="featured-illustration-title">竞赛、教学、技术深度与创意，汇聚为值得复用的工程</title>
        <defs><linearGradient id="collection-board" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f8faf3"/><stop offset="1" stopColor="#e7eedb"/></linearGradient></defs>
        <g fill="none" stroke="#a7ba97" strokeWidth="1.3"><path d="M103 83h39l43 43M378 66h-34l-34 44M104 252h42l40-40M374 254h-32l-33-37"/><circle cx="142" cy="83" r="3" fill="#d5e1ca"/><circle cx="344" cy="66" r="3" fill="#d5e1ca"/><circle cx="146" cy="252" r="3" fill="#d5e1ca"/><circle cx="342" cy="254" r="3" fill="#d5e1ca"/></g>
        <rect x="152" y="104" width="210" height="143" rx="11" fill="#d3dfc7" stroke="#b6c9a6" transform="rotate(-9 257 175)"/>
        <rect x="146" y="95" width="210" height="143" rx="11" fill="#e2ead7" stroke="#b6c9a6" transform="rotate(-4 251 166)"/>
        <rect x="140" y="85" width="210" height="143" rx="11" fill="url(#collection-board)" stroke="#9db88e"/>
        <g stroke="#b9caaa" strokeWidth="1" fill="none"><path d="M159 114h30v22h19M159 127h20v31h29M332 112h-30v24h-20M332 124h-19v35h-31M166 198h28v-22h14M325 198h-30v-22h-13"/><circle cx="159" cy="114" r="2.5"/><circle cx="159" cy="127" r="2.5"/><circle cx="332" cy="112" r="2.5"/><circle cx="332" cy="124" r="2.5"/></g>
        <rect x="207" y="117" width="76" height="65" rx="8" fill="#dfeacf" stroke="#a7be93"/>
        <path d="m245 127 6.4 13 14.3 2.1-10.3 10.1 2.4 14.3-12.8-6.8-12.8 6.8 2.4-14.3-10.3-10.1 14.3-2.1z" fill="#6f8e54" fillOpacity=".2" stroke="#6c8b51" strokeWidth="1.5" strokeLinejoin="round"/>
        <text x="245" y="211" textAnchor="middle" fontSize="11" letterSpacing="3" fill="#728661">可复用的工程</text>
        <g fill="#f5f8ef" stroke="#ccd9bf"><rect x="30" y="64" width="76" height="36" rx="6"/><rect x="370" y="47" width="76" height="36" rx="6"/><rect x="18" y="234" width="100" height="36" rx="6"/><rect x="367" y="236" width="76" height="36" rx="6"/></g>
        <g textAnchor="middle" fontSize="12" fill="#627f51"><text x="68" y="87">竞赛</text><text x="408" y="70">教学</text><text x="68" y="257">技术深度</text><text x="405" y="259">创意</text></g>
      </svg>
    </div>
  </section>;
}
