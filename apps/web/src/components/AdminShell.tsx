"use client";
import type {ReactNode} from "react";
import {usePathname,useRouter} from "next/navigation";
import Link from "next/link";
import {useState} from "react";
import {LayoutDashboard,UsersRound,Package,Send,ClipboardList,Clapperboard,MessageSquareText,ContactRound,Mail,Shield,Timer,BarChart3,PanelLeftClose,Layers3,LogOut,Smartphone,Search,Menu,ChevronRight} from "lucide-react";
import {AuthGate} from "./AuthGate";
const nav=[
  {href:"/admin",label:"工作台概览",icon:LayoutDashboard},
  {href:"/admin/people",label:"人员与账号",icon:UsersRound},
  {href:"/admin/content",label:"内容素材",icon:Package},
  {href:"/admin/batches",label:"发布批次",icon:Send},
  {href:"/admin/tasks",label:"统一任务中心",icon:ClipboardList},
  {href:"/admin/works",label:"作品管理",icon:Clapperboard},
  {href:"/admin/comments",label:"评论管理",icon:MessageSquareText},
  {href:"/admin/customers",label:"客户管理",icon:ContactRound},
  {href:"/admin/messages",label:"企微消息工作台",icon:Mail},
  {href:"/admin/sla",label:"SLA 策略管理",icon:Timer},
  {href:"/admin/reports",label:"工单统计分析",icon:BarChart3},
  {href:"/admin/audit",label:"审计日志",icon:Shield}
];
export function AdminShell({children}:{children:ReactNode}){
  const path=usePathname();const router=useRouter();const[menuOpen,setMenuOpen]=useState(false);
  const title=nav.find(n=>n.href===path)?.label||"工作台";
  async function logout(){await fetch("/api/auth/logout",{method:"POST"});router.replace("/login");}
  return <AuthGate adminOnly><div className="app-shell">
    {menuOpen&&<div className="nav-overlay" onClick={()=>setMenuOpen(false)}/>}
    <aside className={`sidebar ${menuOpen?"open":""}`}>
      <Link href="/admin" className="brand"><span className="brand-mark"><Layers3 size={22}/></span><div><b>SocialTask</b><small>WORK MANAGEMENT</small></div></Link>
      <div className="side-label">业务协同</div>
      <nav>{nav.slice(0,8).map(item=><Link key={item.href} href={item.href} onClick={()=>setMenuOpen(false)} className={`nav-link ${path===item.href?"active":""}`}><item.icon size={17}/>{item.label}</Link>)}
      <div className="side-label">系统与管理</div>{nav.slice(8).map(item=><Link key={item.href} href={item.href} onClick={()=>setMenuOpen(false)} className={`nav-link ${path===item.href?"active":""}`}><item.icon size={17}/>{item.label}</Link>)}
      </nav><div className="side-bottom"><div className="help-card"><b>移动任务端</b><p>执行人员在企业微信中打开 H5 任务卡片，提交作品链接与结果。</p><Link href="/m" className="btn btn-sm"><Smartphone size={13}/> 打开移动端</Link></div><div className="side-user"><div className="user-avatar">ST</div><div><b>管理工作台</b><small>Role based access</small></div><button className="icon-btn" onClick={logout} title="退出登录"><LogOut size={16}/></button></div></div>
    </aside><div className="shell-main"><header className="topbar">
      <div className="breadcrumb"><button className="icon-btn menu-toggle" onClick={()=>setMenuOpen(!menuOpen)} aria-label="打开导航"><Menu size={21}/></button><span>业务管理</span><ChevronRight size={14}/><span className="active">{title}</span></div>
      <div className="top-actions"><div className="top-search-note"><Search size={15}/> 全流程协同与证据追踪</div><span className="badge-test">正式工程 · v1.0</span><Link className="icon-btn" href="/m" title="移动任务端"><Smartphone size={19}/></Link><button className="icon-btn" onClick={logout} title="退出"><LogOut size={18}/></button></div>
    </header><main className="content">{children}</main></div>
  </div></AuthGate>;
}
