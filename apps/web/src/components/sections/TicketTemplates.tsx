"use client";
import {useEffect,useState,type FormEvent} from "react";
import {api,jsonPost} from "@/lib/api";
import {useAction} from "@/lib/hooks";
import {Feedback,Field,PageHeading,SubmitButton} from "@/components/Ui";
import type {TicketField,TicketTemplate} from "@/components/TicketFields";

const empty=():TicketField=>({key:"",label:"",phase:"DISPATCH",kind:"TEXT",required:true});
const fresh=()=>({key:"",version:0,title:"",fields:[empty()]});
export default function TicketTemplates(){
 const [templates,setTemplates]=useState<TicketTemplate[]>([]),[draft,setDraft]=useState<TicketTemplate>(fresh),[loadError,setLoadError]=useState("");
 const action=useAction();
 useEffect(()=>{api<TicketTemplate[]>("ticket-templates").then(setTemplates).catch(e=>setLoadError(e.message));},[]);
 function change(index:number,patch:Partial<TicketField>){
  setDraft(x=>({...x,fields:x.fields.map((f,i)=>i===index?{...f,...patch}:f)}));
 }
 function reorder(index:number,step:number){
  setDraft(x=>{
   const fields=[...x.fields], target=index+step;
   if(target<0||target>=fields.length)return x;
   [fields[index],fields[target]]=[fields[target],fields[index]];
   return {...x,fields};
  });
 }
 async function publish(e:FormEvent){
  e.preventDefault();
  const out=await action.run(()=>jsonPost<TicketTemplate>("ticket-templates",{key:draft.key,title:draft.title,expectedVersion:draft.version,fields:draft.fields}),"模板版本已发布");
  if(out){setTemplates(list=>[...list.filter(t=>t.key!==out.key),out].sort((a,b)=>a.key.localeCompare(b.key)));setDraft(out);}
 }
 return <><PageHeading eyebrow="TICKETS / TEMPLATES" title="工单模板" description="配置下发说明、已审核素材包与执行人回传字段。发布新版本不会改变旧工单。"/>
 <Feedback error={loadError}/><div className="inline-actions"><button type="button" className="btn" onClick={()=>{action.reset();setDraft(fresh());}}>新建模板</button>
 {templates.map(t=><button type="button" className="btn" key={t.key} onClick={()=>{action.reset();setDraft(t);}}>{t.title} · v{t.version}</button>)}</div>
 <form onSubmit={publish}>
 <div className="form-grid"><Field label="模板标识"><input required pattern="[a-z][a-z0-9_]{0,39}" maxLength={40} readOnly={draft.version>0} value={draft.key} onChange={e=>setDraft(x=>({...x,key:e.target.value}))}/></Field>
 <Field label="模板名称"><input required maxLength={100} value={draft.title} onChange={e=>setDraft(x=>({...x,title:e.target.value}))}/></Field></div>
 {draft.fields.map((f,i)=><div className="record-card" key={i}>
 <div className="form-grid">
 <Field label="字段标识"><input required pattern="[a-z][a-z0-9_]{0,39}" maxLength={40} value={f.key} onChange={e=>change(i,{key:e.target.value})}/></Field>
 <Field label="字段名称"><input required maxLength={100} value={f.label} onChange={e=>change(i,{label:e.target.value})}/></Field>
 <Field label="使用阶段"><select value={f.phase} onChange={e=>{const phase=e.target.value as TicketField["phase"];change(i,{phase,kind:phase==="RESPONSE"&&f.kind==="MATERIAL_PACKAGE"?"TEXT":f.kind});}}><option value="DISPATCH">下发</option><option value="RESPONSE">回传</option></select></Field>
 <Field label="字段类型"><select value={f.kind} onChange={e=>change(i,{kind:e.target.value as TicketField["kind"]})}><option value="TEXT">文字</option><option value="HTTPS_URL">HTTPS 链接</option><option value="CHECKBOX">是/否</option>{f.phase==="DISPATCH"&&<option value="MATERIAL_PACKAGE">已审核素材包</option>}</select></Field>
 </div>
 <label className="check-line"><input type="checkbox" checked={f.required} onChange={e=>change(i,{required:e.target.checked})}/> 必填</label>
 <div className="inline-actions"><button type="button" className="btn btn-sm" disabled={i===0} onClick={()=>reorder(i,-1)}>上移</button><button type="button" className="btn btn-sm" disabled={i===draft.fields.length-1} onClick={()=>reorder(i,1)}>下移</button><button type="button" className="btn btn-sm" disabled={draft.fields.length===1} onClick={()=>setDraft(x=>({...x,fields:x.fields.filter((_,j)=>j!==i)}))}>移除</button></div>
 </div>)}
 <div className="inline-actions"><button type="button" className="btn" disabled={draft.fields.length>=30} onClick={()=>setDraft(x=>({...x,fields:[...x.fields,empty()]}))}>添加字段</button><SubmitButton busy={action.busy}>发布 v{draft.version+1}</SubmitButton></div>
 <Feedback error={action.error} message={action.message}/>
 </form></>;
}
