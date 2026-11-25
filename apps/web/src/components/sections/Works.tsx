"use client";
import {useEffect,useState,type FormEvent} from "react";
import {MessageCirclePlus,ExternalLink,RefreshCcw} from "lucide-react";
import {api,jsonPost,dateInputFuture,type RecordRow} from "@/lib/api";
import {useRows,useAction} from "@/lib/hooks";
import {PageHeading,Modal,Field,Feedback,SubmitButton,Status,Table,DateCell} from "@/components/Ui";
export default function Works(){
 const{rows,loading,error,reload}=useRows("works");const action=useAction();const[show,setShow]=useState(false);const[selected,setSelected]=useState<RecordRow|null>(null);const[people,setPeople]=useState<RecordRow[]>([]);
 const[assistantId,setAssistantId]=useState("");const[commentText,setCommentText]=useState("");const[deadline,setDeadline]=useState(dateInputFuture(8));
 useEffect(()=>{api<RecordRow[]>("people/assignees").then(ps=>setPeople(ps.filter(p=>p.person_type==="assistant"))).catch(()=>{});},[]);
 async function submit(e:FormEvent){e.preventDefault();const result=await action.run(()=>jsonPost(`works/${selected?.id}/comment-tasks`,{assistantId:Number(assistantId),commentText,deadline:new Date(deadline).toISOString()}),"已派发官方评论任务");if(result){setShow(false);reload();}}
 return <><PageHeading eyebrow="PUBLISHED CONTENT" title="作品管理" description="作品由执行人回传链接自动建档；审核通过后才能创建官方评论任务。" actions={<button className="btn" onClick={reload}><RefreshCcw size={15}/> 刷新</button>}/>
 <Feedback error={error||action.error} message={action.message}/>{loading?<p className="muted">加载作品中…</p>:<Table head={["作品编号","发布账号","作品地址","审核状态","建档时间","操作"]} rows={rows.map(w=>[
 <span className="code" key="id">W{String(w.id)}</span>,String(w.author_name),<a key="url" className="link-blue" href={String(w.work_url)} target="_blank" rel="noopener noreferrer">打开抖音作品 <ExternalLink size={13}/></a>,<Status value={w.verify_status} key="status"/>,<DateCell value={w.created_at} key="time"/>,w.verify_status==="VERIFIED"?<button className="btn btn-sm" key="action" onClick={()=>{setSelected(w);setShow(true);action.reset()}}><MessageCirclePlus size={14}/> 下发官方评论</button>:<span key="waiting" className="muted small">待人工核验</span>
 ])}/>}
 {show&&<Modal title={`向作品 W${selected?.id} 下发官方评论`} onClose={()=>setShow(false)}><form onSubmit={submit}>
 <div className="info-note">官方助理须使用真实的官方身份发布评论。系统不会自动在抖音评论区发表评论。</div>
 <Field label="选择官方助理"><select required value={assistantId} onChange={e=>setAssistantId(e.target.value)}><option value="">请选择</option>{people.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.person_no)} · {String(p.name)}</option>)}</select></Field>
 <Field label="需要发布的评论（须事先核实真实性）"><textarea required value={commentText} onChange={e=>setCommentText(e.target.value)}/></Field>
 <Field label="截止时间"><input required type="datetime-local" value={deadline} onChange={e=>setDeadline(e.target.value)}/></Field>
 <Feedback error={action.error}/><div className="form-actions"><button type="button" className="btn" onClick={()=>setShow(false)}>取消</button><SubmitButton busy={action.busy}>下发评论任务</SubmitButton></div>
 </form></Modal>}
 </>;
}
