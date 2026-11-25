"use client";
import {useState,type FormEvent} from "react";
import {Plus,PackageCheck,UploadCloud,CheckCircle2,RefreshCcw} from "lucide-react";
import {api,jsonPost,type RecordRow} from "@/lib/api";
import {useRows,useAction} from "@/lib/hooks";
import {PageHeading,Modal,Field,Feedback,SubmitButton,Status,Table,DateCell} from "@/components/Ui";
export default function Content(){
 const{rows,loading,error,reload}=useRows("content-packages");const action=useAction();const[show,setShow]=useState(false);
 const[title,setTitle]=useState("");const[body,setBody]=useState("");const[hashtags,setHashtags]=useState("");const[assetIds,setAssetIds]=useState<number[]>([]);
 async function upload(file:File){const form=new FormData();form.append("purpose","CONTENT");form.append("file",file);const res=await api<{id:number}>("attachments",{method:"POST",body:form});setAssetIds(v=>[...v,res.id]);}
 async function save(e:FormEvent){e.preventDefault();const result=await action.run(()=>jsonPost("content-packages",{title,body,hashtags,assetIds}),"内容包已创建");if(result){setShow(false);setTitle("");setBody("");setAssetIds([]);reload();}}
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
 <Field label="素材图片"><label className="upload-box"><UploadCloud size={23}/><span>选择本地 PNG/JPEG（每张不超过 5MB）</span><input type="file" accept="image/png,image/jpeg" multiple onChange={async e=>{for(const file of Array.from(e.target.files||[])){await action.run(()=>upload(file),"图片上传成功");}}}/></label><small>已上传 {assetIds.length} 张 · 私有存储，授权任务执行者可访问</small></Field>
 <Feedback error={action.error} message={action.message}/><div className="form-actions"><button className="btn" type="button" onClick={()=>setShow(false)}>取消</button><SubmitButton busy={action.busy}>创建草稿</SubmitButton></div>
 </form></Modal>}
 </>;
}
