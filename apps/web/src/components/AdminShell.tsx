"use client";
import {useEffect,useState,type ReactNode} from "react";
import {usePathname,useRouter} from "next/navigation";
import Link from "next/link";
import {LayoutDashboard,UsersRound,Package,Send,ClipboardList,Clapperboard,MessageSquareText,ContactRound,Mail,Shield,Timer,BarChart3,PanelLeftClose,PanelLeftOpen,Layers3,LogOut,Smartphone,Menu,ChevronRight,X,Settings} from "lucide-react";
import {AuthGate} from "./AuthGate";
const groups=[
  {title:"运营工作台",items:[{href:"/admin",label:"工作台概览",icon:LayoutDashboard},{href:"/admin/messages",label:"企微消息工作台",icon:Mail},{href:"/admin/tasks",label:"统一任务中心",icon:ClipboardList}]},
  {title:"私域与内容",items:[{href:"/admin/people",label:"人员与账号",icon:UsersRound},{href:"/admin/customers",label:"客户管理",icon:ContactRound},{href:"/admin/content",label:"内容素材",icon:Package},{href:"/admin/batches",label:"发布批次",icon:Send},{href:"/admin/works",label:"作品管理",icon:Clapperboard},{href:"/admin/comments",label:"评论管理",icon:MessageSquareText}]},
  {title:"工单与管理",items:[{href:"/admin/ticket-templates",label:"工单模板",icon:ClipboardList},{href:"/admin/sla",label:"SLA 策略管理",icon:Timer},{href:"/admin/reports",label:"工单统计分析",icon:BarChart3},{href:"/admin/audit",label:"审计日志",icon:Shield},{href:"/admin/settings",label:"全局设置",icon:Settings}]}
];
export function AdminShell({children}:{children:ReactNode}){
  const path=usePathname(),router=useRouter();
  const [menuOpen,setMenuOpen]=useState(false),[collapsed,setCollapsed]=useState(false);
  const title=groups.flatMap(group=>group.items).find(item=>item.href===path)?.label||"工作台";
  useEffect(()=>{setMenuOpen(false)},[path]);
  useEffect(()=>{if(!menuOpen)return;const close=(e:KeyboardEvent)=>{if(e.key==="Escape")setMenuOpen(false)};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close)},[menuOpen]);
  async function logout(){await fetch("/api/auth/logout",{method:"POST"});router.replace("/login");}
  return <AuthGate adminOnly><div className={`app-shell ${collapsed?"sidebar-collapsed":""}`}>
    <a href="#main-content" className="skip-link">跳转到工作区</a>
    {menuOpen&&<button type="button" className="nav-overlay" aria-label="关闭导航" onClick={()=>setMenuOpen(false)}/>}
    <aside id="socialtask-navigation" className={`sidebar ${menuOpen?"open":""}`}>
      <Link href="/admin" className="brand" title="3COOL · SocialTask SCRM"><span className="brand-mark"><Layers3 size={23}/></span><div className="brand-copy"><b>SocialTask <span>SCRM</span></b><small>3COOL · 企业私域协同</small></div></Link>
      <button type="button" className="icon-btn nav-close" onClick={()=>setMenuOpen(false)} aria-label="关闭导航"><X size={18}/></button>
      <nav aria-label="后台模块">{groups.map(group=><div className="nav-group" key={group.title}><div className="side-label">{group.title}</div>{group.items.map(item=><Link key={item.href} href={item.href} onClick={()=>setMenuOpen(false)} title={item.label} aria-current={path===item.href?"page":undefined} className={`nav-link ${path===item.href?"active":""}`}><item.icon size={18} aria-hidden="true"/><span>{item.label}</span></Link>)}</div>)}</nav>
      <div className="side-bottom"><div className="help-card"><Smartphone size={17}/><div><b>移动任务端</b><p>打开工单并提交业务证据</p></div><Link href="/m" className="btn btn-sm" aria-label="打开移动任务端"><ChevronRight size={15}/></Link></div><div className="side-user"><div className="user-avatar">ST</div><div className="side-user-copy"><b>管理工作台</b><small>角色权限保护</small></div><button type="button" className="icon-btn" onClick={logout} aria-label="退出登录" title="退出登录"><LogOut size={17}/></button></div></div>
    </aside>
    <div className="shell-main"><header className="topbar"><div className="breadcrumb">
      <button type="button" className="icon-btn menu-toggle" aria-controls="socialtask-navigation" aria-expanded={menuOpen} onClick={()=>setMenuOpen(v=>!v)} aria-label="打开导航"><Menu size={21}/></button>
      <button type="button" className="icon-btn desktop-collapse" aria-controls="socialtask-navigation" aria-expanded={!collapsed} onClick={()=>setCollapsed(v=>!v)} aria-label={collapsed?"展开导航":"收起导航"}>{collapsed?<PanelLeftOpen size={19}/>:<PanelLeftClose size={19}/>}</button>
      <span className="crumb-root">工作台</span><ChevronRight size={14} className="crumb-root"/><span className="active">{title}</span></div>
      <div className="top-actions"><span className="workspace-label"><Shield size={15}/> 企业内部工作区</span><Link className="icon-btn" href="/m" title="移动任务端" aria-label="移动任务端"><Smartphone size={19}/></Link><div className="topbar-divider"/><button type="button" className="icon-btn" onClick={logout} aria-label="退出登录" title="退出登录"><LogOut size={18}/></button></div>
    </header><main id="main-content" className="content" tabIndex={-1}>{children}</main></div>
  </div></AuthGate>;
}
