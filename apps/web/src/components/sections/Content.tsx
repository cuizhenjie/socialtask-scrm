"use client";
import {useState,type FormEvent} from "react";
import {Plus,PackageCheck,UploadCloud,CheckCircle2,RefreshCcw} from "lucide-react";
import {jsonPost,type RecordRow} from "@/lib/api";
import {uploadAttachment} from "@/lib/upload-attachment";
import {useRows,useAction} from "@/lib/hooks";
import {PageHeading,Modal,Field,Feedback,SubmitButton,Status,Table,DateCell} from "@/components/Ui";
export default function Content(){
 const{rows,loading,error,reload}=useRows("content-packages");const action=useAction();const[show,setShow]=useState(false);
 const[title,setTitle]=useState("");const[body,setBody]=useState("");const[hashtags,setHashtags]=useState("");const[assetIds,setAssetIds]=useState<number[]>([]);
 const[uploading,setUploading]=useState(false);const[failed,setFailed]=useState<{file:File; message:string}[]>([]);
 async function upload(files:File[]){
  if(uploading||files.length===0)return;
  setUploading(true);const errors:{file:File;message:string}[]=[];
  try{
   for(const file of files){
    try{const {id}=await uploadAttachment(file,"CONTENT");setAssetIds(v=>v.includes(id)?v:[...v,id]);}
    catch(e){errors.push({file,message:(e as Error).message});}
   }
   setFailed(v=>[...v.filter(item=>!files.includes(item.file)),...errors]);
  }finally{setUploading(false);}
 }
 async function save(e:FormEvent){e.preventDefault();if(uploading||failed.length)return;const result=await action.run(()=>jsonPost("content-packages",{title,body,hashtags,assetIds}),"内容包已创建");if(result){setShow(false);setTitle("");setBody("");setAssetIds([]);setFailed([]);reload();}}
 async function approve(row:RecordRow){if(!confirm(`确认已核验《${row.title}》的素材真实性、文案和平台合规性？`))return;const done=await action.run(()=>jsonPost(`content-packages/${row.id}/review`,{decision:"APPROVE"}),"审核通过");if(done)reload();}
 return <><PageHeading eyebrow="CONTENT OPERATIONS" title="内容素材管理" description="发布前审核图片、标题、正文和话题标签。审核通过后才可批量下发。" actions={<button className="btn btn-primary" onClick={()=>{action.reset();setShow(true)}}><Plus size={15}/> 创建内容包</button>}/>
 <div className="info-note" style={{marginBottom:18}}>使用真实、已核实的内容，不允许伪造患者身份、效果或评价。首版不自动操作抖音账号。</div><Feedback error={error||action.error} message={action.message}/>
 {loading?<p className="muted">加载内容中…</p>:<Table head={["编号","内容标题","话题标签","素材","审核状态","创建时间","操作"]} rows={rows.map(row=>[
 <span className="code" key="id">#{String(row.id)}</span>,<b key="title">{String(row.title)}</b>,String(row.hashtags||"—"),String(row.asset_ids_json||"[]"),<Status value={row.review_status} key="state"/>,<DateCell value={row.created_at} key="time"/>,<div key="actions" className="row-actions">{row.review_status==="DRAFT"?<button className="btn btn-sm btn-primary" onClick={()=>approve(row)}><PackageCheck size={13}/> 审核通过</button>:<span className="muted small">已处理</span>}</div>
 ])}/>}
 {show&&<Modal title="创建发布内容包" onClose={()=>setShow(false)}><form onSubmit={save}>
 <Field label="内容标题"><input required maxLength={220} value={title} onChange={e=>setTitle(e.target.value)} placeholder="今日素人素材发布任务"/></Field>
 <Field label="正文"><textarea required style={{minHeight:140}} value={body} onChange={e=>setBody(e.target.value)} placeholder="请填写已经核实的发布正文"/></Field>
 <Field label="话题标签"><input value={hashtags} onChange={e=>setHashtags(e.target.value)} placeholder="#经验分享 #真实记录"/></Field>
 <Field label="素材图片"><label className="upload-box"><UploadCloud size={23}/><span>选择本地 PNG/JPEG（每张不超过 5MB）</span><input type="file" accept="image/png,image/jpeg" multiple disabled={uploading||action.busy} onChange={e=>{const files=Array.from(e.currentTarget.files||[]);e.currentTarget.value="";void upload(files);}}/></label><small>{uploading?"正在上传…":`已上传 ${assetIds.length} 张`} · 私有存储，授权任务执行者可访问</small>
 {failed.map((item,index)=><div className="row-actions" key={index}><span className="muted small">{item.file.name}：{item.message}</span><button type="button" className="btn btn-sm" disabled={uploading} onClick={()=>void upload([item.file])}>重试</button><button type="button" className="btn btn-sm" disabled={uploading} onClick={()=>setFailed(v=>v.filter(entry=>entry!==item))}>移除</button></div>)}</Field>
 <Feedback error={action.error} message={action.message}/><div className="form-actions"><button className="btn" type="button" onClick={()=>setShow(false)}>取消</button><SubmitButton busy={action.busy||uploading||failed.length>0}>创建草稿</SubmitButton></div>
 </form></Modal>}
 </>;
}
