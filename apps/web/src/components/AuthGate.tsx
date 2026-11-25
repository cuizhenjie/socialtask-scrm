"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {LoaderCircle} from "lucide-react";
import type {RecordRow} from "@/lib/api";
export function AuthGate({children,adminOnly=false}:{children:React.ReactNode,adminOnly?:boolean}){
  const [user,setUser]=useState<RecordRow|null>(null);const router=useRouter();
  useEffect(()=>{let mounted=true;fetch("/api/auth/session",{cache:"no-store"})
    .then(r=>{if(!r.ok)throw new Error("unauthenticated");return r.json();})
    .then(value=>{if(mounted){if(adminOnly && !["admin","manager"].includes(value.role))router.replace("/m");else setUser(value);}}).catch(()=>{if(mounted)router.replace("/login");});
    return()=>{mounted=false;};},[router,adminOnly]);
  if(!user)return <div className="boot"><LoaderCircle size={25} className="spin"/>正在验证登录身份…</div>;
  return <>{children}</>;
}
