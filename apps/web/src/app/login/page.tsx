"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {ArrowRight,ShieldCheck,Workflow,MessageSquare,Layers3} from "lucide-react";
import {afterLoginPath,cardReturnPath} from "@/lib/login-return";
import {Field,Feedback,SubmitButton} from "@/components/Ui";
export default function LoginPage(){
  const router=useRouter();const[username,setUsername]=useState("");const[password,setPassword]=useState("");const[busy,setBusy]=useState(false);const[error,setError]=useState("");
  const [wecom,setWecom]=useState(false),[wecomLink,setWecomLink]=useState("/api/auth/wecom/start");
  const autoStarted=useRef(false);
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search),next=cardReturnPath(params.get("next"));
    const inside=/wxwork/i.test(navigator.userAgent);
    const link="/api/auth/wecom/start"+(next?"?next="+encodeURIComponent(next):"");
    setWecom(inside);setWecomLink(link);
    const failure=params.get("wecom_error");
    if(failure){
      setError(failure==="disabled"?"企业微信免密码登录未启用，请使用账号密码。":failure==="unbound"?"企业微信身份未获授权，请联系管理员检查人员及账号绑定。":failure==="invalid"?"授权已失效，请重新授权或使用账号密码。":"企业微信授权暂不可用，请重试或使用账号密码。");
    }else if(inside&&next&&!autoStarted.current){autoStarted.current=true;window.location.replace(link);}
  },[]);
  async function handleLogin(event:FormEvent){event.preventDefault();setBusy(true);setError("");try{
    const r=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});
    const data=await r.json();if(!r.ok)throw new Error(data.error||"登录失败");
    router.replace(afterLoginPath(new URLSearchParams(window.location.search).get("next"),data.user.role));router.refresh();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <div className="login-page"><div className="login-hero">
    <div className="brand"><span className="brand-mark"><Layers3 size={24}/></span><div><b>SocialTask SCRM</b><small>3COOL · 企业私域协同</small></div></div>
    <div><div className="eyebrow">TASK · CONTENT · CUSTOMER</div><h1>把每一项任务，<br/>变成可追踪的成果。</h1><p>统一管理作品发布、人员执行、评论核验与客户跟进。企业微信触达，业务证据留存，完整过程可追溯。</p><div className="hero-steps"><span><Workflow size={14}/> 流程化工单</span><span><MessageSquare size={14}/> 企业微信通知</span><span><ShieldCheck size={14}/> 权限与审计</span></div></div>
    <div className="bottom-copy">SOCIALTASK SCRM · PRIVATE WORKSPACE · 2026</div>
  </div><div className="login-form-side"><form className="login-box" onSubmit={handleLogin}>
    <div className="login-brand-mobile"><span className="brand-mark"><Layers3 size={23}/></span><span><b>SocialTask SCRM</b><small>3COOL · 企业私域协同</small></span></div><div className="eyebrow blue">安全工作区 / SIGN IN</div><h2>登录工作空间</h2><p>默认使用 SocialTask 账号密码登录。账号由管理员创建；不是 DSH 账号，也不是模型 API Key。</p>
    <Field label="登录账号"><input required autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} placeholder="请输入账号"/></Field>
    <Field label="登录密码"><input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="请输入密码"/></Field>
    <Feedback error={error}/><SubmitButton busy={busy}>登录系统 <ArrowRight size={17}/></SubmitButton>
    {wecom&&<div className="inline-actions"><a className="btn" href={wecomLink}>企业微信免密码登录 <ArrowRight size={16}/></a></div>}
    <div className="login-hint"><strong><ShieldCheck size={16}/> 安全登录</strong><p>身份会话仅保存在 HttpOnly Cookie 中。执行人员仅能访问自己的任务，客户资料按最小权限展示。</p></div>
    <div className="login-footer">3COOL · SocialTask SCRM · 企业内部使用</div>
  </form></div></div>;
}
