import Community from "../../community";
export default async function Page({params}:{params:Promise<{id:string}>}){return <Community view="detail" entityId={(await params).id}/>;}
