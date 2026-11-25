"use client";
import {RefreshCcw} from "lucide-react";
import {useRows} from "@/lib/hooks";
import {PageHeading,Table,DateCell} from "@/components/Ui";
export default function Audit(){
 const{rows,error,loading,reload}=useRows("audit-logs");
 return <><PageHeading eyebrow="SECURITY & TRACEABILITY" title="系统审计日志" description="关键业务操作独立留痕，包括下发、审核、转派、联系许可和停止联系。" actions={<button className="btn" onClick={reload}><RefreshCcw size={15}/> 刷新</button>}/>
 {error&&<div className="form-alert error">{error}</div>}{loading?<p className="muted">正在载入…</p>:<Table head={["编号","对象类型","业务 ID","操作","操作用户","记录时间"]} rows={rows.map(a=>[
 String(a.id),String(a.entity),String(a.entity_id),String(a.action),String(a.actor_user_id||"系统任务"),<DateCell value={a.created_at} key="date"/>
 ])}/>}
 </>;
}
