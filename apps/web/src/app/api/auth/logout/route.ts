import {NextRequest,NextResponse} from "next/server";
const api=process.env.API_INTERNAL_URL || "http://127.0.0.1:8080";
export async function POST(req:NextRequest){
  const token=req.cookies.get("socialtask_session")?.value;
  if(token) {try{await fetch(`${api}/api/v1/auth/logout`,{method:"POST",headers:{Authorization:`Bearer ${token}`},cache:"no-store"});}catch{}}
  const response=NextResponse.json({ok:true});response.cookies.delete("socialtask_session");return response;
}
