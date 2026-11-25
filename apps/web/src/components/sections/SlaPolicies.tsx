"use client";
import {useState,type FormEvent} from "react";
import {Plus,Settings2,RefreshCcw} from "lucide-react";
import {api,jsonPost,type RecordRow,display,typeMap} from "@/lib/api";
import {useRows,useAction} from "@/lib/hooks";
import {PageHeading,Modal,Field,Feedback,SubmitButton,Table,Status} from "@/components/Ui";
type PolicyForm={name:string,taskType:string,priority:string,responseMinutes:number,resolutionMinutes:number,calendarMode:string,timezone:string,businessStart:string,businessEnd:string,workingDays:string,enabled:boolean,responseWarningMinutes:number,resolutionWarningMinutes:number};
const empty:PolicyForm={name:"",taskType:"ALL",priority:"NORMAL",responseMinutes:120,resolutionMinutes:1440,calendarMode:"24X7",timezone:"Asia/Shanghai",businessStart:"09:00",businessEnd:"18:00",workingDays:"1,2,3,4,5",enabled:true,responseWarningMinutes:30,resolutionWarningMinutes:60};
export default function SlaPolicies(){
 const{rows,loading,error,reload}=useRows("sla/policies"),action=useAction();
 const[open,setOpen]=useState(false),[selected,setSelected]=useState<RecordRow|null>(null),[form,setForm]=useState<PolicyForm>(empty);
 function set<K extends keyof PolicyForm>(key:K,value:PolicyForm[K]){setForm(v=>({...v,[key]:value}));}
 function edit(row?:RecordRow){action.reset();setSelected(row||null);setForm(row?{
  name:String(row.name),taskType:String(row.task_type),priority:String(row.priority),responseMinutes:Number(row.response_minutes),resolutionMinutes:Number(row.resolution_minutes),
  calendarMode:String(row.calendar_mode),timezone:String(row.timezone),businessStart:String(row.business_start),businessEnd:String(row.business_end),workingDays:String(row.working_days),enabled:Boolean(row.enabled),responseWarningMinutes:Number(row.response_warning_minutes||0),resolutionWarningMinutes:Number(row.resolution_warning_minutes||0)
 }:empty);setOpen(true);}
 async function submit(e:FormEvent){e.preventDefault();const result=await action.run(()=>selected?
  api(`sla/policies/${selected.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)}):jsonPost("sla/policies",form),"SLA 策略已保存");
  if(result){setOpen(false);reload();}}
 return <><PageHeading eyebrow="SLA / SERVICE LEVEL" title="工单 SLA 策略" description="按工单类型与优先级设定首次响应和解决时限。支持 7×24 与工作时段日历，已有工单保持创建时的策略快照。" actions={<div className="inline-actions" style={{margin:0}}><button className="btn" onClick={reload}><RefreshCcw size={15}/> 刷新</button><button className="btn btn-primary" onClick={()=>edit()}><Plus size={15}/> 新建策略</button></div>}/>
 <div className="info-note" style={{marginBottom:15}}>首次响应 = 执行人第一次提交结果；解决完成 = 管理员审核通过。审核等待阶段持续计时；节假日例外日、暂停时钟与二次升级规则尚不支持。优先匹配相同类型与优先级的策略，找不到时使用 ALL 通用策略。</div>
 <Feedback error={error}/>{loading?<p className="muted">载入 SLA 策略…</p>:<Table head={["策略","工单类型","优先级","首次响应","解决时限","计时方式","工作时间","启用","操作"]} rows={rows.map(p=>[
 <b key="name">{String(p.name)}</b>,display(p.task_type,typeMap),<span className="tiny-tag" key="pr">{String(p.priority)}</span>,`${p.response_minutes} 分钟`,`${p.resolution_minutes} 分钟`,String(p.calendar_mode)==="24X7"?"7×24":"工作时间",String(p.calendar_mode)==="24X7"?"全天":`${p.business_start}–${p.business_end} · ${p.working_days}`,
 <Status key="enabled" value={p.enabled?"ACTIVE":"INACTIVE"}/>,<button key="edit" className="btn btn-sm" onClick={()=>edit(p)}><Settings2 size={14}/> 配置</button>
 ])}/>}
 {open&&<Modal title={selected?"编辑 SLA 策略":"新增 SLA 策略"} onClose={()=>setOpen(false)}><form onSubmit={submit}>
  <Field label="策略名称"><input required value={form.name} onChange={e=>set("name",e.target.value)}/></Field>
  <div className="form-grid"><Field label="工单类型"><select value={form.taskType} onChange={e=>set("taskType",e.target.value)}><option value="ALL">全部类型（默认）</option>{["PUBLISH","OFFICIAL_COMMENT","CONTACT_AUTHOR","CONTACT_ASSISTANT","FOLLOWUP","SERVICE_TICKET"].map(x=><option key={x} value={x}>{display(x,typeMap)}</option>)}</select></Field><Field label="优先级"><select value={form.priority} onChange={e=>set("priority",e.target.value)}><option value="NORMAL">普通</option><option value="HIGH">高</option><option value="URGENT">紧急</option></select></Field>
  <Field label="首次响应时限（分钟）"><input required type="number" min={1} max={525600} value={form.responseMinutes} onChange={e=>set("responseMinutes",Number(e.target.value))}/></Field><Field label="解决时限（分钟）"><input required type="number" min={1} max={525600} value={form.resolutionMinutes} onChange={e=>set("resolutionMinutes",Number(e.target.value))}/></Field></div>
  <div className="form-grid"><Field label="首次响应提前预警（分钟，0 关闭）"><input type="number" min={0} max={form.responseMinutes} value={form.responseWarningMinutes} onChange={e=>set("responseWarningMinutes",Number(e.target.value))}/></Field><Field label="解决时限提前预警（分钟，0 关闭）"><input type="number" min={0} max={form.resolutionMinutes} value={form.resolutionWarningMinutes} onChange={e=>set("resolutionWarningMinutes",Number(e.target.value))}/></Field></div>
  <Field label="日历模式"><select value={form.calendarMode} onChange={e=>set("calendarMode",e.target.value)}><option value="24X7">7×24 持续计时</option><option value="BUSINESS_HOURS">工作时段内计时</option></select></Field>
  {form.calendarMode==="BUSINESS_HOURS"&&<><Field label="时区"><input required value={form.timezone} onChange={e=>set("timezone",e.target.value)} placeholder="Asia/Shanghai"/></Field><div className="form-grid"><Field label="上班开始"><input type="time" value={form.businessStart} onChange={e=>set("businessStart",e.target.value)}/></Field><Field label="下班结束"><input type="time" value={form.businessEnd} onChange={e=>set("businessEnd",e.target.value)}/></Field></div><Field label="工作日（周一=1，周日=7）"><input value={form.workingDays} onChange={e=>set("workingDays",e.target.value)} placeholder="1,2,3,4,5"/></Field></>}
  <label className="check-line"><input type="checkbox" checked={form.enabled} onChange={e=>set("enabled",e.target.checked)}/> 启用策略（只影响新任务或重新调整优先级的待处理任务）</label>
  <Feedback error={action.error} message={action.message}/><div className="form-actions"><button type="button" className="btn" onClick={()=>setOpen(false)}>取消</button><SubmitButton busy={action.busy}>保存策略</SubmitButton></div>
 </form></Modal>}
 </>;
}
