"use client";
import {Children,cloneElement,isValidElement,useEffect,useId,useRef,type ReactElement,type ReactNode} from "react";
import {X,Inbox,LoaderCircle} from "lucide-react";
import {display,formatDate,stateMap,typeMap} from "@/lib/api";
export function Status({value,type=false}:{value:unknown,type?:boolean}){
  const key=String(value??"");
  const cls=["COMPLETED","APPROVED","VERIFIED","ACTIVE","SENT","MET","ON_TRACK"].includes(key)?"pill-green":
    ["CANCELLED","STOPPED","REFUSED","FAILED","REJECTED","BREACHED","INACTIVE"].includes(key)?"pill-red":
    ["SUBMITTED","FOLLOWUP_PENDING","REWORK","RETRY","AT_RISK","UNKNOWN"].includes(key)?"pill-orange":
    ["PAUSED","SKIPPED","NOT_CONFIGURED"].includes(key)?"pill-gray":"pill-blue";
  return <span className={`pill ${cls}`}>{display(value,type?typeMap:stateMap)}</span>;
}
export function PageHeading({eyebrow,title,description,actions}:{eyebrow?:string,title:string,description?:string,actions?:ReactNode}){
  return <header className="page-heading"><div className="heading-copy"><div className="page-eyebrow">{eyebrow||"SOCIALTASK / 工作管理"}</div><h1>{title}</h1>{description&&<p>{description}</p>}</div>{actions&&<div className="heading-actions">{actions}</div>}</header>;
}
export function Empty({message="目前没有符合条件的数据"}:{message?:string}){
  return <div className="empty" role="status"><span className="empty-illustration"><Inbox size={28} strokeWidth={1.6}/></span><b>暂无记录</b><p>{message}</p></div>;
}
export function Modal({title,onClose,children}:{title:string,onClose:()=>void,children:ReactNode}){
  const panel=useRef<HTMLDivElement>(null),close=useRef(onClose),titleId=useId();
  close.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const overflow=document.body.style.overflow;document.body.style.overflow="hidden";
    panel.current?.focus();
    function keydown(e:KeyboardEvent){
      if(e.key==="Escape"){e.preventDefault();close.current();return;}
      if(e.key!=="Tab"||!panel.current)return;
      const focusable=Array.from(panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(el=>el.getClientRects().length>0&&el.tabIndex>=0);
      const first=focusable[0],last=focusable[focusable.length-1];
      if(!first){e.preventDefault();panel.current.focus();return;}
      if(e.shiftKey&&(document.activeElement===first||!focusable.includes(document.activeElement as HTMLElement))){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&(document.activeElement===last||!focusable.includes(document.activeElement as HTMLElement))){e.preventDefault();first.focus();}
    }
    document.addEventListener("keydown",keydown);
    return()=>{document.removeEventListener("keydown",keydown);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus();};
  },[]);
  return <div className="modal-shade" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={panel} tabIndex={-1} className="modal-card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <div className="modal-head"><h2 id={titleId}>{title}</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><X size={19}/></button></div><div className="modal-content">{children}</div>
  </div></div>;
}
export function Field({label,children,tip}:{label:string,children:ReactNode,tip?:string}){
  const id=useId(),labelId=`${id}-label`,tipId=`${id}-tip`;
  const nodes=Children.toArray(children);
  const isControl=(node:ReactNode):node is ReactElement<{id?:string;required?:boolean;"aria-describedby"?:string;"aria-labelledby"?:string}>=>isValidElement(node)&&typeof node.type==="string"&&["input","select","textarea"].includes(node.type);
  const controls=nodes.filter(isControl),control=controls.length===1?controls[0]:null;
  const controlId=control?.props.id||id;
  const content=control?nodes.map(node=>node===control?cloneElement(control,{id:controlId,"aria-describedby":[control.props["aria-describedby"],tip?tipId:undefined].filter(Boolean).join(" ")||undefined}):node):nodes;
  return <div className="form-group" role={control?undefined:"group"} aria-labelledby={control?undefined:labelId}>{control?<label id={labelId} htmlFor={controlId}>{label}{control.props.required&&<span className="field-required" aria-hidden="true"> *</span>}</label>:<span id={labelId} className="field-label">{label}</span>}{content}{tip&&<small id={tipId}>{tip}</small>}</div>;
}
export function Table({head,rows}:{head:string[],rows:ReactNode[][]}){
  return <div className="table-panel"><div className="table-wrap" tabIndex={0} role="region" aria-label="数据列表，可横向滚动"><table><thead><tr>{head.map((col,i)=><th scope="col" key={i}>{col}</th>)}</tr></thead><tbody>{rows.map((cells,i)=><tr key={i}>{cells.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>{rows.length===0&&<Empty/>}<div className="table-foot"><span>共 <strong>{rows.length}</strong> 条当前结果</span><span className="muted">横向滚动查看更多列</span></div></div>;
}
export function Feedback({message,error}:{message?:string,error?:string}){
  return <>{error&&<div className="form-alert error" role="alert">{error}</div>}{message&&<div className="form-alert success" role="status">{message}</div>}</>;
}
export function SubmitButton({busy,children}:{busy:boolean,children:ReactNode}){
  return <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>{busy?<><LoaderCircle size={14} className="spin"/>提交中</>:children}</button>;
}
export function DateCell({value}:{value:unknown}){return <span className="nowrap small">{formatDate(value)}</span>}
