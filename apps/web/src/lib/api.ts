import {loginUrl} from "./login-return";
export type RecordRow = Record<string, unknown>;
export class ApiError extends Error { constructor(message:string,public status:number){super(message);} }
export async function api<T=RecordRow>(path:string,init:RequestInit = {}):Promise<T> {
  const headers = new Headers(init.headers);
  if(!(init.body instanceof FormData) && init.body && !headers.has("Content-Type")) headers.set("Content-Type","application/json");
  const result = await fetch(`/api/proxy/${path.replace(/^\/+/,"")}`, {...init,headers,cache:"no-store"});
  if(!result.ok) {
    let message=`请求失败（${result.status}）`;
    try { const body=await result.json();message=body.error || body.detail || message;}catch{}
    if(result.status===401 && typeof window!=="undefined") window.location.href=loginUrl(window.location.pathname);
    throw new ApiError(message,result.status);
  }
  if(result.status===204) return {} as T;
  return await result.json() as T;
}
export function jsonPost<T>(path:string,data:unknown){return api<T>(path,{method:"POST",body:JSON.stringify(data)});}
export function jsonPatch<T>(path:string,data:unknown){return api<T>(path,{method:"PATCH",body:JSON.stringify(data)});}
export function formatDate(value:unknown) {
  if(!value) return "—";
  if(typeof value==="number"){
    const numericDate=new Date(value);
    return isNaN(numericDate.getTime())?String(value):numericDate.toLocaleString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Shanghai"});
  }
  let str=String(value);
  // JDBC Timestamp may be JSON epoch milliseconds; DATETIME strings without a zone are UTC on the API.
  if(/^\d{4}-\d{2}-\d{2}T\d\d:\d\d:\d\d(?:\.\d+)?$/.test(str)) str+="Z";
  const date=new Date(str);
  return isNaN(date.getTime())?str:date.toLocaleString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Shanghai"});
}
export const stateMap:Record<string,string>={PENDING:"待处理",REWORK:"退回重做",PAUSED:"人员停用待转派",SUBMITTED:"待核验",COMPLETED:"已完成",STOPPED:"已停止",CANCELLED:"已取消",ACTIVE:"正常",INACTIVE:"停用",APPROVED:"审核通过",DRAFT:"草稿",REJECTED:"已驳回",NEW:"新线索",RESPONDED:"已回复",FOLLOWUP_PENDING:"待回访",REFUSED:"拒绝联系",VERIFIED:"已核验",NOT_CONFIGURED:"未配置",SENT:"平台已接受（非已读）",FAILED:"发送失败",RETRY:"重试中",SENDING:"发送中",UNKNOWN:"发送结果未知（勿重复发送）",ACCEPTED:"平台已接受（非已读）",REDACTED:"正文已清理",BREACHED:"SLA 违约",AT_RISK:"SLA 临期",ON_TRACK:"SLA 正常",MET:"已关闭",URGENT:"紧急",HIGH:"高优先级",NORMAL:"普通优先级",SERVICE_TICKET:"服务工单"};
export const typeMap:Record<string,string>={PUBLISH:"作品发布",OFFICIAL_COMMENT:"官方评论",CONTACT_AUTHOR:"作者私信",CONTACT_ASSISTANT:"助理私信",FOLLOWUP:"次日回访",SERVICE_TICKET:"服务工单",ALL:"所有工单",author:"作者",creator:"素人",assistant:"官方助理",support:"授权客服"};
export const display=(name:unknown,map=stateMap)=>map[String(name)] || String(name ?? "—");
export const dateFuture=(hours=12)=>new Date(Date.now()+hours*3600000).toISOString().replace(/\.\d{3}Z$/,"Z");

export function dateInputFuture(hours=12){
  const d=new Date(Date.now()+hours*3600000);
  const pad=(n:number)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
