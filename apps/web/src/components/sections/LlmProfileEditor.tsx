"use client";
import {useEffect,useState,useRef,type FormEvent} from "react";
import {BrainCircuit,KeyRound,RefreshCcw} from "lucide-react";
import {api,jsonPost} from "@/lib/api";
import {Field,Feedback,SubmitButton,Modal} from "@/components/Ui";
import type {TicketTemplate} from "@/components/TicketFields";
type Profile={version:number;enabled:boolean;endpoint:string;model:string;key_configured:boolean;storage_ready:boolean;allowed_origin_count:number;connection_tested:boolean};
type Review={review:string;fields_sent:number;applied:boolean};
export default function LlmProfileEditor(){
 const[profile,setProfile]=useState<Profile|null>(null),[url,setUrl]=useState(""),[baseUrl,setBaseUrl]=useState(false),[model,setModel]=useState(""),[key,setKey]=useState(""),[enabled,setEnabled]=useState(false),[clearKey,setClearKey]=useState(false);
 const[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[templates,setTemplates]=useState<TicketTemplate[]>([]),[selected,setSelected]=useState(""),[review,setReview]=useState<Review|null>(null),[dialog,setDialog]=useState(false),[confirmed,setConfirmed]=useState(false);
 const lock=useRef(false);
 function apply(p:Profile){setProfile(p);setUrl(p.endpoint);setBaseUrl(false);setModel(p.model);setKey("");setClearKey(false);setEnabled(p.enabled);}
 async function load(){setBusy(true);setError("");try{apply(await api<Profile>("settings/llm"));}catch(e){setProfile(null);setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{void load()},[]);
 async function save(e:FormEvent){e.preventDefault();if(!profile||lock.current)return;lock.current=true;setBusy(true);setError("");setNotice("");setReview(null);
    try{const p=await api<Profile>("settings/llm",{method:"PUT",body:JSON.stringify({expectedVersion:profile.version,enabled,url,baseUrl,model,apiKey:key||null,clearKey})});apply(p);setNotice("模型配置已加密保存；未调用外部接口。");}
    catch(e){setKey("");setError((e as Error).message);}finally{lock.current=false;setBusy(false);}}
 async function openReview(){setError("");setReview(null);setBusy(true);try{setTemplates(await api<TicketTemplate[]>("ticket-templates"));setSelected("");setConfirmed(false);setDialog(true);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function submitReview(e:FormEvent){e.preventDefault();const t=templates.find(x=>x.key===selected);if(!confirmed||!t||lock.current)return;lock.current=true;setBusy(true);setError("");
    try{setReview(await jsonPost<Review>("settings/llm/review",{templateKey:t.key,version:t.version,approveSanitized:true}));setDialog(false);}
    catch(e){setError((e as Error).message);setDialog(false);}finally{lock.current=false;setBusy(false);setConfirmed(false);}}
 const ready=Boolean(profile?.storage_ready&&profile.allowed_origin_count>0);
 return <section className="panel settings-panel"><div className="panel-head"><div><div className="panel-title"><BrainCircuit size={18}/> 服务端 LLM 配置</div><div className="panel-subtitle">独立于 DSH 宿主 · OpenAI Chat Completions</div></div><button type="button" className="btn btn-sm" onClick={load} disabled={busy}><RefreshCcw size={14}/>刷新</button></div><div className="panel-body">
 <Feedback error={error} message={notice}/>
 {!profile?<p className="muted">正在读取或配置不可用。</p>:<><div className="info-note mb16"><KeyRound size={15}/> {ready?"主密钥及允许名单已配置，API Key 加密保存且不会回显。":"须先由部署管理员设置 SOCIALTASK_CONFIG_KEY 与 SOCIALTASK_LLM_ALLOWED_ORIGINS，才能在线保存。"}</div>
 <form onSubmit={save}><fieldset disabled={!ready||busy}><Field label="地址类型"><select value={baseUrl?"base":"endpoint"} onChange={e=>setBaseUrl(e.target.value==="base")}><option value="endpoint">完整 Chat Completions 地址</option><option value="base">Base URL（自动补 /chat/completions）</option></select></Field>
 <Field label="HTTPS 模型服务地址"><input type="url" maxLength={1024} required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://gateway.example/v1/chat/completions"/></Field>
 <Field label="Model ID"><input required maxLength={160} value={model} onChange={e=>setModel(e.target.value)} placeholder="your-model-id"/></Field>
 <Field label="API Key" tip={profile.key_configured?"留空保留现有密钥；修改服务地址必须重新输入密钥或清除。":"未配置密钥"}><input type="password" autoComplete="new-password" maxLength={2048} value={key} disabled={clearKey} onChange={e=>setKey(e.target.value)} placeholder={profile.key_configured?"已加密配置 · 不回显":"输入新 API Key"}/></Field>
 <label className="check-line"><input type="checkbox" checked={clearKey} onChange={e=>{setClearKey(e.target.checked);if(e.target.checked){setKey("");setEnabled(false);}}}/>清除已保存密钥</label><label className="check-line"><input type="checkbox" checked={enabled} disabled={clearKey} onChange={e=>setEnabled(e.target.checked)}/>启用服务端模型（仅显式人工评审时请求）</label>
 <SubmitButton busy={busy}>保存模型配置</SubmitButton></fieldset></form>
 <div className="inline-actions"><button type="button" className="btn" disabled={!ready||busy||!profile.enabled||!profile.key_configured} onClick={openReview}>脱敏模板评审</button><span className="muted small">配置 v{profile.version} · 未主动联调</span></div>
 {review&&<div className="info-note mt12"><b>模型建议（未应用）</b><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{review.review}</p><small>仅发送 {review.fields_sent} 项结构字段。</small></div>}
 </>}
 {dialog&&<Modal title="脱敏模板评审" onClose={()=>{if(!lock.current)setDialog(false)}}><form onSubmit={submitReview}><Field label="已发布模板"><select required value={selected} onChange={e=>setSelected(e.target.value)}><option value="">选择模板</option>{templates.map(t=><option value={t.key} key={t.key}>{t.title} · v{t.version}</option>)}</select></Field><div className="info-note">只发送字段位置、阶段、类型、是否必填。不发送标题、字段键名、字段名称、内容、素材、工单或客户数据。调用可能产生模型费用，模型建议不会自动修改模板。</div><label className="check-line"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>确认向当前配置的模型服务发送脱敏结构并承担供应商计费。</label><div className="form-actions"><SubmitButton busy={busy}>确认评审</SubmitButton></div></form></Modal>}
 </div></section>;
}
