import {NextRequest,NextResponse} from "next/server";
import {oauthCookie,oauthCookieOptions,oauthSessionOptions} from "@/lib/wecom-oauth";
import {finishWecomLogin} from "@/lib/api/handlers/wecom";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
  const result=await finishWecomLogin(req.nextUrl.searchParams,req.cookies.get(oauthCookie)?.value);
  // Relative redirects never trust Host, X-Forwarded-Host, or callback query values.
  const response=new NextResponse(null,{status:303,headers:{Location:result.location,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
  response.cookies.set(oauthCookie,"",{...oauthCookieOptions,maxAge:0});
  if(result.accessToken)response.cookies.set("socialtask_session",result.accessToken,oauthSessionOptions);
  return response;
}
