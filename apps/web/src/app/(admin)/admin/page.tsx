"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {ClipboardList,CheckCircle2,Clock3,AlertTriangle,ArrowUpRight,Activity,UsersRound,PlayCircle,RefreshCcw} from "lucide-react";
import {api,formatDate,display,typeMap,type RecordRow} from "@/lib/api";
import {PageHeading,Status,Empty} from "@/components/Ui";
type Dash={total_tasks:number,pending:number,completed:number,need_review:number,overdue:number,works:number,people:number,customers:number,by_type:Array<{type:string,total:number,done:number}>,recent_tasks:RecordRow[]};
export default function Dashboard(){
 const[data,setData]=useState<Dash|null>(null);const[error,setError]=useState("");
 function load(){api<Dash>("dashboard").then(setData).catch(e=>setError(e.message));}
 useEffect(()=>{load()},[]);
 const cards=[{label:"全部工单",value:data?.total_tasks??"—",icon:ClipboardList,color:"kpi-blue",foot:"记录全部派单和处理历史"},
   {label:"已完成",value:data?.completed??"—",icon:CheckCircle2,color:"kpi-green",foot:"审核通过并形成业务记录"},
   {label:"待审核",value:data?.need_review??"—",icon:Clock3,color:"kpi-orange",foot:"等待管理员核验结果"},
   {label:"已超时",value:data?.overdue??"—",icon:AlertTriangle,color:"kpi-purple",foot:"需要转派或人工处理"}];
 return <><PageHeading eyebrow="BUSINESS OVERVIEW" title="协同运营工作台" description="从任务下发到客户跟进，实时掌握各环节进度。" actions={<button onClick={load} className="btn"><RefreshCcw size={15}/> 刷新数据</button>}/>
 {error&&<div className="form-alert error">{error}</div>}
 <div className="kpi-grid">{cards.map(card=><div className="kpi-card" key={card.label}><div className="kpi-top"><small>{card.label}</small><div className={`kpi-icon ${card.color}`}><card.icon size={20}/></div></div><div className="kpi-value">{card.value}</div><div className="kpi-foot">{card.foot}</div></div>)}</div>
 <div className="data-grid"><div className="panel"><div className="panel-head"><div><div className="panel-title">任务完成情况</div><div className="panel-subtitle">按照 SOP 五类工单统计</div></div><Link className="btn btn-sm" href="/admin/tasks">查看任务 <ArrowUpRight size={14}/></Link></div><div className="panel-body">
 {(data?.by_type||[]).length===0?<Empty message="暂未创建任务，先从内容素材开始"/>:data?.by_type.map((row,index)=><div className="progress-row" key={row.type}><span className="progress-name">{display(row.type,typeMap)}</span><div className="progress-bar"><div className={`progress-fill ${["","mint","orange","purple"][index%4]}`} style={{width:`${row.total?row.done/row.total*100:0}%`}}/></div><span className="progress-count">{row.done}/{row.total}</span></div>)}
 </div></div><div className="panel"><div className="panel-head"><div><div className="panel-title">关键业务对象</div><div className="panel-subtitle">从内容到客户的完整关联</div></div><Activity size={18} color="#6783b5"/></div><div className="panel-body">
 {[{name:"参与人员",value:data?.people,icon:UsersRound,href:"/admin/people"},{name:"已登记作品",value:data?.works,icon:PlayCircle,href:"/admin/works"},{name:"客户档案",value:data?.customers,icon:CheckCircle2,href:"/admin/customers"}].map(item=><Link href={item.href} className="todo-entry" key={item.name}><span className="todo-icon"><item.icon size={18}/></span><span className="todo-text"><b>{item.name}</b><small>点击查看关联业务记录</small></span><span className="tag-number">{item.value??"—"}</span></Link>)}
 <div className="info-note" style={{marginTop:14}}>首版抖音数据采用人工确认；企业微信通知须在配置真实应用凭据后才能发送。</div>
 </div></div></div>
 <div className="panel" style={{marginTop:19}}><div className="panel-head"><div><div className="panel-title">最新任务</div><div className="panel-subtitle">按任务生成时间倒序</div></div><Link className="btn btn-sm" href="/admin/tasks">查看全部</Link></div><div className="panel-body"><div className="table-wrap"><table><thead><tr><th>编号</th><th>任务名称</th><th>类别</th><th>执行人</th><th>状态</th><th>截止时间</th></tr></thead><tbody>{data?.recent_tasks.map(row=><tr key={String(row.id)}><td><Link href={`/admin/tasks?task=${row.id}`} className="code link-blue">{String(row.task_no)}</Link></td><td>{String(row.title)}</td><td>{display(row.type,typeMap)}</td><td>{String(row.assignee_name)}</td><td><Status value={row.status}/></td><td>{formatDate(row.due_at)}</td></tr>)}</tbody></table></div></div></div>
 </>;
}
