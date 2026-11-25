import { NextRequest } from "next/server";
const api=process.env.API_INTERNAL_URL || "http://127.0.0.1:8080";
async function proxy(request:NextRequest,context:{params:Promise<{path:string[]}>}){
  const method=request.method;
  const origin=request.headers.get("origin");
  if(!["GET","POST","PATCH","PUT","DELETE"].includes(method)) return Response.json({error:"不支持的请求方法"},{status:405});
  if(method!=="GET" && origin && origin!==request.nextUrl.origin) return Response.json({error:"跨站请求已拦截"},{status:403});
  const token=request.cookies.get("socialtask_session")?.value;
  if(!token) return Response.json({error:"请先登录"},{status:401});
  const {path}=await context.params;
  if(!path || path.some(item=>item===".." || item==="." || !/^[\w-]+$/.test(item))) return Response.json({error:"无效接口路径"},{status:400});
  const pathName=path.map(encodeURIComponent).join("/");
  const target=`${api}/api/v1/${pathName}${request.nextUrl.search}`;
  const headers=new Headers({Authorization:`Bearer ${token}`});
  const contentType=request.headers.get("Content-Type");if(contentType)headers.set("Content-Type",contentType);
  try {
    const response=await fetch(target,{method,headers,body:method==="GET"?undefined:await request.arrayBuffer(),cache:"no-store",redirect:"manual"});
    const forward=new Headers({"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
    for(const key of ["content-type","content-disposition"]) {const value=response.headers.get(key);if(value)forward.set(key,value);}
    return new Response(response.body,{status:response.status,headers:forward});
  }catch{return Response.json({error:"业务 API 暂不可用，请检查服务连接"},{status:502});}
}
export const GET=proxy;export const POST=proxy;export const PATCH=proxy;export const PUT=proxy;export const DELETE=proxy;
