package com.socialtask.kf;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.socialtask.common.ApiException;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class KfSyncClientTest {
    private static final ObjectMapper JSON=new ObjectMapper();
    private static final String ACCOUNT="wk-unit";
    @Test void disabledAndSharedSecretNeverContactProvider(){
        KfSyncClient.Transport denied=(uri,body)->{throw new AssertionError("provider must not be called");};
        for(var client:List.of(
            new KfSyncClient(false,true,"corp",ACCOUNT,"kf-secret","app-secret",30,JSON,denied),
            new KfSyncClient(true,false,"corp",ACCOUNT,"kf-secret","app-secret",30,JSON,denied),
            new KfSyncClient(true,true,"corp",ACCOUNT,"same","same",30,JSON,denied))){
            assertFalse(client.configured());assertEquals(409,assertThrows(ApiException.class,()->client.fetch("")).status);
        }
    }
    @Test void scopedPageUsesDedicatedTokenCursorAndPseudonymousIds()throws Exception{
        List<String> paths=new ArrayList<>();
        KfSyncClient.Transport transport=(uri,body)->{
            assertEquals("qyapi.weixin.qq.com",uri.getHost());paths.add(uri.getPath());
            if(body==null){assertTrue(uri.getQuery().contains("corpsecret=kf-secret"));return "{\"errcode\":0,\"access_token\":\"unit-token\",\"expires_in\":7200}";}
            var input=JSON.readTree(body);assertEquals(ACCOUNT,input.path("open_kfid").asText());assertEquals("prev",input.path("cursor").asText());assertEquals(100,input.path("limit").asInt());
            return """
                {"errcode":0,"has_more":1,"next_cursor":"next","msg_list":[
                  {"msgid":"private-msg","open_kfid":"wk-unit","external_userid":"private-external","send_time":1795750000,"origin":3,"msgtype":"text","text":{"content":"合成内容"}},
                  {"msgid":"private-event","send_time":1795750001,"origin":4,"msgtype":"event","event":{"event_type":"user_recall_msg","open_kfid":"wk-unit","external_userid":"private-external","recall_msgid":"private-msg"}}
                ]}
                """;
        };
        var client=new KfSyncClient(true,true,"corp",ACCOUNT,"kf-secret","app-secret",30,JSON,transport);
        var page=client.fetch("prev");
        assertEquals(List.of("/cgi-bin/gettoken","/cgi-bin/kf/sync_msg"),paths);assertTrue(page.hasMore());assertEquals("next",page.cursor());
        assertEquals(2,page.messages().size());assertEquals(page.messages().getFirst().key(),page.messages().getLast().recallTarget());
        assertFalse(page.toString().contains("private-external"));assertFalse(page.toString().contains("private-msg"));
    }
    @Test void invalidPageDoesNotBecomeAValidCursor()throws Exception{
        String wrong="{\"errcode\":0,\"has_more\":1,\"next_cursor\":\"next\",\"msg_list\":[{\"msgid\":\"m\",\"open_kfid\":\"wk-other\",\"external_userid\":\"e\",\"send_time\":1795750000,\"origin\":3,\"msgtype\":\"text\",\"text\":{\"content\":\"x\"}}]}";
        assertThrows(IllegalArgumentException.class,()->KfPage.parse(JSON.readTree(wrong),ACCOUNT,"scope","prev"));
        assertThrows(IllegalArgumentException.class,()->KfPage.parse(JSON.readTree("{\"errcode\":0,\"has_more\":1,\"next_cursor\":\"prev\",\"msg_list\":[]}"),ACCOUNT,"scope","prev"));
    }
}
