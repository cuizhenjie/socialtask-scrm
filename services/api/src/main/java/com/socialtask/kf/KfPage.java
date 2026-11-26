package com.socialtask.kf;

import com.fasterxml.jackson.databind.JsonNode;
import com.socialtask.auth.AuthService;
import java.time.*;
import java.util.*;

/** Normalizes the provider page before any cursor advance. Never stores raw external identities or payloads. */
public record KfPage(String cursor,boolean hasMore,List<Message> messages) {
    public record Message(String key,String peer,int origin,String type,String content,Instant time,String recallTarget){}
    private static String field(JsonNode n,String name,int max,boolean required){
        var v=n.path(name);
        if(v.isMissingNode()||v.isNull()||v.isTextual()&&v.asText().isBlank()){
            if(required)throw new IllegalArgumentException("微信客服响应缺少必要字段");
            return "";
        }
        if(!v.isTextual()||v.asText().length()>max||v.asText().chars().anyMatch(Character::isISOControl))throw new IllegalArgumentException("微信客服字段格式无效");
        return v.asText();
    }
    public static KfPage parse(JsonNode root,String account,String accountKey,String previous){
        if(!root.path("errcode").isIntegralNumber()||root.path("errcode").asInt()!=0)throw new IllegalArgumentException("微信客服接口拒绝或响应无效");
        var more=root.path("has_more");
        if(!more.isIntegralNumber()||more.asInt()<0||more.asInt()>1)throw new IllegalArgumentException("微信客服分页标志无效");
        boolean hasMore=more.asInt()==1;
        String cursor=field(root,"next_cursor",1024,false);
        var list=root.path("msg_list");
        if(!list.isArray()||list.size()>100)throw new IllegalArgumentException("微信客服消息页无效");
        if(cursor.isBlank()){if(hasMore||!list.isEmpty())throw new IllegalArgumentException("微信客服游标无效");cursor=previous;}
        if(hasMore&&cursor.equals(previous))throw new IllegalArgumentException("微信客服游标没有前进");
        List<Message> messages=new ArrayList<>();
        for(var item:list){
            String id=field(item,"msgid",512,true);
            String type=field(item,"msgtype",32,true);
            if(!type.matches("[a-z0-9_]+"))throw new IllegalArgumentException("微信客服类型无效");
            boolean event="event".equals(type);
            JsonNode identity=event?item.path("event"):item;
            if(!account.equals(field(identity,"open_kfid",128,true)))throw new IllegalArgumentException("微信客服账号范围不匹配");
            String external=field(identity,"external_userid",128,!event);
            String peer=external.isBlank()?null:AuthService.sha256("KF_PEER:"+accountKey+":"+external);
            if(!item.path("send_time").isIntegralNumber())throw new IllegalArgumentException("微信客服时间无效");
            long ts=item.path("send_time").asLong();
            if(ts<=0||ts>4102444800L)throw new IllegalArgumentException("微信客服时间无效");
            int origin=item.path("origin").asInt(-1);
            if(event?origin!=4:!Set.of(3,5).contains(origin))throw new IllegalArgumentException("微信客服消息来源无效");
            String content,recall=null;
            if(event){
                String kind=field(identity,"event_type",64,true);
                if(!kind.matches("[a-z0-9_]+"))throw new IllegalArgumentException("微信客服事件无效");
                content="[客服事件] "+kind;
                if(Set.of("user_recall_msg","servicer_recall_msg").contains(kind)){
                    if(peer==null)throw new IllegalArgumentException("撤回事件缺少会话");
                    recall=AuthService.sha256("KF_MSG:"+accountKey+":"+field(identity,"recall_msgid",512,true));
                }
            }else if(type.equals("text")){
                JsonNode value=item.path("text").path("content");
                if(!value.isTextual())throw new IllegalArgumentException("文本内容无效");
                String text=value.asText().replace("\u0000","");
                content=text.codePointCount(0,text.length())>4000?text.substring(0,text.offsetByCodePoints(0,4000)):text;
            }else content="[客服 "+type+" 消息；本阶段仅保留类型元数据]";
            messages.add(new Message(AuthService.sha256("KF_MSG:"+accountKey+":"+id),peer,origin,type,content,Instant.ofEpochSecond(ts),recall));
        }
        return new KfPage(cursor,hasMore,List.copyOf(messages));
    }
}
