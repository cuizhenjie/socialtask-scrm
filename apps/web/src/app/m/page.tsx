"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import Link from "next/link";
import {Layers3,ClipboardList,CheckCircle2,Clock3,ArrowRight,LogOut,RefreshCcw,ShieldCheck} from "lucide-react";
import {AuthGate} from "@/components/AuthGate";
import {api,type RecordRow,formatDate,display,typeMap} from "@/lib/api";
import {Status,Empty,Feedback} from "@/components/Ui";
type Filter="ALL"|"PENDING"|"SUBMITTED"|"COMPLETED";
function matches(task:RecordRow,filter:Filter){return filter==="ALL"||(filter==="PENDING"?["PENDING","REWORK"].includes(String(task.status)):task.status===filter);}
export default function MobileHome(){
 const router=useRouter();const[tasks,setTasks]=useState<RecordRow[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(true),[filter,setFilter]=useState<Filter>("ALL");
 async function reload(){setBusy(true);setError("");try{setTasks(await api<RecordRow[]>("me/tasks"));}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 useEffect(()=>{reload();},[]);
 async function logout(){await fetch("/api/auth/logout",{method:"POST"});router.replace("/login");}
 const summary=[{label:"待处理",filter:"PENDING" as const,icon:ClipboardList},{label:"待审核",filter:"SUBMITTED" as const,icon:Clock3},{label:"已完成",filter:"COMPLETED" as const,icon:CheckCircle2}];
 const visible=tasks.filter(t=>matches(t,filter));
 return <AuthGate><div className="mobile-shell"><div className="mobile-head">
  <div className="between"><div className="brand-mini"><span className="brand-mark"><Layers3 size={19}/></span><div><strong>SocialTask</strong><small>3COOL · 移动工作台</small></div></div><button className="mobile-plain-btn" type="button" onClick={logout} aria-label="退出登录"><LogOut size={19}/></button></div>
  <div className="mobile-greeting"><small>MY TASK CENTER</small><h1>我的任务</h1><p>查看工单要求、处理任务并提交业务结果。</p></div></div>
  <div className="mobile-body"><div className="mobile-stats">{summary.map(item=><button type="button" key={item.filter} className={`mobile-stat ${filter===item.filter?"selected":""}`} aria-pressed={filter===item.filter} onClick={()=>setFilter(v=>v===item.filter?"ALL":item.filter)}><item.icon size={18}/><b>{busy&&tasks.length===0?"—":tasks.filter(t=>matches(t,item.filter)).length}</b><span>{item.label}</span></button>)}</div>
  <div className="between mobile-list-head"><div><b className="mobile-section-title">{filter==="ALL"?"全部任务":summary.find(item=>item.filter===filter)?.label+"任务"}</b><small className="muted">{visible.length} 条</small></div><div className="inline-actions" style={{margin:0}}>{filter!=="ALL"&&<button type="button" className="btn btn-sm" onClick={()=>setFilter("ALL")}>全部</button>}<button type="button" className="btn btn-sm" onClick={reload} disabled={busy}><RefreshCcw size={13} className={busy?"spin":""}/> 刷新</button></div></div>
  <Feedback error={error}/>{busy&&tasks.length===0?<div className="panel mobile-loading" role="status">正在读取任务…</div>:visible.length===0?<div className="panel"><Empty message={error?"读取失败，请刷新重试":filter==="ALL"?"当前没有被分配的任务":"该状态暂无任务"}/></div>:visible.map(t=><article className="mobile-task" key={String(t.id)}>
  <div className="between"><span className="code">{String(t.task_no)}</span><Status value={t.status}/></div>
  <h2 className="title">{String(t.title)}</h2><div className="meta"><span>{display(t.type,typeMap)}</span><span><Clock3 size={13}/> {formatDate(t.due_at)}</span></div>
  <div className="mobile-task-foot"><span>执行人：{String(t.assignee_name)}</span>{Boolean(t.overdue_at)&&<span className="warn-text">已超时</span>}</div>
  <Link href={`/m/tasks/${t.id}`} className={`btn ${matches(t,"PENDING")?"btn-primary":""}`}>{matches(t,"PENDING")?"查看任务并处理":"查看任务详情"}<ArrowRight size={15}/></Link>
  </article>)}
  <div className="mobile-security-note"><ShieldCheck size={17}/> 任务进度和提交记录保存在工作台；请仅上传真实业务证据。</div></div>
  <nav className="mobile-bottom" aria-label="任务导航"><button type="button" onClick={()=>setFilter("ALL")} aria-pressed={filter==="ALL"} className={`mobile-tab ${filter==="ALL"?"active":""}`}><ClipboardList size={20}/>我的任务</button><button type="button" onClick={()=>setFilter("SUBMITTED")} aria-pressed={filter==="SUBMITTED"} className={`mobile-tab ${filter==="SUBMITTED"?"active":""}`}><Clock3 size={20}/>待审核</button><button type="button" onClick={()=>setFilter("COMPLETED")} aria-pressed={filter==="COMPLETED"} className={`mobile-tab ${filter==="COMPLETED"?"active":""}`}><CheckCircle2 size={20}/>已完成</button></nav>
 </div></AuthGate>;
}
