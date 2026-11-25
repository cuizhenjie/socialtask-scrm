"use client";
import {useParams} from "next/navigation";
import People from "@/components/sections/People";
import Content from "@/components/sections/Content";
import Batches from "@/components/sections/Batches";
import Tasks from "@/components/sections/Tasks";
import Works from "@/components/sections/Works";
import Comments from "@/components/sections/Comments";
import Customers from "@/components/sections/Customers";
import Messages from "@/components/sections/Messages";
import Audit from "@/components/sections/Audit";
import SlaPolicies from "@/components/sections/SlaPolicies";
import TicketReports from "@/components/sections/TicketReports";
export default function Section(){
 const {section}=useParams<{section:string}>();
 switch(section){case "people":return <People/>;case "content":return <Content/>;case "batches":return <Batches/>;case "tasks":return <Tasks/>;case "works":return <Works/>;case "comments":return <Comments/>;case "customers":return <Customers/>;case "messages":return <Messages/>;case "sla":return <SlaPolicies/>;case "reports":return <TicketReports/>;case "audit":return <Audit/>;default:return <div>不存在此管理模块</div>}
}
