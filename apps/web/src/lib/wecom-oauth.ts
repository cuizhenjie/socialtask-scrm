import {randomBytes} from "node:crypto";
import {cardReturnPath as cardPath,afterLoginPath} from "./login-return.ts";

// Browser cookie is a proof of possession for the state created by the API.
// The return path from the cookie is used only on failure; on success use the DB-backed state.
export const oauthCookie="__Host-socialtask_wecom_attempt";
export const oauthCookieOptions={httpOnly:true,secure:true,sameSite:"lax" as const,path:"/",maxAge:300};
export const oauthSessionOptions={httpOnly:true,secure:true,sameSite:"lax" as const,path:"/",maxAge:43200};
export type Attempt={browserNonce:string,next:string|null};
export type OAuthResult={location:string,attempt?:Attempt,accessToken?:string};
type Fetcher=typeof fetch;
function nonce(value:unknown):value is string {return typeof value==="string" && /^[0-9a-f]{64}$/.test(value) && value.length===64;}
function validCode(value:string|null):value is string {
  return !!value && Buffer.byteLength(value,"utf8")<=512 && !/[\s\x00-\x1f\x7f-\x9f]/u.test(value);
}
export function parseAttempt(value:string|undefined):Attempt|null {
  try {const a=JSON.parse(value||"");return nonce(a?.browserNonce)?{browserNonce:a.browserNonce,next:cardPath(a.next)}:null;}catch{return null;}
}
function failure(reason:string,next:unknown):OAuthResult {
  const params=new URLSearchParams({wecom_error:reason});const target=cardPath(next);
  if(target)params.set("next",target);return {location:"/login?"+params.toString()};
}
function reason(status:number){return status===404?"disabled":status===403?"unbound":status===400||status===401?"invalid":"unavailable";}
async function post(api:string,path:string,body:object,fetcher:Fetcher){
  return fetcher(`${api}/api/v1/auth/wecom/${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(18000)});
}
export async function startOAuth(api:string,next:unknown,fetcher:Fetcher=fetch):Promise<OAuthResult>{
  const attempt:Attempt={browserNonce:randomBytes(32).toString("hex"),next:cardPath(next)};
  try{
    const r=await post(api,"start",attempt,fetcher);
    if(!r.ok)return failure(reason(r.status),attempt.next);
    const body=await r.json();const url=new URL(body.authorization_url);
    // Only the fixed enterprise OAuth provider may receive a redirect.
    if(url.origin!=="https://open.weixin.qq.com"||url.pathname!=="/connect/oauth2/authorize"||url.username||url.password
      ||url.hash!=="#wechat_redirect"||!nonce(url.searchParams.get("state")))throw new Error("invalid authorization URL");
    return {location:url.href,attempt};
  }catch{return failure("unavailable",attempt.next);}
}
export async function finishOAuth(api:string,params:URLSearchParams,cookie:string|undefined,fetcher:Fetcher=fetch):Promise<OAuthResult>{
  const attempt=parseAttempt(cookie),state=params.get("state"),code=params.get("code");
  if(!attempt||params.getAll("state").length!==1||params.getAll("code").length!==1||!nonce(state)||!validCode(code))
    return failure("invalid",attempt?.next);
  try{
    const r=await post(api,"exchange",{state,browserNonce:attempt.browserNonce,code},fetcher);
    if(!r.ok)return failure(reason(r.status),attempt.next);
    const body=await r.json();
    if(typeof body.access_token!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(body.access_token)||body.access_token.length!==43
      ||body.expires_in!==43200||!body.user||!['admin','manager','author','creator','assistant','support'].includes(body.user.role))throw new Error("invalid session response");
    return {location:afterLoginPath(body.next,body.user.role),accessToken:body.access_token};
  }catch{return failure("unavailable",attempt.next);}
}
