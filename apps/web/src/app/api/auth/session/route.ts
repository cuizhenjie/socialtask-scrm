import {NextRequest,NextResponse} from "next/server";
const api=process.env.API_INTERNAL_URL || "http://127.0.0.1:8080";
export async function GET(req:NextRequest){
  const token=req.cookies.get("socialtask_session")?.value;
  if(!token) return NextResponse.json({error:"未登录"},{status:401});
  try {
    const r=await fetch(`${api}/api/v1/me`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
    return NextResponse.json(await r.json(),{status:r.status,headers:{"Cache-Control":"no-store"}});
  }catch{return NextResponse.json({error:"后端连接失败"},{status:502});}
}
