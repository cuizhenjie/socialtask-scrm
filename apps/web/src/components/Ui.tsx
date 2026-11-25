"use client";
import type {ReactNode} from "react";
import {X,Inbox,LoaderCircle} from "lucide-react";
import {display,formatDate,stateMap,typeMap} from "@/lib/api";
export function Status({value,type=false}:{value:unknown,type?:boolean}){
  const key=String(value??"");
  const cls=(["COMPLETED","APPROVED","VERIFIED","ACTIVE","SENT"].includes(key)?"pill-green":
    ["CANCELLED","STOPPED","REFUSED","FAILED","REJECTED"].includes(key)?"pill-red":
    ["SUBMITTED","FOLLOWUP_PENDING","REWORK","RETRY"].includes(key)?"pill-orange":"pill-blue");
  return <span className={`pill ${cls}`}>{display(value,type?typeMap:stateMap)}</span>;
}
export function PageHeading({eyebrow,title,description,actions}:{eyebrow?:string,title:string,description?:string,actions?:ReactNode}){
  return <div className="page-heading"><div><div className="page-eyebrow">{eyebrow||"SOCIALTASK / 工作管理"}</div><h1>{title}</h1>{description&&<p>{description}</p>}</div><div>{actions}</div></div>;
}
export function Empty({message="目前没有符合条件的数据"}:{message?:string}){
  return <div className="empty"><Inbox size={27}/><p>{message}</p></div>;
}
export function Modal({title,onClose,children}:{title:string,onClose:()=>void,children:ReactNode}){
  return <div className="modal-shade" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
    <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="关闭"><X size={19}/></button></div><div className="modal-content">{children}</div>
  </div></div>;
}
export function Field({label,children,tip}:{label:string,children:ReactNode,tip?:string}){
  return <div className="form-group"><label>{label}</label>{children}{tip&&<small>{tip}</small>}</div>;
}
export function Table({head,rows}:{head:string[],rows:ReactNode[][]}){
  return <div className="table-panel"><div className="table-wrap"><table><thead><tr>{head.map((col,i)=><th key={i}>{col}</th>)}</tr></thead><tbody>{rows.map((cells,i)=><tr key={i}>{cells.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>{rows.length===0&&<Empty/>}<div className="table-foot">共 {rows.length} 条 · 最近 500 条记录</div></div>;
}
export function Feedback({message,error}:{message?:string,error?:string}){
  return <>{error&&<div className="form-alert error">{error}</div>}{message&&<div className="form-alert success">{message}</div>}</>;
}
export function SubmitButton({busy,children}:{busy:boolean,children:ReactNode}){
  return <button type="submit" className="btn btn-primary" disabled={busy}>{busy?<><LoaderCircle size={14} className="spin"/>提交中</>:children}</button>;
}
export function DateCell({value}:{value:unknown}){return <span className="nowrap small">{formatDate(value)}</span>}
