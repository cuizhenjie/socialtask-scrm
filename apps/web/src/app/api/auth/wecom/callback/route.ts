import {NextRequest,NextResponse} from "next/server";
import {finishOAuth,oauthCookie,oauthCookieOptions,oauthSessionOptions} from "@/lib/wecom-oauth";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const api=process.env.API_INTERNAL_URL || "http://127.0.0.1:8080";
export async function GET(req:NextRequest){
  const result=await finishOAuth(api,req.nextUrl.searchParams,req.cookies.get(oauthCookie)?.value);
  // Relative redirects never trust Host, X-Forwarded-Host, or callback query values.
  const response=new NextResponse(null,{status:303,headers:{Location:result.location,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
  response.cookies.set(oauthCookie,"",{...oauthCookieOptions,maxAge:0});
  if(result.accessToken)response.cookies.set("socialtask_session",result.accessToken,oauthSessionOptions);
  return response;
}
