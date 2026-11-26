"use client";
import {useEffect,useRef,useState} from "react";
import {RefreshCcw,ShieldCheck,KeyRound,MessageCircle,Settings2,BrainCircuit,ExternalLink} from "lucide-react";
import Link from "next/link";
import {api} from "@/lib/api";
import {PageHeading,Feedback} from "@/components/Ui";
import LlmProfileEditor from "./LlmProfileEditor";
type Check={id:string;label:string;enabled:boolean;configured:boolean;state:string;hint:string};
type Config={configuration_source:string;connection_tested:boolean;checks:Check[];wecom:{corp_id_configured:boolean;agent_id:number;secret_configured:boolean;callback_token_configured:boolean;encoding_aes_key_configured:boolean;public_https:boolean;retention_days:number;retention_valid:boolean};scheduler_enabled:boolean;followup_max_active_tasks:number;external_channels:{id:string;label:string;state:string;hint:string}[];model:{source:string;protocol:string;state:string;variables:string[]}};
const stateLabel:Record<string,string>={DISABLED:"未启用",CONFIGURED:"配置齐备（未联调）",INCOMPLETE:"配置不完整",NOT_CONNECTED:"未接入",EXTERNAL_CONFIGURATION:"宿主独立配置"};
const yn=(v:boolean)=>v?"已设置":"未设置";
export default function Settings(){
 const [data,setData]=useState<Config|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState("");
 const generation=useRef(0);
 async function load(){const id=++generation.current;setBusy(true);setError("");try{const r=await api<Config>("settings");if(generation.current===id)setData(r);}catch(e){if(generation.current===id){setData(null);setError((e as Error).message);}}finally{if(generation.current===id)setBusy(false);}}
 useEffect(()=>{void load();return()=>{generation.current++}},[]);
 return <><PageHeading eyebrow="SYSTEM / CONFIGURATION" title="全局系统设置" description="查看服务端实际配置、消息渠道授权边界及模型配置入口。" actions={<button type="button" className="btn" onClick={load} disabled={busy}><RefreshCcw size={15} className={busy?"spin":""}/> 重新检查</button>}/>
 <div className="info-note"><ShieldCheck size={16}/> 企微配置状态只执行本地检查，不请求企业微信；其密钥由部署环境注入。服务端模型可独立加密保存，只有明确确认的脱敏评审才调用模型。所有已保存密钥均不回显。</div>
 <Feedback error={error}/>{busy&&!data&&<p className="muted" role="status">正在读取配置…</p>}
 {data&&<div className="settings-grid">
 <section className="panel settings-panel"><div className="panel-head"><div><div className="panel-title"><MessageCircle size={18}/> 企业微信自建应用</div><div className="panel-subtitle">出站、回调及 OAuth 独立启停</div></div></div><div className="panel-body">{data.checks.map(c=><div className="settings-check" key={c.id}><div><b>{c.label}</b><small>{c.hint}</small></div><span className={"pill "+(c.state==="CONFIGURED"?"pill-green":c.state==="INCOMPLETE"?"pill-orange":"pill-gray")}>{stateLabel[c.state]||c.state}</span></div>)}</div></section>
 <section className="panel settings-panel"><div className="panel-head"><div><div className="panel-title"><KeyRound size={18}/> 凭证与运行参数</div><div className="panel-subtitle">仅展示是否已配置</div></div></div><div className="panel-body"><dl className="settings-facts">{[["CorpID",yn(data.wecom.corp_id_configured)],["AgentID",data.wecom.agent_id||"未设置"],["Agent Secret",yn(data.wecom.secret_configured)],["Callback Token",yn(data.wecom.callback_token_configured)],["EncodingAESKey",yn(data.wecom.encoding_aes_key_configured)],["HTTPS 公网地址",data.wecom.public_https?"格式合法":"未满足"],["消息保留周期",data.wecom.retention_valid?data.wecom.retention_days+" 天":"配置不合法"],["自动调度",data.scheduler_enabled?"开启":"关闭"],["最大活跃回访工单",data.followup_max_active_tasks]].map(([k,v])=><div key={String(k)}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div></section>
 <section className="panel settings-panel"><div className="panel-head"><div><div className="panel-title"><Settings2 size={18}/> 外部渠道</div><div className="panel-subtitle">不同授权、不同身份空间</div></div></div><div className="panel-body">{data.external_channels.map(c=><div className="settings-check" key={c.id}><div><b>{c.label}</b><small>{c.hint}</small></div><span className={"pill "+(c.state==="CONFIGURED"?"pill-green":c.state==="INCOMPLETE"?"pill-orange":"pill-gray")}>{stateLabel[c.state]||c.state}</span></div>)}<div className="inline-actions"><Link className="btn" href="/admin/messages">企微工作台 <ExternalLink size={14}/></Link><Link className="btn" href="/admin/kf">微信客服 <ExternalLink size={14}/></Link></div></div></section>
 <section className="panel settings-panel"><div className="panel-head"><div><div className="panel-title"><BrainCircuit size={18}/> LLM 模型配置</div><div className="panel-subtitle">DSH 模型与 SocialTask 账号完全独立</div></div></div><div className="panel-body"><p>自定义模型在 DSH 宿主的 Models 配置；独立评审 CLI 支持 OpenAI Chat Completions 兼容协议。下面是宿主环境变量名称，而非服务端实际模型连接状态。</p><dl className="settings-facts">{data.model.variables.map(v=><div key={v}><dt className="code">{v}</dt><dd>宿主管理</dd></div>)}</dl><p className="muted small">默认关闭模型外发，人工批准后仅传脱敏字段结构。不上传工单、会话或客户信息。</p></div></section>
 <LlmProfileEditor/>
 </div>}</>;
}
