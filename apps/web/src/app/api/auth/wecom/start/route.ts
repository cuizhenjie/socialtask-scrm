import {NextRequest,NextResponse} from "next/server";
import {oauthCookie,oauthCookieOptions} from "@/lib/wecom-oauth";
import {startWecomLogin} from "@/lib/api/handlers/wecom";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
  const result=await startWecomLogin(req.nextUrl.searchParams.get("next"));
  const response=new NextResponse(null,{status:303,headers:{Location:result.location,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
  response.cookies.set(oauthCookie,result.attempt?JSON.stringify(result.attempt):"",{...oauthCookieOptions,maxAge:result.attempt?300:0});
  return response;
}
