"use client";
import {useState,useEffect,type FormEvent} from "react";
import {Plus,Send,RefreshCcw} from "lucide-react";
import {api,jsonPost,dateInputFuture,type RecordRow} from "@/lib/api";
import {useRows,useAction} from "@/lib/hooks";
import {PageHeading,Modal,Field,Feedback,SubmitButton,Table,DateCell} from "@/components/Ui";
export default function Batches(){
 const{rows,loading,error,reload}=useRows("publish-batches");const action=useAction();const[show,setShow]=useState(false);const[people,setPeople]=useState<RecordRow[]>([]);const[content,setContent]=useState<RecordRow[]>([]);
 const[title,setTitle]=useState("");const[contentId,setContentId]=useState("");const[selected,setSelected]=useState<number[]>([]);const[deadline,setDeadline]=useState(dateInputFuture(24));const[interval,setInterval]=useState(60);const[max,setMax]=useState(10);
 useEffect(()=>{Promise.all([api<RecordRow[]>("people/assignees"),api<RecordRow[]>("content-packages")]).then(([p,c])=>{setPeople(p);setContent(c.filter(x=>x.review_status==="APPROVED"));}).catch(()=>{});},[]);
 async function submit(e:FormEvent){e.preventDefault();const result=await action.run(()=>jsonPost("publish-batches",{title,contentId:Number(contentId),assigneeIds:selected,deadline:new Date(deadline).toISOString(),reminderInterval:interval,reminderMax:max}),"批次已下发");if(result){setShow(false);reload();}}
 function toggle(id:number){setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);}
 return <><PageHeading eyebrow="PUBLISH CAMPAIGNS" title="发布批次" description="一次选择多个素人，由系统创建独立任务卡片并生成待处理通知。" actions={<button className="btn btn-primary" onClick={()=>{action.reset();setShow(true)}}><Plus size={16}/> 新建发布批次</button>}/>
 <Feedback error={error||action.error} message={action.message}/>{loading?<p className="muted">加载中…</p>:<Table head={["批次编号","名称","关联内容包","截止时间","派发任务","创建时间"]} rows={rows.map(row=>[
 <span className="code" key="id">B{String(row.id)}</span>,<b key="title">{String(row.title)}</b>,String(row.content_title),<DateCell value={row.deadline_at} key="due"/>,<strong key="cnt">{String(row.task_count)}</strong>,<DateCell value={row.created_at} key="time"/>
 ])}/>}
 {show&&<Modal title="创建并分配发布任务" onClose={()=>setShow(false)}><form onSubmit={submit}>
 <Field label="批次名称"><input value={title} onChange={e=>setTitle(e.target.value)} required placeholder="2026-11-24 内容发布"/></Field>
 <Field label="选择已审核内容包"><select required value={contentId} onChange={e=>setContentId(e.target.value)}><option value="">请选择内容包</option>{content.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.title)}</option>)}</select></Field>
 <Field label={`选择发布人员（已选 ${selected.length} 人）`}><div className="multi-picker">{people.filter(p=>["creator","author"].includes(String(p.person_type))).map(p=><label key={String(p.id)} className="person-choice"><input type="checkbox" checked={selected.includes(Number(p.id))} onChange={()=>toggle(Number(p.id))}/><span>{String(p.person_no)} · {String(p.name)} <small>{String(p.group_name)}</small></span></label>)}</div></Field>
 <div className="form-grid"><Field label="截止时间"><input type="datetime-local" value={deadline} onChange={e=>setDeadline(e.target.value)} required/></Field><Field label="提醒间隔（分钟）"><input type="number" min={5} max={1440} value={interval} onChange={e=>setInterval(Number(e.target.value))}/></Field></div>
 <Field label="最大自动催办次数"><input type="number" min={1} max={10} value={max} onChange={e=>setMax(Number(e.target.value))}/></Field>
 <Feedback error={action.error}/><div className="form-actions"><button className="btn" type="button" onClick={()=>setShow(false)}>取消</button><SubmitButton busy={action.busy}><Send size={15}/> 创建 {selected.length} 条任务</SubmitButton></div>
 </form></Modal>}
 </>;
}
