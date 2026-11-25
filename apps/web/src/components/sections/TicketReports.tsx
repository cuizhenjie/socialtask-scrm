"use client";
import {useEffect,useState} from "react";
import {BarChart3,RefreshCcw,Clock3,AlertTriangle,CheckCircle2,ClipboardList} from "lucide-react";
import {api,display,typeMap,type RecordRow} from "@/lib/api";
import {PageHeading,Table,Status} from "@/components/Ui";
type TicketReport={summary:RecordRow,by_status:RecordRow[],by_type:RecordRow[],by_group:RecordRow[],by_priority:RecordRow[],by_assignee:RecordRow[],daily:RecordRow[]};
export default function TicketReports(){
 const[from,setFrom]=useState(""),[to,setTo]=useState(""),[group,setGroup]=useState(""),[tag,setTag]=useState(""),[type,setType]=useState(""),[status,setStatus]=useState("");
 const[groups,setGroups]=useState<RecordRow[]>([]),[tags,setTags]=useState<RecordRow[]>([]);
 const[report,setReport]=useState<TicketReport|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{api<RecordRow[]>("people/groups").then(setGroups).catch(()=>{});api<RecordRow[]>("people/tags").then(setTags).catch(()=>{});},[]);
 function load(){const params=new URLSearchParams();if(from)params.set("from",from);if(to)params.set("to",to);if(group)params.set("group",group);if(tag)params.set("tagId",tag);if(type)params.set("type",type);if(status)params.set("status",status);
  setBusy(true);setError("");api<TicketReport>("reports/tickets"+(params.size?"?"+params.toString():"")).then(setReport).catch(e=>setError(e.message)).finally(()=>setBusy(false));}
 useEffect(()=>{load();},[]); // initial full-range report; filter changes apply when clicking query
 const summary=report?.summary||{},cards=[{label:"工单总数",value:summary.total,icon:ClipboardList},{label:"审核完成",value:summary.completed,icon:CheckCircle2},{label:"待审核",value:summary.awaiting_review,icon:Clock3},{label:"响应 SLA 违约",value:summary.response_breached,icon:AlertTriangle},{label:"解决 SLA 违约",value:summary.resolution_breached,icon:BarChart3}];
 const pct=Number(summary.completed||0)>0?Math.round(Number(summary.resolution_sla_met||0)/Number(summary.completed)*100):null;
 return <><PageHeading eyebrow="TICKETS / ANALYTICS" title="工单运营与 SLA 统计" description="按日期、角色分组、人员标签、工单类型筛选，分析任务完成、违约、超时与人员负载。" actions={<button className="btn btn-primary" onClick={load} disabled={busy}><RefreshCcw size={14}/> {busy?"统计中":"查询统计"}</button>}/>
 <div className="table-toolbar"><div className="filters"><label className="small">从 <input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="small">至 <input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
 <select className="filter-select" value={group} onChange={e=>setGroup(e.target.value)}><option value="">全部分组</option>{groups.map(x=><option key={String(x.id)}>{String(x.name)}</option>)}</select>
 <select className="filter-select" value={tag} onChange={e=>setTag(e.target.value)}><option value="">全部标签</option>{tags.map(x=><option value={String(x.id)} key={String(x.id)}>{String(x.name)}</option>)}</select>
 <select className="filter-select" value={type} onChange={e=>setType(e.target.value)}><option value="">全部工单类型</option>{["PUBLISH","OFFICIAL_COMMENT","CONTACT_AUTHOR","CONTACT_ASSISTANT","FOLLOWUP","SERVICE_TICKET"].map(x=><option value={x} key={x}>{display(x,typeMap)}</option>)}</select>
 <select className="filter-select" value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部状态</option>{["PENDING","SUBMITTED","REWORK","COMPLETED","STOPPED","CANCELLED","PAUSED"].map(x=><option key={x}>{x}</option>)}</select></div></div>
 {error&&<div className="form-alert error">{error}</div>}
 <div className="kpi-grid" style={{gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))"}}>{cards.map(card=><div className="kpi-card" key={card.label}><div className="kpi-top"><small>{card.label}</small><card.icon size={18}/></div><div className="kpi-value">{String(card.value??"—")}</div></div>)}</div>
 <div className="info-note" style={{margin:"15px 0"}}>已审核完成工单的解决 SLA 达标率：<b>{pct===null?"暂无已完成工单":pct+"%"}</b>。统计时间按 UTC 创建时间筛选。违约与业务截止超时分开计算。</div>
 {report&&<><div className="data-grid">
 <div className="panel"><div className="panel-head"><div><div className="panel-title">分组完成情况</div><div className="panel-subtitle">按任务当前执行人所属分组统计</div></div></div><div className="panel-body">{report.by_group.map(x=><div className="progress-row" key={String(x.dimension)}><span className="progress-name">{String(x.dimension)}</span><div className="progress-bar"><div className="progress-fill" style={{width:`${Number(x.total)?Number(x.completed)/Number(x.total)*100:0}%`}}/></div><span className="progress-count">{String(x.completed)}/{String(x.total)}</span></div>)}</div></div>
 <div className="panel"><div className="panel-head"><div className="panel-title">类型分布</div></div><div className="panel-body">{report.by_type.map(x=><div className="progress-row" key={String(x.dimension)}><span className="progress-name">{display(x.dimension,typeMap)}</span><div className="progress-bar"><div className="progress-fill mint" style={{width:`${Number(summary.total)?Number(x.total)/Number(summary.total)*100:0}%`}}/></div><span className="progress-count">{String(x.total)}</span></div>)}</div></div></div>
 <h3 className="section-label">执行人员绩效 / SLA</h3><Table head={["执行人","分组","总量","审核完成","解决 SLA 违约"]} rows={report.by_assignee.map(x=>[<b key="name">{String(x.name)}</b>,String(x.group_name),String(x.total),String(x.completed),String(x.sla_breached)])}/>
 <h3 className="section-label">最近 60 个有工单的日期</h3><Table head={["日期","新增工单","已完成（当前状态）"]} rows={report.daily.map(x=>[String(x.day),String(x.created),String(x.completed)])}/>
 </>}
 </>;
}
