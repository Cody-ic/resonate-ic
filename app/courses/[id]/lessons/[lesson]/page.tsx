import Community from "../../../../community";
export default async function Page({params}:{params:Promise<{id:string;lesson:string}>}){const {id,lesson}=await params;return <Community view="lesson" entityId={id} lessonId={lesson}/>;}
