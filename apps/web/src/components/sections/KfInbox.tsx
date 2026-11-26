"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import Link from "next/link";
import {RefreshCcw,MessageCircle,ShieldCheck} from "lucide-react";
import {api,jsonPost,formatDate,type RecordRow} from "@/lib/api";
import {PageHeading,Empty,Modal,Feedback,SubmitButton,Table} from "@/components/Ui";
type State={enabled:boolean;authorized:boolean;configured:boolean;retention_days:number;has_more:boolean;last_attempt_at?:unknown;last_sync_at?:unknown;last_error?:string};
export default function KfInbox(){
 const [state,setState]=useState<State|null>(null),[rows,setRows]=useState<RecordRow[]>([]),[peer,setPeer]=useState(""),[messages,setMessages]=useState<RecordRow[]>([]);
 const [loading,setLoading]=useState(true),[messageBusy,setMessageBusy]=useState(false),[syncing,setSyncing]=useState(false),[confirm,setConfirm]=useState(false),[checked,setChecked]=useState(false),[error,setError]=useState(""),[info,setInfo]=useState("");
 const listSeq=useRef(0),messageSeq=useRef(0),syncLock=useRef(false);
 async function load(){const seq=++listSeq.current;setLoading(true);setError("");try{
    const next=await api<State>("kf/state");if(seq!==listSeq.current)return;setState(next);
    if(next.configured){const list=await api<RecordRow[]>("kf/conversations");if(seq===listSeq.current)setRows(list);}
    else{++messageSeq.current;setRows([]);setPeer("");setMessages([]);}
 }catch(e){if(seq===listSeq.current){setState(null);setRows([]);setMessages([]);setPeer("");setError((e as Error).message);}}finally{if(seq===listSeq.current)setLoading(false);}}
 async function open(id:string){const seq=++messageSeq.current;setPeer(id);setMessages([]);setMessageBusy(true);setError("");try{
    const list=await api<RecordRow[]>("kf/conversations/"+id+"/messages");if(seq===messageSeq.current)setMessages(list.slice().reverse());
 }catch(e){if(seq===messageSeq.current)setError((e as Error).message);}finally{if(seq===messageSeq.current)setMessageBusy(false);}}
 useEffect(()=>{void load();return()=>{listSeq.current++;messageSeq.current++;}},[]);
 async function sync(e:FormEvent){e.preventDefault();if(!checked||!state?.configured||syncLock.current)return;syncLock.current=true;setSyncing(true);setError("");setInfo("");
    try{const result=await jsonPost<RecordRow>("kf/sync",{confirm:true});setConfirm(false);await load();if(peer)await open(peer);setInfo("已处理 "+String(result.processed)+" 条本次返回记录；"+(result.has_more?"仍有下一页，请至少间隔 60 秒后继续。":"当前页拉取完成。"));}
    catch(e){setError((e as Error).message);setConfirm(false);}finally{syncLock.current=false;setSyncing(false);setChecked(false);}}
 return <><PageHeading eyebrow="WECHAT KF / AUTHORIZED SERVICE" title="微信客服会话" description="独立授权客服账号的只读增量同步，和企微自建应用消息分离。" actions={<div className="inline-actions" style={{margin:0}}><button type="button" className="btn" disabled={loading||syncing} onClick={()=>{void load();if(peer)void open(peer);}}><RefreshCcw size={15}/>刷新记录</button><button type="button" className="btn btn-primary" disabled={!state?.configured||syncing||loading} onClick={()=>{setChecked(false);setConfirm(true);}}>同步一页</button></div>}/>
 <div className="info-note"><ShieldCheck size={16}/> 仅系统管理员可访问。客户标识已分离；不自动回复、建客户档案、合并身份、拉取媒体或读取普通企微私聊。同步使用独立客服 Secret，需企业明确授权；<Link href="/admin/settings" className="link-blue">查看配置</Link>。</div>
 <Feedback error={error} message={info}/>{state&&<div className="channel-strip mt12"><div className="channel-summary"><MessageCircle size={18}/><div><b>{state.configured?"本地配置齐备":"未启用或授权配置不完整"}</b><small>保留 {state.retention_days} 天 · 最近同步：{formatDate(state.last_sync_at)} · {state.has_more?"仍有后续页":"无已知后续页"}</small></div></div></div>}
 {loading?<p role="status" className="muted">正在读取本地状态…</p>:state?.configured?<div className="data-grid kf-grid"><section className="panel"><div className="panel-head"><div className="panel-title">授权会话（{rows.length}）</div></div><div className="panel-body">{rows.length===0?<Empty message="暂无已同步会话"/>:rows.map(row=><button type="button" key={String(row.peer_key)} className={"inbox-item "+(peer===row.peer_key?"active":"")} aria-pressed={peer===row.peer_key} onClick={()=>open(String(row.peer_key))}><span className="inbox-avatar"><MessageCircle size={16}/></span><span className="inbox-meta"><strong>客户 #{String(row.peer_key).slice(0,10)}</strong><small>{String(row.message_count)} 条记录 · {formatDate(row.last_message_at)}</small></span></button>)}</div></section><section className="panel"><div className="panel-head"><div className="panel-title">会话记录</div></div><div className="panel-body">{!peer?<Empty message="选择一个已同步会话"/>:messageBusy?<p role="status">正在读取…</p>:<Table head={["来源","类型","内容","时间"]} rows={messages.map(m=>[Number(m.origin)===3?"微信客户":Number(m.origin)===5?"接待人员":"系统事件",String(m.message_type),<span className="wrap-cell" key="content">{m.recalled?"（已撤回）":String(m.content||"（无正文）")}</span>,formatDate(m.message_at)])}/>}</div></section></div>:<Empty message="等待独立客服账号配置及企业授权，不读取外部数据"/>}
 {confirm&&<Modal title="确认同步授权客服消息" onClose={()=>{if(!syncLock.current)setConfirm(false);}}><form onSubmit={sync}><p>本次仅从配置的客服账号读取一页（最多 100 条）消息。首次同步可能读取平台允许的最近 3 天记录；数据按保留期清理。</p><label className="check-line"><input required type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>已核实客服账号授权与业务数据处理依据，同意本次同步。</label><div className="form-actions"><button type="button" className="btn" disabled={syncing} onClick={()=>setConfirm(false)}>取消</button><SubmitButton busy={syncing}>确认同步</SubmitButton></div></form></Modal>}</>;
}
