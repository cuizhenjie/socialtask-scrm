"use client";
import {useEffect,useState,type FormEvent} from "react";
import {useRouter,useParams} from "next/navigation";
import Link from "next/link";
import {ArrowLeft,ArrowRight,ExternalLink,UploadCloud,Info,ShieldCheck,Clock3} from "lucide-react";
import {AuthGate} from "@/components/AuthGate";
import {api,jsonPost,display,typeMap,formatDate,type RecordRow} from "@/lib/api";
import {uploadAttachment} from "@/lib/upload-attachment";
import {DispatchSnapshot,TicketFields,type TicketSnapshot} from "@/components/TicketFields";
import {Status,Field,Feedback,SubmitButton} from "@/components/Ui";
export default function MobileTaskDetail(){
 const {id}=useParams<{id:string}>();const router=useRouter();const[task,setTask]=useState<RecordRow|null>(null);const[error,setError]=useState("");const[busy,setBusy]=useState(false);const[link,setLink]=useState("");const[confirmed,setConfirmed]=useState(false);const[file,setFile]=useState<File|null>(null);const[reply,setReply]=useState("NO_REPLY");const[note,setNote]=useState("");
 const [fieldValues,setFieldValues]=useState<Record<string,string|number|boolean>>({});
 const [draftReady,setDraftReady]=useState(false);const [draftRestored,setDraftRestored]=useState(false);
 const draftKey=`socialtask:draft:${id}`;
 useEffect(()=>{
  setDraftReady(false);setDraftRestored(false);
  let restored=false;
  try{
   const raw=sessionStorage.getItem(draftKey);
   if(raw){
    const d=JSON.parse(raw) as {link?:string;confirmed?:boolean;reply?:string;note?:string;fieldValues?:Record<string,string|number|boolean>};
    setLink(d.link||"");setConfirmed(Boolean(d.confirmed));setReply(d.reply||"NO_REPLY");setNote(d.note||"");setFieldValues(d.fieldValues||{});
    restored=Boolean(d.link||d.confirmed||d.note||(d.reply&&d.reply!=="NO_REPLY")||(d.fieldValues&&Object.keys(d.fieldValues).length>0));
   }else{setLink("");setConfirmed(false);setReply("NO_REPLY");setNote("");setFieldValues({});}
  }catch{setFieldValues({});}
  setDraftRestored(restored);setDraftReady(true);
  api<RecordRow>(`tasks/${id}`).then(setTask).catch(e=>setError(e.message));
 },[id,draftKey]);
 useEffect(()=>{
  if(!draftReady)return;
  try{
   const hasDraft=Boolean(link||confirmed||note||(reply&&reply!=="NO_REPLY")||Object.keys(fieldValues).length>0);
   if(hasDraft)sessionStorage.setItem(draftKey,JSON.stringify({link,confirmed,reply,note,fieldValues}));
   else sessionStorage.removeItem(draftKey);
  }catch{}
 },[draftReady,draftKey,link,confirmed,reply,note,fieldValues]);
 function clearDraft(){setLink("");setConfirmed(false);setReply("NO_REPLY");setNote("");setFieldValues({});setDraftRestored(false);try{sessionStorage.removeItem(draftKey);}catch{}}
 const payload=task?.payload_json?(typeof task.payload_json==="string"?JSON.parse(String(task.payload_json)):task.payload_json) as RecordRow:{};
 const snapshot=payload.template_snapshot as TicketSnapshot|undefined;
 const content=task?.content as RecordRow|undefined;
 let assets:number[]=[];try{const ids=content?.asset_ids_json;if(ids){assets=Array.isArray(ids)?ids.map(Number):JSON.parse(String(ids));}}catch{}
 const slaPaused=Boolean((task?.sla as RecordRow|undefined)?.paused_at);
 const canSubmit=task&&!slaPaused&&["PENDING","REWORK"].includes(String(task.status));
 const isContact=["CONTACT_AUTHOR","CONTACT_ASSISTANT","FOLLOWUP"].includes(String(task?.type));
 async function submit(e:FormEvent){e.preventDefault();if(!task)return;setBusy(true);setError("");try{
  let attachmentId:number|null=null;
  if(isContact){
    if(!file)throw new Error("联系任务须上传实际私信截图");
    const saved=await uploadAttachment(file,"PRIVATE_MESSAGE");attachmentId=saved.id;
  }
  const contentPayload=task.type==="PUBLISH"?{work_url:link.trim()}:task.type==="OFFICIAL_COMMENT"?{confirmed}:task.type==="SERVICE_TICKET"?{notes:note,...(snapshot?{fieldValues}:{})}: {reply_status:reply,note};
  await jsonPost(`tasks/${id}/submissions`,{payload:contentPayload,attachmentId});
  try{sessionStorage.removeItem(draftKey);}catch{}
  router.replace("/m");router.refresh();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <AuthGate><div className="mobile-shell"><div className="mobile-topbar"><Link href="/m" aria-label="返回任务列表"><ArrowLeft size={20}/></Link><span>任务详情</span><span className="code">#{id}</span></div>
 <div className="mobile-body" style={{marginTop:0,paddingTop:20}}>
 {error&&<div className="form-alert error">{error}</div>}{!task?<p className="muted">加载任务中…</p>:<>
 <div className="mobile-detail"><div className="between"><span className="code">{String(task.task_no)}</span><Status value={task.status}/></div>
 <h1 className="mobile-detail-title">{String(task.title)}</h1><div className="meta">{display(task.type,typeMap)} · {String(task.assignee_name)}</div>
 <div className="mobile-deadline"><Clock3 size={15}/> 截止：{formatDate(task.due_at)}</div>
 {content&&<div className="detail-content"><h3>作品发布素材</h3><strong>{String(content.title)}</strong><p>{String(content.body)}</p><small>{String(content.hashtags)}</small>
 {assets.length>0&&<div className="mobile-assets">{assets.map(asset=><a key={asset} className="btn btn-sm" href={`/api/proxy/attachments/${asset}`} target="_blank" rel="noopener noreferrer">素材 #{asset} <ExternalLink size={13}/></a>)}</div>}</div>}
 {snapshot&&<DispatchSnapshot snapshot={snapshot}/>}
 {task.work!=null&&<div className="detail-content"><h3>关联作品</h3><a href={String((task.work as RecordRow).work_url)} className="link-blue" target="_blank" rel="noopener noreferrer">打开抖音作品 <ExternalLink size={13}/></a></div>}
 {task.customer!=null&&<div className="detail-content"><h3>客户信息</h3><p>{String((task.customer as RecordRow).nickname)} · 当前状态 {display((task.customer as RecordRow).status)}</p></div>}
 {typeof payload.private_message==="string"&&<div className="detail-content"><h3>私信内容</h3><p className="message-script">{String(payload.private_message)}</p><small>须以实际身份沟通；客户回复或拒绝后应立即停止重复联系。</small></div>}
 {typeof payload.comment_text==="string"&&<div className="detail-content"><h3>官方评论文案</h3><p>{String(payload.comment_text)}</p><small>官方助理公开评论只需确认发布，后台管理员将核验评论区。</small></div>}
 </div>
 {canSubmit?<form className="mobile-detail mobile-submit" onSubmit={submit}>
 <div className="between"><h2>提交任务结果</h2>{draftRestored&&<button type="button" className="btn-link" onClick={clearDraft}>清空草稿</button>}</div>
 {draftRestored&&<div className="info-note"><Info size={15}/> 已自动恢复未提交草稿（图片需重新选择后上传）。</div>}
 {task.type==="PUBLISH"&&<Field label="抖音作品 HTTPS 链接"><input type="url" required value={link} onChange={e=>setLink(e.target.value)} placeholder="https://www.douyin.com/video/..."/><small>作品链接由管理员人工审核，重复链接不可建档。</small></Field>}
 {task.type==="OFFICIAL_COMMENT"&&<label className="check-line"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> 我已用真实官方助理身份在作品评论区发布上述内容</label>}
 {task.type==="SERVICE_TICKET"&&<><Field label="服务工单说明">{typeof payload.description==="string"&&<p className="muted">{String(payload.description)}</p>}</Field><Field label="处理结果（必填）"><textarea required minLength={3} value={note} onChange={e=>setNote(e.target.value)} placeholder="填写处理过程与解决结果"/></Field>{snapshot&&<TicketFields fields={snapshot.template.fields.filter(f=>f.phase==="RESPONSE")} values={fieldValues} onChange={setFieldValues}/>}</>}
 {isContact&&<><Field label="私信截图（必填）"><label className="upload-box"><UploadCloud size={26}/><span>{file?file.name:"选择真实私信截图（JPG/PNG）"}</span><input required type="file" disabled={busy} accept="image/jpeg,image/png" onChange={e=>setFile(e.target.files?.[0]||null)}/></label><small>仅用于任务核验，上传后仅后台授权管理员可读，到期按系统隐私策略自动清理；上传失败时表单草稿会自动保留。</small></Field>
 <Field label="客户回复状态"><select value={reply} onChange={e=>setReply(e.target.value)}><option value="NO_REPLY">未回复</option><option value="REPLIED">已回复</option><option value="UNKNOWN">暂无法判断</option><option value="REFUSED">明确拒绝联系</option></select></Field>
 <Field label="补充说明"><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="记录实际沟通情况和需要跟进的问题"/></Field></>}
 <Feedback error={error}/><SubmitButton busy={busy}>提交结果，等待管理员核验 <ArrowRight size={16}/></SubmitButton>
 </form>:<div className="mobile-detail"><div className="mobile-security-note"><ShieldCheck size={18}/> {slaPaused?"SLA 时钟已暂停，请等待管理员恢复后再提交。":"该任务当前状态为“"+display(task.status)+"”，不能再次提交。审核结果以系统记录为准。"}</div><Link className="btn" href="/m">返回任务列表</Link></div>}
 </>}
 </div></div></AuthGate>;
}
