"use client";
import {useEffect,useState,useCallback} from "react";
import {api,type RecordRow} from "./api";
export function useRows(path:string){
  const [rows,setRows]=useState<RecordRow[]>([]);const[loading,setLoading]=useState(true);const[error,setError]=useState("");
  const reload=useCallback(async()=>{setLoading(true);setError("");try{setRows(await api<RecordRow[]>(path));}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[path]);
  useEffect(()=>{reload()},[reload]);return {rows,loading,error,reload};
}
export function useAction(){
  const[busy,setBusy]=useState(false);const[error,setError]=useState("");const[message,setMessage]=useState("");
  async function run<T>(fn:()=>Promise<T>,success="操作成功"){
    setBusy(true);setError("");setMessage("");try{const result=await fn();setMessage(success);return result;}catch(e){setError((e as Error).message);return null;}finally{setBusy(false);}}
  function reset(){setError("");setMessage("");}
  return {busy,error,message,run,reset};
}
