"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import Link from "next/link";
import {Layers3,ClipboardList,CheckCircle2,Clock3,ArrowRight,LogOut,RefreshCcw,ShieldCheck} from "lucide-react";
import {AuthGate} from "@/components/AuthGate";
import {api,type RecordRow,formatDate,display,typeMap} from "@/lib/api";
import {Status,Empty} from "@/components/Ui";
export default function MobileHome(){
 const router=useRouter();const[tasks,setTasks]=useState<RecordRow[]>([]);const[error,setError]=useState("");const[busy,setBusy]=useState(false);
 async function reload(){setBusy(true);try{setTasks(await api<RecordRow[]>("me/tasks"));}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 useEffect(()=>{reload();},[]);
 async function logout(){await fetch("/api/auth/logout",{method:"POST"});router.replace("/login");}
 const pending=tasks.filter(t=>["PENDING","REWORK"].includes(String(t.status))).length;
 const submitted=tasks.filter(t=>t.status==="SUBMITTED").length;
 const done=tasks.filter(t=>t.status==="COMPLETED").length;
 return <AuthGate><div className="mobile-shell"><div className="mobile-head">
  <div className="between"><div className="brand-mini"><span className="brand-mark"><Layers3 size={19}/></span><strong>SocialTask</strong></div><button className="mobile-plain-btn" onClick={logout} aria-label="退出登录"><LogOut size={18}/></button></div>
  <div className="mobile-greeting"><small>MY TASK CENTER</small><h1>我的任务</h1><p>查看发布要求，完成任务并提交处理结果。</p></div></div>
  <div className="mobile-body"><div className="mobile-stats"><div className="mobile-stat"><b>{pending}</b><span>待处理</span></div><div className="mobile-stat"><b>{submitted}</b><span>待审核</span></div><div className="mobile-stat"><b>{done}</b><span>已完成</span></div></div>
  <div className="between" style={{marginBottom:14}}><b className="mobile-section-title">任务列表</b><button className="btn btn-sm" onClick={reload} disabled={busy}><RefreshCcw size={13}/> 刷新</button></div>
  {error&&<div className="form-alert error">{error}</div>}{tasks.length===0?<div className="panel"><Empty message="当前没有被分配的任务"/></div>:tasks.map(t=><div className="mobile-task" key={String(t.id)}>
  <div className="between"><span className="code">{String(t.task_no)}</span><Status value={t.status}/></div>
  <div className="title">{String(t.title)}</div><div className="meta">{display(t.type,typeMap)} · 截止 {formatDate(t.due_at)}</div>
  <div className="mobile-task-foot"><span>执行人：{String(t.assignee_name)}</span>{Boolean(t.overdue_at)&&<span className="warn-text">已超时</span>}</div>
  <Link href={`/m/tasks/${t.id}`} className="btn btn-primary">查看任务并处理 <ArrowRight size={15}/></Link>
  </div>)}
  <div className="mobile-security-note"><ShieldCheck size={17}/> 任务进度和提交记录保存在工作台；请仅上传真实业务证据。</div></div>
  <div className="mobile-bottom"><Link href="/m" className="mobile-tab active"><ClipboardList size={20}/>我的任务</Link><span className="mobile-tab"><CheckCircle2 size={20}/>审核留痕</span><button onClick={logout} className="mobile-tab"><LogOut size={20}/>退出</button></div>
 </div></AuthGate>;
}
