"use client";
import {useEffect,useState,type FormEvent} from "react";
import {Plus,KeyRound,Link2,Search,RefreshCcw,Tags,UsersRound} from "lucide-react";
import {api,jsonPost,jsonPatch,type RecordRow,display,typeMap} from "@/lib/api";
import {useRows,useAction} from "@/lib/hooks";
import {PageHeading,Modal,Field,Feedback,SubmitButton,Status,Table,DateCell} from "@/components/Ui";
type Mode="create"|"account"|"credentials"|"edit"|"tags"|"groupNew"|"tagNew"|null;
export default function People(){
 const [q,setQ]=useState("");const [group,setGroup]=useState("");const [role,setRole]=useState("");const [tag,setTag]=useState("");
 const qs=new URLSearchParams();if(q)qs.set("q",q);if(group)qs.set("group",group);if(role)qs.set("role",role);if(tag)qs.set("tagId",tag);
 const {rows,loading,error,reload}=useRows("people"+(qs.size?"?"+qs.toString():""));const action=useAction();
 const [groups,setGroups]=useState<RecordRow[]>([]),[tags,setTags]=useState<RecordRow[]>([]);
 const[mode,setMode]=useState<Mode>(null),[selected,setSelected]=useState<RecordRow|null>(null),[tagSelection,setTagSelection]=useState<number[]>([]);
 const[form,setForm]=useState({personNo:"",name:"",personType:"creator",groupName:"第一组",wecomUserId:"",identityType:"合作账号",nickname:"",profileUrl:"",externalUid:"",username:"",password:"",status:"ACTIVE",description:""});
 const loadLookups=()=>{api<RecordRow[]>("people/groups").then(setGroups).catch(()=>{});api<RecordRow[]>("people/tags").then(setTags).catch(()=>{});};
 useEffect(()=>{loadLookups();},[]);
 function set<K extends keyof typeof form>(key:K,value:(typeof form)[K]){setForm(v=>({...v,[key]:value}));}
 function open(which:Mode,row?:RecordRow){action.reset();setSelected(row||null);setTagSelection(String(row?.tag_ids||"").split(",").filter(Boolean).map(Number));
  setForm(v=>({...v,personNo:"",name:which==="edit"?String(row?.name||""):"",personType:"creator",groupName:String(row?.group_name||"第一组"),wecomUserId:String(row?.wecom_userid||""),identityType:"合作账号",nickname:"",profileUrl:"",externalUid:"",username:"",password:"",status:String(row?.status||"ACTIVE"),description:""}));setMode(which);
 }
 async function submit(e:FormEvent){e.preventDefault();const result=await action.run(async()=>{
  if(mode==="create")return jsonPost("people",{personNo:form.personNo,name:form.name,personType:form.personType,groupName:form.groupName,wecomUserId:form.wecomUserId||null,identityType:form.identityType});
  if(mode==="groupNew")return jsonPost("people/groups",{name:form.groupName,description:form.description});
  if(mode==="tagNew")return jsonPost("people/tags",{name:form.name});
  if(!selected)throw new Error("未选择人员");const id=selected.id;
  if(mode==="tags")return api(`people/${id}/tags`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({tagIds:tagSelection})});
  if(mode==="account")return jsonPost(`people/${id}/accounts`,{nickname:form.nickname,profileUrl:form.profileUrl,externalUid:form.externalUid||null,platform:"douyin"});
  if(mode==="credentials")return jsonPost(`people/${id}/credentials`,{username:form.username,password:form.password});
  return jsonPatch(`people/${id}`,{name:form.name,groupName:form.groupName,wecomUserId:form.wecomUserId,status:form.status});
 },"保存成功");if(result){setMode(null);reload();loadLookups();}}
 return <><PageHeading eyebrow="MEMBERS / GROUPS / TAGS" title="人员、分组与标签" description="按人员角色、业务组和标签筛选，关联企业微信账号；一人多账号保留历史关联。" actions={<div className="inline-actions" style={{margin:0}}><button className="btn" onClick={()=>open("groupNew")}><UsersRound size={14}/> 新建分组</button><button className="btn" onClick={()=>open("tagNew")}><Tags size={14}/> 新建标签</button><button className="btn btn-primary" onClick={()=>open("create")}><Plus size={15}/> 新增人员</button></div>}/>
  <div className="table-toolbar"><div className="filters"><div className="search-inline"><Search size={15}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="搜索编号、姓名、企微 UserID"/></div>
   <select className="filter-select" value={group} onChange={e=>setGroup(e.target.value)}><option value="">全部分组</option>{groups.map(g=><option key={String(g.id)} value={String(g.name)}>{String(g.name)} ({String(g.person_count||0)})</option>)}</select>
   <select className="filter-select" value={role} onChange={e=>setRole(e.target.value)}><option value="">全部角色</option>{["creator","author","assistant","support"].map(k=><option key={k} value={k}>{display(k,typeMap)}</option>)}</select>
   <select className="filter-select" value={tag} onChange={e=>setTag(e.target.value)}><option value="">全部标签</option>{tags.map(t=><option key={String(t.id)} value={String(t.id)}>{String(t.name)}</option>)}</select>
  </div><button className="btn" onClick={reload}><RefreshCcw size={15}/> 刷新</button></div>
  <Feedback error={error}/>{loading?<p className="muted">加载中…</p>:<Table head={["人员编号","姓名","身份/分组","标签","企业微信","状态","操作"]} rows={rows.map(p=>[
   <span className="code" key="id">{String(p.person_no)}</span>,<b key="name">{String(p.name)}</b>,<div key="role">{display(p.person_type,typeMap)}<div className="muted small">{String(p.group_name)}</div></div>,
   <div key="tags" className="tag-list">{String(p.tag_names||"").split(",").filter(Boolean).map(x=><span className="tiny-tag" key={x}>{x}</span>)}</div>,
   <span key="user" className="small">{String(p.wecom_userid||"未绑定")}</span>,<Status key="state" value={p.status}/>,
   <div key="actions" className="row-actions"><button className="btn-link" onClick={()=>open("tags",p)}><Tags size={13}/> 标签</button><button className="btn-link" onClick={()=>open("account",p)}><Link2 size={13}/> 账号</button><button className="btn-link" onClick={()=>open("credentials",p)}><KeyRound size={13}/> 登录</button><button className="btn-link" onClick={()=>open("edit",p)}>编辑</button></div>
  ])}/>}
  {mode&&<Modal title={({create:"新增人员",account:"绑定抖音账号",credentials:"创建执行端登录",edit:"编辑人员",tags:"分配人员标签",groupNew:"新建业务分组",tagNew:"新建人员标签"} as Record<NonNullable<Mode>,string>)[mode]} onClose={()=>setMode(null)}><form onSubmit={submit}>
   {mode==="groupNew"&&<><Field label="分组名称"><input required maxLength={100} value={form.groupName} onChange={e=>set("groupName",e.target.value)} placeholder="例如 第四组"/></Field><Field label="说明"><textarea value={form.description} onChange={e=>set("description",e.target.value)}/></Field></>}
   {mode==="tagNew"&&<Field label="标签名称"><input required maxLength={60} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="例如 高优先级合作方"/></Field>}
   {mode==="tags"&&<><div className="info-note">为 {String(selected?.name||"该人员")} 选择标签，可多选，用于派单筛选与统计。</div><div className="tag-choices">{tags.length===0?<p className="muted">暂无标签，请先创建。</p>:tags.map(t=><label className="check-line" key={String(t.id)}><input type="checkbox" checked={tagSelection.includes(Number(t.id))} onChange={e=>setTagSelection(prev=>e.target.checked?[...prev,Number(t.id)]:prev.filter(x=>x!==Number(t.id)))}/>{String(t.name)}</label>)}</div></>}
   {mode==="create"&&<><div className="form-grid"><Field label="内部编号"><input required value={form.personNo} onChange={e=>set("personNo",e.target.value)} placeholder="S001 / A001"/></Field><Field label="姓名/昵称"><input required value={form.name} onChange={e=>set("name",e.target.value)}/></Field><Field label="人员角色"><select value={form.personType} onChange={e=>set("personType",e.target.value)}>{["author","creator","assistant","support"].map(x=><option key={x} value={x}>{display(x,typeMap)}</option>)}</select></Field><Field label="所属分组"><select value={form.groupName} onChange={e=>set("groupName",e.target.value)}>{groups.map(g=><option key={String(g.id)}>{String(g.name)}</option>)}</select></Field></div><Field label="企业微信 UserID（可选）"><input value={form.wecomUserId} onChange={e=>set("wecomUserId",e.target.value)}/></Field></>}
   {mode==="edit"&&<><Field label="姓名"><input required value={form.name} onChange={e=>set("name",e.target.value)}/></Field><div className="form-grid"><Field label="分组"><select value={form.groupName} onChange={e=>set("groupName",e.target.value)}>{groups.map(g=><option key={String(g.id)} value={String(g.name)}>{String(g.name)}</option>)}</select></Field><Field label="人员状态"><select value={form.status} onChange={e=>set("status",e.target.value)}><option value="ACTIVE">正常</option><option value="INACTIVE">停用（同时撤销登录）</option></select></Field></div><Field label="企业微信 UserID"><input value={form.wecomUserId} onChange={e=>set("wecomUserId",e.target.value)}/></Field></>}
   {mode==="account"&&<><Field label="抖音昵称"><input required value={form.nickname} onChange={e=>set("nickname",e.target.value)}/></Field><Field label="抖音 UID"><input value={form.externalUid} onChange={e=>set("externalUid",e.target.value)}/></Field><Field label="抖音主页 HTTPS 链接"><input required type="url" value={form.profileUrl} onChange={e=>set("profileUrl",e.target.value)}/></Field></>}
   {mode==="credentials"&&<><div className="info-note">执行登录账号绑定 {String(selected?.name)} 的权限，不通过企业微信发送密码。</div><Field label="用户名"><input required value={form.username} onChange={e=>set("username",e.target.value)}/></Field><Field label="初始密码（至少12位）"><input type="password" minLength={12} required value={form.password} onChange={e=>set("password",e.target.value)}/></Field></>}
   <Feedback error={action.error} message={action.message}/><div className="form-actions"><button type="button" className="btn" onClick={()=>setMode(null)}>取消</button><SubmitButton busy={action.busy}>保存</SubmitButton></div>
  </form></Modal>}
 </>;
}
