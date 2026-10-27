export const linkTypes=[['repository','代码仓库'],['eda','EDA工程'],['drive','资源包 / 网盘'],['video','演示视频'],['demo','在线体验'],['other','其他资料']] as const;
export function linkLabel(link:{type?:string;label?:string}){return link.type==='other'?link.label??'其他资料':linkTypes.find(([type])=>type===link.type)?.[1]??link.label??'项目资料';}
