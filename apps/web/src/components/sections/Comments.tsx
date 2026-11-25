"use client";
import {useState,useEffect,type FormEvent} from "react";
import {Plus,RefreshCcw,ExternalLink} from "lucide-react";
import {api,jsonPost,type RecordRow} from "@/lib/api";
import {useRows,useAction} from "@/lib/hooks";
import {PageHeading,Modal,Field,Feedback,SubmitButton,Table,DateCell} from "@/components/Ui";
export default function Comments(){
 const{rows,loading,error,reload}=useRows("comments");const action=useAction();const[show,setShow]=useState(false);const[works,setWorks]=useState<RecordRow[]>([]);
 const[workId,setWorkId]=useState("");const[nickname,setNickname]=useState("");const[uid,setUid]=useState("");const[content,setContent]=useState("");const[category,setCategory]=useState("咨询");
 useEffect(()=>{api<RecordRow[]>("works").then(setWorks).catch(()=>{});},[]);
 async function submit(e:FormEvent){e.preventDefault();const result=await action.run(()=>jsonPost(`works/${workId}/comments`,{nickname,externalUid:uid||null,content,category}),"真实评论已记录");if(result){setShow(false);reload();}}
 return <><PageHeading eyebrow="REAL COMMENT RECORDS" title="评论与互动记录" description="人工登记真实评论原文、用户身份和来源作品；与官方助理评论工单分开管理。" actions={<button className="btn btn-primary" onClick={()=>{setShow(true);action.reset()}}><Plus size={15}/> 登记真实评论</button>}/>
 <Feedback error={error||action.error} message={action.message}/>{loading?<p className="muted">加载真实评论中…</p>:<Table head={["评论 ID","关联作品","评论用户","原始评论内容","分类","登记时间"]} rows={rows.map(c=>[
 <span className="code" key="id">#{String(c.id)}</span>,<a href={String(c.work_url)} target="_blank" rel="noopener noreferrer" key="link" className="link-blue">W{String(c.work_id)} <ExternalLink size={12}/></a>,String(c.nickname),<div key="content" className="wrap-cell">{String(c.content)}</div>,String(c.category),<DateCell value={c.created_at} key="time"/>
 ])}/>}
 {show&&<Modal title="登记真实用户评论" onClose={()=>setShow(false)}><form onSubmit={submit}>
 <Field label="来源作品"><select required value={workId} onChange={e=>setWorkId(e.target.value)}><option value="">请选择</option>{works.map(w=><option value={String(w.id)} key={String(w.id)}>W{String(w.id)} · {String(w.author_name)}</option>)}</select></Field>
 <Field label="评论用户昵称"><input required value={nickname} onChange={e=>setNickname(e.target.value)}/></Field>
 <Field label="用户 UID（可选）"><input value={uid} onChange={e=>setUid(e.target.value)}/></Field>
 <Field label="实际评论原文"><textarea required value={content} onChange={e=>setContent(e.target.value)}/></Field>
 <Field label="咨询分类"><select value={category} onChange={e=>setCategory(e.target.value)}>{["咨询","价格","医生","预约","其他"].map(t=><option key={t}>{t}</option>)}</select></Field>
 <div className="info-note">只记录可核实的真实用户评论，不虚构用户信息、不自动爬取平台数据。</div>
 <Feedback error={action.error}/><div className="form-actions"><button type="button" className="btn" onClick={()=>setShow(false)}>取消</button><SubmitButton busy={action.busy}>保存评论</SubmitButton></div>
 </form></Modal>}
 </>;
}
