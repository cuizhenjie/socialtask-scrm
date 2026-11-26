import { reviewTemplate } from "./workflows.js";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_RESPONSE_BYTES = 32768;
const OPT_IN = "SOCIALTASK_LLM_ENABLED";

export function modelConfig(env) {
  if (env[OPT_IN] !== "1") throw new Error("外部模型默认关闭；显式启用需设置 SOCIALTASK_LLM_ENABLED=1");
  const base = env.SOCIALTASK_LLM_BASE_URL?.trim(), endpoint = env.SOCIALTASK_LLM_ENDPOINT?.trim();
  if (Boolean(base) === Boolean(endpoint)) throw new Error("需且仅需配置 BASE_URL 或 ENDPOINT");
  let url;
  try { url = new URL(base || endpoint); } catch { throw new Error("模型地址格式无效"); }
  if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || url.protocol === "http:" && LOOPBACK.has(url.hostname))) {
    throw new Error("模型地址须用 HTTPS（本机允许 HTTP），且不能含凭据、查询或片段");
  }
  if (base) url.pathname = url.pathname.replace(/\/+$/, "") + "/chat/completions";
  const model = env.SOCIALTASK_LLM_MODEL?.trim();
  const key = env.SOCIALTASK_LLM_API_KEY;
  if (!model || model.length > 160 || /[\u0000-\u001f]/.test(model)) throw new Error("需配置合法的 SOCIALTASK_LLM_MODEL");
  if (!key || key.length > 2048 || /[^\x21-\x7e]/.test(key)) throw new Error("需配置合法的 SOCIALTASK_LLM_API_KEY");
  return { destination: url.toString(), model, key };
}

export function reviewPayload(template) {
  const review = reviewTemplate(template);
  if (!review.valid) throw new Error("模板必须先通过本地结构校验");
  // Deliberately omit the entire ticket, template identifier/title, labels, field keys and any values.
  return { fields:template.fields.map(({phase,kind,required},i)=>({position:i+1,phase,kind,required})) };
}

async function jsonFromBoundedResponse(response) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("模型返回过大");
  }
  if (!response.body) throw new Error("模型未返回 JSON");
  const reader=response.body.getReader(), chunks=[];
  let size=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if (size>MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("模型返回过大"); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks,size).toString("utf8")); }
  catch { throw new Error("模型未返回有效 JSON"); }
}

export async function reviewWithModel(template, { confirmed, env = process.env, fetchImpl = globalThis.fetch, signal } = {}) {
  if (confirmed !== true) throw new Error("需人工确认发送脱敏字段结构");
  const {destination,model,key}=modelConfig(env);
  const sanitized=reviewPayload(template);
  const timeout=AbortSignal.timeout(15000);
  const abort=signal ? AbortSignal.any([signal,timeout]) : timeout;
  let response;
  try {
    response=await fetchImpl(destination,{
      method:"POST", redirect:"error", signal:abort,
      headers:{ "content-type":"application/json", authorization:`Bearer ${key}` },
      body:JSON.stringify({model,stream:false,messages:[
        {role:"system",content:"仅评审工单字段的顺序、下发/回传区分和必填设置。只给建议，不宣称发布、真实联调或通过验收；不要推断客户、业务内容或上传资料。中文，最多三条建议。"},
        {role:"user",content:JSON.stringify(sanitized)}
      ]})
    });
  } catch { throw new Error(abort.aborted ? "模型评审已取消或超时" : "模型接入失败（不跟随重定向）"); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`模型评审请求失败（HTTP ${response.status}）`);
  }
  let result;
  try { result=await jsonFromBoundedResponse(response); }
  catch (e) { if (abort.aborted) throw new Error("模型评审已取消或超时"); throw e; }
  const advice=result?.choices?.[0]?.message?.content;
  if (typeof advice!=="string" || advice.trim()==="") throw new Error("模型返回未包含 Chat Completions 文本内容");
  // Return as data; prevent a provider echoing the credential and avoid terminal control codes.
  return { advisoryOnly:true, advice:advice.replaceAll(key,"[REDACTED]").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g,"").trim().slice(0,4000) };
}
