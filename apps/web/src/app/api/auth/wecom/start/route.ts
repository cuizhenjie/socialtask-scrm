import {NextRequest,NextResponse} from "next/server";
import {oauthCookie,oauthCookieOptions,startOAuth} from "@/lib/wecom-oauth";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const api=process.env.API_INTERNAL_URL || "http://127.0.0.1:8080";
export async function GET(req:NextRequest){
  const result=await startOAuth(api,req.nextUrl.searchParams.get("next"));
  const response=new NextResponse(null,{status:303,headers:{Location:result.location,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
  response.cookies.set(oauthCookie,result.attempt?JSON.stringify(result.attempt):"",{...oauthCookieOptions,maxAge:result.attempt?300:0});
  return response;
}
