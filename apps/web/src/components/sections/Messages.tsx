"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import Link from "next/link";
import {ArrowLeft,ArrowUpRight,RefreshCcw,Send,MessageCircle,Inbox,ClipboardPlus,Search,UserRound,ShieldCheck,Clock3,Info} from "lucide-react";
import {api,jsonPost,dateInputFuture,type RecordRow,formatDate} from "@/lib/api";
import {useRows,useAction} from "@/lib/hooks";
import {TicketFields,type TicketTemplate} from "@/components/TicketFields";
import {PageHeading,Feedback,Table,Status,DateCell,Modal,Field,SubmitButton,Empty} from "@/components/Ui";
const memberName=(row:RecordRow)=>String(row.person_name||row.peer_userid||"内部成员");
const initial=(row:RecordRow)=>Array.from(memberName(row).trim())[0]?.toUpperCase()||"?";
export default function Messages(){
 const[tab,setTab]=useState<"inbox"|"outbox">("inbox"),[q,setQ]=useState(""),[thread,setThread]=useState<RecordRow|null>(null),[messages,setMessages]=useState<RecordRow[]>([]),[threads,setThreads]=useState<RecordRow[]>([]);
 const[loading,setLoading]=useState(true),[error,setError]=useState(""),[reply,setReply]=useState(""),[config,setConfig]=useState<RecordRow|null>(null);
 const[unreadOnly,setUnreadOnly]=useState(false),[mobileThread,setMobileThread]=useState(false);
 const[people,setPeople]=useState<RecordRow[]>([]),[createTicket,setCreateTicket]=useState(false),[ticket,setTicket]=useState({title:"",description:"",assigneeId:"",priority:"NORMAL",deadline:"",sourceMessageId:null as unknown});
 const outbox=useRows("notifications"),action=useAction();
 const selection=useRef({id:"",version:0}),listRequest=useRef(0),stream=useRef<HTMLDivElement>(null);
 const[threadReady,setThreadReady]=useState(false),[threadLoading,setThreadLoading]=useState(false);
 const[related,setRelated]=useState<RecordRow[]>([]),[relatedBusy,setRelatedBusy]=useState(false),[relatedError,setRelatedError]=useState("");
 const relatedRequest=useRef(0),templateRequest=useRef(0),ticketSubmitting=useRef(false);
 const[ticketConversation,setTicketConversation]=useState("");
 const[templates,setTemplates]=useState<TicketTemplate[]>([]),[packages,setPackages]=useState<RecordRow[]>([]),[templateKey,setTemplateKey]=useState(""),[templateBusy,setTemplateBusy]=useState(false),[templateError,setTemplateError]=useState("");
 const[fieldValues,setFieldValues]=useState<Record<string,string|number|boolean>>({});
 const template=templates.find(t=>t.key===templateKey);
 const[mediaKind,setMediaKind]=useState("text"),[mediaFile,setMediaFile]=useState<File|null>(null);
 const sending=useRef(false),request=useRef<{fingerprint:string;id:string}|null>(null);
 const replyBytes=new TextEncoder().encode(reply.trim()).length;
 async function loadRelated(id:string,version:number){
   const request=++relatedRequest.current;setRelatedBusy(true);setRelatedError("");
   const current=()=>selection.current.id===id&&selection.current.version===version&&relatedRequest.current===request;
   try{const rows=await api<RecordRow[]>(`wecom/inbox/conversations/${id}/tickets`);if(current())setRelated(rows);}
   catch(e){if(current())setRelatedError((e as Error).message);}
   finally{if(current())setRelatedBusy(false);}
 }
 async function loadInbox(){
   const request=++listRequest.current;setLoading(true);setError("");
   try{
     const rows=await api<RecordRow[]>("wecom/inbox/conversations"+(q?"?q="+encodeURIComponent(q):""));
     if(request!==listRequest.current)return;
     setThreads(rows);
     const nextConfig=await api<RecordRow>("wecom/config");
     if(request===listRequest.current)setConfig(nextConfig);
   }catch(e){if(request===listRequest.current)setError((e as Error).message);}
   finally{if(request===listRequest.current)setLoading(false);}
 }
 useEffect(()=>{loadInbox();api<RecordRow[]>("people/assignees").then(setPeople).catch(()=>{});},[]);
 async function openThread(row:RecordRow,reveal=true){
   const id=String(row.id),version=selection.current.version+1;
   if(selection.current.id!==id){setReply("");setMediaKind("text");setMediaFile(null);request.current=null;}
   selection.current={id,version};setThread(row);setThreadReady(false);setThreadLoading(true);setMessages([]);setError("");setRelated([]);
   void loadRelated(id,version);
   if(reveal)setMobileThread(true);
   const current=()=>selection.current.version===version;
   try{
     const rows=await api<RecordRow[]>(`wecom/inbox/conversations/${id}/messages`);
     if(!current())return;
     setMessages(rows.reverse());setThreadReady(true);
     await api(`wecom/inbox/conversations/${id}/read`,{method:"POST"});
     if(current()){setThreads(t=>t.map(x=>String(x.id)===id?{...x,unread_count:0}:x));setThread(t=>t&&String(t.id)===id?{...t,unread_count:0}:t);}
   }catch(e){if(current())setError((e as Error).message);}
   finally{if(current())setThreadLoading(false);}
 }
 useEffect(()=>{if(threadReady&&stream.current)stream.current.scrollTop=stream.current.scrollHeight;},[threadReady,messages,tab,mobileThread]);
 async function refresh(){if(tab==="inbox"){const version=selection.current.version;await loadInbox();if(thread&&selection.current.version===version)await openThread(thread,false);}else await outbox.reload();}
 async function sendReply(e:FormEvent){
   e.preventDefault();if(!thread||!threadReady||action.busy||sending.current||!config?.outbound_enabled||!thread.person_id)return;
   const text=mediaKind==="text",file=mediaFile;
   if(text?(!reply.trim()||replyBytes>2048):(!config.media_enabled||!file||file.size>5*1024*1024))return;
   const id=String(thread.id),version=selection.current.version;
   const fingerprint=JSON.stringify([id,mediaKind,text?reply.trim():file?.name,text?null:file?.size,text?null:file?.lastModified]);
   if(!request.current||request.current.fingerprint!==fingerprint){
     if(!globalThis.crypto?.randomUUID){setError("安全发送需要 HTTPS 或本机开发环境");return;}
     request.current={fingerprint,id:crypto.randomUUID()};
   }
   const requestId=request.current.id;sending.current=true;
   try{
     const result=await action.run(()=>{
       if(text)return jsonPost<RecordRow>("wecom/inbox/conversations/"+id+"/reply",{content:reply,requestId});
       const body=new FormData();body.append("requestId",requestId);body.append("type",mediaKind);body.append("file",file!);
       return api<RecordRow>("wecom/inbox/conversations/"+id+"/reply-media",{method:"POST",body});
     },"发送请求状态已记录，请查看消息结果（平台接受不代表已读）");
     if(result&&selection.current.version===version){
       request.current=null;setReply("");setMediaFile(null);setMediaKind("text");
       await openThread(thread,false);
       if(result.delivery_status==="UNKNOWN"||result.delivery_status==="SENDING")setError("发送结果未知或正在处理，请刷新核对，勿重复发送。");
       else if(result.delivery_status==="FAILED")setError("企业微信明确拒绝发送，请核对配置和内容。");
     }
   }finally{sending.current=false;}
 }
 async function tick(){const result=await action.run(()=>api<RecordRow>("ops/tick",{method:"POST"}),"已执行催办、回访、SLA 与通知调度");if(result)outbox.reload();}
 const latestInbound=messages.filter(x=>x.direction==="INBOUND"&&x.delivery_status!=="REDACTED").at(-1);
 async function startTicket(){
   if(!thread||!threadReady||!latestInbound||ticketSubmitting.current)return;
   action.reset();const request=++templateRequest.current;
   setTicketConversation(String(thread.id));setTicket({title:("企业微信协助请求 · "+memberName(thread)).slice(0,240),description:String(latestInbound.content||"请核实消息并联系成员").slice(0,3000),assigneeId:"",priority:"NORMAL",deadline:dateInputFuture(24),sourceMessageId:latestInbound.id});
   setTemplateKey("");setFieldValues({});setTemplates([]);setPackages([]);setTemplateError("");setTemplateBusy(true);setCreateTicket(true);
   try{const [t,p]=await Promise.all([api<TicketTemplate[]>("ticket-templates"),api<RecordRow[]>("content-packages")]);if(request===templateRequest.current){setTemplates(t);setPackages(p.filter(x=>x.review_status==="APPROVED"));}}
   catch(e){if(request===templateRequest.current)setTemplateError((e as Error).message);}
   finally{if(request===templateRequest.current)setTemplateBusy(false);}
 }
 function closeTicket(){if(ticketSubmitting.current)return;++templateRequest.current;setCreateTicket(false);}
 async function saveTicket(e:FormEvent){
   e.preventDefault();if(action.busy||ticketSubmitting.current||templateBusy||!ticketConversation||ticket.sourceMessageId==null||(templateKey&&!template))return;
   ticketSubmitting.current=true;
   try{
     const result=await action.run(()=>jsonPost<RecordRow>(`wecom/inbox/conversations/${ticketConversation}/tickets`,{title:ticket.title,description:ticket.description,assigneeId:Number(ticket.assigneeId),deadline:new Date(ticket.deadline).toISOString(),priority:ticket.priority,sourceMessageId:ticket.sourceMessageId,...(template?{templateKey:template.key,templateVersion:template.version,fieldValues}:{})}),"工单已创建");
     if(result){++templateRequest.current;setCreateTicket(false);if(selection.current.id===ticketConversation)void loadRelated(ticketConversation,selection.current.version);}
   }finally{ticketSubmitting.current=false;}
 }
 const unread=threads.filter(t=>Number(t.unread_count)>0).length;
 const shown=unreadOnly?threads.filter(t=>Number(t.unread_count)>0||String(t.id)===selection.current.id):threads;
 const canCompose=Boolean(threadReady&&config?.outbound_enabled&&thread?.person_id);
 return <div className={`message-workbench ${tab==="inbox"&&mobileThread&&thread?"mobile-thread-active":""}`}><PageHeading eyebrow="WECOM / MESSAGE HUB" title="企业微信聚合消息工作台" description="管理企业微信自建应用的内部成员消息、任务通知与服务工单。" actions={<button type="button" className="btn" onClick={refresh} disabled={tab==="inbox"?loading:outbox.loading}><RefreshCcw size={15} className={(tab==="inbox"?loading:outbox.loading)?"spin":""}/> 刷新</button>}/>
 <div className="channel-strip"><div className="channel-summary"><ShieldCheck size={18}/><div><b>企业微信自建应用</b><small>仅内部成员消息，不包含外部客户私聊</small></div></div><div className="channel-states"><span className={`channel-state ${config?.callback_configured?"configured":""}`}><i/>回调：{config?config.callback_configured?"已配置 · 待验收":"未配置":"未知"}</span><span className={`channel-state ${config?.outbound_enabled?"configured":""}`}><i/>出站：{config?config.outbound_enabled?"已开启 · 待验收":"关闭":"未知"}</span></div></div>
 <div className="workbench-tabs" role="group" aria-label="消息渠道"><button type="button" aria-pressed={tab==="inbox"} className={tab==="inbox"?"active":""} onClick={()=>setTab("inbox")}><MessageCircle size={17}/> 应用消息收件箱</button><button type="button" aria-pressed={tab==="outbox"} className={tab==="outbox"?"active":""} onClick={()=>setTab("outbox")}><Send size={16}/> 任务通知 / 催办记录</button></div>
 <Feedback error={error||action.error||(tab==="outbox"?outbox.error:"")} message={action.message}/>
 {tab==="inbox"?<div className={`inbox-grid inbox-redesign ${mobileThread&&thread?"is-thread-open":""}`}>
 <section className="inbox-list" aria-label="成员会话列表">
  <div className="inbox-list-head"><div className="between"><h2>会话列表 <span className="count-label">{threads.length}</span></h2><button type="button" className={`unread-toggle ${unreadOnly?"active":""}`} aria-pressed={unreadOnly} onClick={()=>setUnreadOnly(v=>!v)}>仅未读</button></div>
  <form className="inbox-search" onSubmit={e=>{e.preventDefault();loadInbox();}}><Search size={16}/><input aria-label="搜索企业微信成员" value={q} onChange={e=>setQ(e.target.value)} placeholder="姓名 / 企业微信 UserID"/><button className="btn btn-sm" type="submit" disabled={loading}>搜索</button></form>
  <div className="inbox-list-summary"><span>当前查询结果</span><span>{unread} 个未读会话</span></div></div>
  <div className="inbox-list-scroll">{loading&&<p className="inbox-list-note" role="status">正在查询会话…</p>}
  {!loading&&shown.length===0&&<Empty message={error?"读取失败，请刷新重试":unreadOnly?"当前没有未读会话":"暂无已验证回调产生的应用消息"}/>}
  {shown.map(t=><button type="button" className={`inbox-item ${thread&&String(thread.id)===String(t.id)?"active":""}`} aria-pressed={Boolean(thread&&String(thread.id)===String(t.id))} key={String(t.id)} onClick={()=>openThread(t)}><span className="inbox-avatar">{initial(t)}</span><span className="inbox-meta"><span className="inbox-item-heading"><strong>{memberName(t)}</strong><small>{formatDate(t.last_message_at)}</small></span><span className="inbox-item-preview"><small>{String(t.last_message||"（仅事件）").slice(0,60)}</small>{Number(t.unread_count)>0&&<span className="inbox-unread">{Number(t.unread_count)}</span>}</span><small className="inbox-group">{String(t.group_name||"未关联人员")}</small></span></button>)}</div>
 </section>
 <section className="inbox-conversation" aria-label="会话内容">{!thread?<div className="inbox-placeholder"><span className="empty-illustration"><MessageCircle size={32}/></span><b>选择一个成员会话</b><p>查看消息内容、回复应用消息或从消息创建工单。</p></div>:<>
 <header className="inbox-convo-header"><div className="inbox-member-heading"><button type="button" className="icon-btn inbox-back" onClick={()=>setMobileThread(false)} aria-label="返回会话列表"><ArrowLeft size={20}/></button><span className="inbox-avatar">{initial(thread)}</span><div><b>{memberName(thread)}</b><div className="muted small">{String(thread.group_name||"未关联人员")} · 内部成员会话</div></div></div><div className="inbox-header-actions"><button type="button" className="btn btn-sm" onClick={startTicket} disabled={!threadReady||!latestInbound}><ClipboardPlus size={15}/> 从消息建单</button><button type="button" className="icon-btn" onClick={()=>openThread(thread,false)} disabled={threadLoading} aria-label="刷新当前会话" title="刷新当前会话"><RefreshCcw size={16} className={threadLoading?"spin":""}/></button></div></header>
 <div className="inbox-stream" ref={stream} tabIndex={0} aria-label="消息记录">{threadReady&&messages.length>0&&<div className="inbox-timeline-caption">最近 {messages.length} 条消息记录</div>}{messages.map(m=><div className={`chat-line ${m.direction==="OUTBOUND"?"outbound":"inbound"}`} key={String(m.id)}>{m.direction!=="OUTBOUND"&&<span className="chat-avatar">{initial(thread)}</span>}<div className="chat-message"><small className="chat-source">{m.direction==="OUTBOUND"?({ACCEPTED:"平台接口已接受（非已读）",SENDING:"发送中",UNKNOWN:"结果未知 · 勿重复发送",FAILED:"发送失败"}[String(m.delivery_status) as "ACCEPTED"|"SENDING"|"UNKNOWN"|"FAILED"]||"发送记录"):"企业微信回调"} · {String(m.message_type)}</small><div className="chat-bubble"><p>{m.delivery_status==="REDACTED"?"（消息正文已按保留期清理）":String(m.content||"（无正文）")}</p>{Boolean(m.media_available)&&Boolean(config?.media_enabled)&&<a className="btn btn-sm" href={"/api/proxy/wecom/inbox/messages/"+m.id+"/media"}>下载媒体原件</a>}</div><small className="chat-time">{formatDate(m.message_at)}</small></div>{m.direction==="OUTBOUND"&&<span className="chat-avatar outbound-avatar">ST</span>}</div>)}
 {!threadReady?<Empty message={threadLoading?"正在读取会话…":"会话读取失败，请刷新重试"}/>:messages.length===0&&<Empty message="当前会话暂无消息记录"/>}</div>
 <form className="inbox-reply" onSubmit={sendReply}><div className="reply-heading"><b>回复应用消息</b><span className="muted small">{mediaKind==="text"?replyBytes+"/2048 B":"图片/语音 ≤2 MB；视频/文件 ≤5 MB"}</span></div>{Boolean(config?.media_enabled)&&<select className="filter-select" aria-label="消息类型" value={mediaKind} disabled={!canCompose||action.busy} onChange={e=>{setMediaKind(e.target.value);setMediaFile(null);request.current=null;}}><option value="text">文本</option><option value="image">图片</option><option value="voice">语音 (AMR)</option><option value="video">视频 (MP4)</option><option value="file">文件</option></select>}{mediaKind==="text"?<textarea aria-label="回复内容" maxLength={1000} disabled={!canCompose||action.busy} required value={reply} onChange={e=>setReply(e.target.value)} placeholder={canCompose?"输入消息内容…":"仅已关联人员且开启应用出站时可回复"}/>:<input aria-label="选择媒体" type="file" required key={mediaKind} disabled={!canCompose||action.busy} accept={mediaKind==="image"?"image/png,image/jpeg":mediaKind==="voice"?".amr":mediaKind==="video"?".mp4":undefined} onChange={e=>{setMediaFile(e.target.files?.[0]||null);request.current=null;}}/>}<div className="reply-actions"><span className="muted small"><Info size={13}/> 接口接受不代表已读</span><button className="btn btn-primary" type="submit" disabled={!canCompose||action.busy||(mediaKind==="text"?(!reply.trim()||replyBytes>2048):(!mediaFile||mediaFile.size>(["image","voice"].includes(mediaKind)?2:5)*1024*1024))}><Send size={15}/> 发送应用消息</button></div></form></>}
 </section>
 <aside className="inbox-context" aria-label="成员及工单操作"><section className="context-card"><h2><UserRound size={17}/> 成员信息</h2>{thread?<><div className="context-member"><span className="inbox-avatar">{initial(thread)}</span><div><b>{memberName(thread)}</b><span className={`context-binding ${thread.person_id?"bound":""}`}>{thread.person_id?"已关联人员档案":"未关联人员"}</span></div></div><dl className="context-details"><div><dt>企业微信 UserID</dt><dd>{String(thread.peer_userid||"—")}</dd></div><div><dt>所属分组</dt><dd>{String(thread.group_name||"—")}</dd></div><div><dt>人员档案</dt><dd>{thread.person_id?`#${String(thread.person_id)}`:"未关联"}</dd></div><div><dt>最近消息时间</dt><dd>{formatDate(thread.last_message_at)}</dd></div></dl><Link href="/admin/people" className="btn context-link">人员与账号 <ArrowUpRight size={14}/></Link></>:<Empty message="选择会话后查看成员信息"/>}</section>
 <section className="context-card"><h2><ClipboardPlus size={17}/> 快速创建工单</h2><p className="muted small">从当前会话的最近入站消息生成工单，保留消息来源关联。</p>{threadReady&&latestInbound&&<div className="context-source"><span><MessageCircle size={13}/> 消息来源</span><p>{String(latestInbound.content||"（无正文）").slice(0,160)}</p><small>{formatDate(latestInbound.message_at)}</small></div>}<button type="button" className="btn btn-primary context-link" onClick={startTicket} disabled={!thread||!threadReady||!latestInbound}><ClipboardPlus size={16}/> 创建工单</button><Link href="/admin/tasks" className="btn context-link">进入统一任务中心 <ArrowUpRight size={14}/></Link></section>
 <section className="context-card"><h2><ClipboardPlus size={17}/> 关联工单</h2>{!thread?<p>选择会话后查看来源工单。</p>:relatedBusy?<p role="status">正在读取关联工单…</p>:relatedError?<><Feedback error={relatedError}/><button type="button" className="btn btn-sm" onClick={()=>loadRelated(String(thread.id),selection.current.version)}>重试</button></>:related.length===0?<p>暂无通过当前会话消息创建的工单。</p>:<div className="related-ticket-list">{related.map(t=><Link className="related-ticket" key={String(t.id)} href={`/admin/tasks?task=${t.id}`}><div className="related-ticket-top"><span className="code">{String(t.task_no)}</span><Status value={t.status}/></div><b>{String(t.title)}</b><small>{String(t.assignee_name||"—")} · {formatDate(t.due_at)}</small></Link>)}<small className="muted">最多显示最近 50 条来源工单</small></div>}</section>
 <section className="context-card context-notice"><h2><ShieldCheck size={17}/> 渠道说明</h2><p>仅展示已接收的应用回调。人员关联不等于在线状态或登录授权；外部客户会话需另行授权。</p></section></aside>
 </div>:<><div className="table-toolbar notification-toolbar"><div><h2>任务通知记录</h2><p className="muted small">审核、催办与 SLA 调度记录</p></div><button type="button" className="btn btn-primary" onClick={tick} disabled={action.busy}><RefreshCcw size={14}/> 手动执行调度</button></div><div className="info-note" style={{marginBottom:16}}>SENT 表示企业微信接口接受了消息，不代表成员已接收或阅读；重试、失败及未配置都会在此记录。</div>{outbox.loading?<p className="muted" role="status">读取通知…</p>:<Table head={["记录 ID","类型","任务","接收人","发送状态","重试次数","平台消息 ID","时间"]} rows={outbox.rows.map(n=>[
 <span key="no" className="code">#{String(n.id)}</span>,String(n.event_type),n.task_id?<Link key="task" href={`/admin/tasks?task=${n.task_id}`} className="link-blue">#{String(n.task_id)}</Link>:"—",String(n.recipient_name||"管理员工作台"),<Status key="status" value={n.state}/>,String(n.send_attempts),String(n.provider_msgid||"—"),<DateCell key="date" value={n.created_at}/>
 ])}/>}</>}
 {createTicket&&<Modal title="从企业微信应用消息创建工单" onClose={closeTicket}><form onSubmit={saveTicket}><Field label="标题"><input required maxLength={240} value={ticket.title} onChange={e=>setTicket(v=>({...v,title:e.target.value}))}/></Field><Field label="工单说明"><textarea required maxLength={3000} value={ticket.description} onChange={e=>setTicket(v=>({...v,description:e.target.value}))}/></Field><div className="form-grid"><Field label="执行人员"><select required value={ticket.assigneeId} onChange={e=>setTicket(v=>({...v,assigneeId:e.target.value}))}><option value="">选择客服 / 官方助理</option>{people.filter(p=>["support","assistant"].includes(String(p.person_type))).map(p=><option value={String(p.id)} key={String(p.id)}>{String(p.name)}</option>)}</select></Field><Field label="优先级"><select value={ticket.priority} onChange={e=>setTicket(v=>({...v,priority:e.target.value}))}><option value="NORMAL">普通</option><option value="HIGH">高</option><option value="URGENT">紧急</option></select></Field><Field label="业务截止时间"><input required type="datetime-local" value={ticket.deadline} onChange={e=>setTicket(v=>({...v,deadline:e.target.value}))}/></Field></div><Field label="工单模板"><select disabled={templateBusy||action.busy} value={templateKey} onChange={e=>{setTemplateKey(e.target.value);setFieldValues({});}}><option value="">普通工单（不使用模板）</option>{templates.map(t=><option key={t.key} value={t.key}>{t.title} · v{t.version}</option>)}</select></Field>{templateBusy&&<p className="muted small" role="status">正在加载模板与已审核素材…</p>}{templateError&&<Feedback error={"模板暂不可用，可创建普通工单："+templateError}/>} {template&&<TicketFields fields={template.fields.filter(f=>f.phase==="DISPATCH")} values={fieldValues} onChange={setFieldValues} packages={packages}/>}<div className="info-note">建单时保留所选消息、模板版本及已审核素材快照；执行者仍通过鉴权 H5 回传。</div><Feedback error={action.error}/><div className="form-actions"><button type="button" className="btn" onClick={closeTicket} disabled={action.busy}>取消</button><SubmitButton busy={action.busy||templateBusy}>创建工单</SubmitButton></div></form></Modal>}
 </div>;
}
