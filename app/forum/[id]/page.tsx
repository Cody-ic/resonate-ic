import Community from "../../community";
export default async function Page({params}:{params:Promise<{id:string}>}){return <Community view="topic" entityId={(await params).id}/>;}
