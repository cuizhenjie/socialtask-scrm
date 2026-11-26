"use client";

import {Field} from "@/components/Ui";
import type {RecordRow} from "@/lib/api";

export type TicketField = {key:string; label:string; phase:"DISPATCH"|"RESPONSE"; kind:"TEXT"|"HTTPS_URL"|"CHECKBOX"|"MATERIAL_PACKAGE"; required:boolean};
export type TicketTemplate = {key:string; version:number; title:string; fields:TicketField[]};
export type TicketSnapshot = {template:TicketTemplate; values:Record<string,unknown>};
type Values = Record<string,string|number|boolean>;
type Material = {title:string; body:string; hashtags:string; assetIds:number[]};

export function TicketFields({fields,values,onChange,packages=[]}:{fields:TicketField[];values:Values;onChange:(next:Values)=>void;packages?:RecordRow[]}){
 const read=(key:string)=>Object.hasOwn(values,key)?values[key]:"";
 function update(key:string,value:string|number|boolean){
  const next={...values};
  if(value==="")delete next[key];else next[key]=value;
  onChange(next);
 }
 return <>{fields.map(field=><Field key={field.key} label={field.label+(field.required?"（必填）":"")}>
  {field.kind==="MATERIAL_PACKAGE"?<select required={field.required} value={String(read(field.key))} onChange={e=>update(field.key,e.target.value?Number(e.target.value):"")}>
   <option value="">选择已审核素材包</option>{packages.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.title)}</option>)}
  </select>:field.kind==="CHECKBOX"?<select required={field.required} value={String(read(field.key))} onChange={e=>update(field.key,e.target.value===""?"":e.target.value==="true")}>
   <option value="">请选择</option><option value="true">是</option><option value="false">否</option>
  </select>:field.kind==="TEXT"?<textarea required={field.required} maxLength={3000} value={String(read(field.key))} onChange={e=>update(field.key,e.target.value)}/>
  :<input type="url" required={field.required} maxLength={2000} value={String(read(field.key))} onChange={e=>update(field.key,e.target.value)} placeholder="https://"/>}
 </Field>)}</>;
}

export function DispatchSnapshot({snapshot}:{snapshot:TicketSnapshot}){
 return <div className="detail-content"><h3>{snapshot.template.title} · v{snapshot.template.version}</h3>
 {snapshot.template.fields.filter(f=>f.phase==="DISPATCH"&&Object.hasOwn(snapshot.values,f.key)).map(field=>{
  const value=snapshot.values[field.key];
  if(field.kind==="MATERIAL_PACKAGE"&&value&&typeof value==="object"){
   const material=value as Material;
   return <div key={field.key}><p><b>{field.label}：{material.title}</b></p><p>{material.body}</p><small>{material.hashtags}</small>
    <div className="mobile-assets">{material.assetIds.map(id=><a className="btn btn-sm" key={id} href={`/api/proxy/attachments/${id}`} target="_blank" rel="noreferrer">下载素材 #{id}</a>)}</div></div>;
  }
  return <p key={field.key}><b>{field.label}：</b>{value===true?"是":value===false?"否":String(value??"")}</p>;
 })}
 </div>;
}
