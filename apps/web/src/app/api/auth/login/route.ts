import {NextRequest,NextResponse} from "next/server";
const api=process.env.API_INTERNAL_URL || "http://127.0.0.1:8080";
export async function POST(req:NextRequest){
  const {username,password} = await req.json() as {username?:string,password?:string};
  if(!username || !password) return NextResponse.json({error:"请输入账号和密码"},{status:400});
  try {
    const upstream=await fetch(`${api}/api/v1/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password}),cache:"no-store"});
    const body=await upstream.json();
    if(!upstream.ok) return NextResponse.json(body,{status:upstream.status});
    const result=NextResponse.json({user:body.user,expires_in:body.expires_in});
    result.cookies.set("socialtask_session",body.access_token,{httpOnly:true,secure:process.env.SESSION_COOKIE_SECURE==="true",sameSite:"lax",path:"/",maxAge:body.expires_in || 43200});
    return result;
  } catch {
    return NextResponse.json({error:"登录服务暂不可用，请检查后端连接"},{status:502});
  }
}
