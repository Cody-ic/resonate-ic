import Community from "../community";
import { notFound } from "next/navigation";
export default async function Page({params}:{params:Promise<{section:string}>}){const {section}=await params;if(!["resource-drafts","feedback","notifications","admin","verify-email","reset-password","login","register","featured","resources","forum","submit","dashboard","about"].includes(section))notFound();return <Community view={section as any}/>;}

