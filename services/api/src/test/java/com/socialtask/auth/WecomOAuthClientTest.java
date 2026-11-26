package com.socialtask.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.socialtask.common.ApiException;
import org.junit.jupiter.api.Test;
import java.net.URI;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Tests the actual adapter against synthetic transport replies, not live WeCom. */
class WecomOAuthClientTest {
    private WecomOAuthClient client(boolean enabled,WecomOAuthClient.Transport transport){
        return new WecomOAuthClient(enabled,"ww-test-only",1000001,"synthetic-secret","https://scrm.example.invalid",new ObjectMapper(),transport);
    }
    @Test void exactProviderEndpointsEncodingAndTokenCache(){
        var requests=new ArrayList<URI>();var c=client(true,uri->{requests.add(uri);return uri.getPath().endsWith("gettoken")?"{\"errcode\":0,\"access_token\":\"test+token\",\"expires_in\":7200}":"{\"errcode\":0,\"userid\":\"Member_1\"}";});
        var url=URI.create(c.authorization("a".repeat(64)));assertEquals("open.weixin.qq.com",url.getHost());assertEquals("wechat_redirect",url.getFragment());assertTrue(url.getRawQuery().contains("scope=snsapi_base"));assertTrue(url.getRawQuery().contains("agentid=1000001"));
        assertEquals("Member_1",c.userId("code+&1"));assertEquals("Member_1",c.userId("second-code"));assertEquals(3,requests.size());
        assertEquals("/cgi-bin/gettoken",requests.get(0).getPath());assertEquals("/cgi-bin/auth/getuserinfo",requests.get(1).getPath());assertEquals("qyapi.weixin.qq.com",requests.get(1).getHost());assertTrue(requests.get(1).getRawQuery().contains("access_token=test%2Btoken&code=code%2B%261"));
    }
    @Test void externalIdentityProviderErrorAndLegacyFieldsFailClosed(){
        for(String result:List.of("{\"errcode\":0,\"openid\":\"external\"}","{\"errcode\":0,\"UserId\":\"legacy\"}","{\"errcode\":40029,\"userid\":\"forged\"}")){
            var c=client(true,uri->uri.getPath().endsWith("gettoken")?"{\"errcode\":0,\"access_token\":\"test-token\",\"expires_in\":7200}":result);
            assertTrue(Set.of(401,403).contains(assertThrows(ApiException.class,()->c.userId("code")).status));
        }
        var disabled=client(false,uri->{fail("disabled OAuth must never contact provider");return "";});assertEquals(404,assertThrows(ApiException.class,()->disabled.userId("code")).status);
        var badToken=client(true,uri->"{\"errcode\":0,\"access_token\":\"\"}");assertEquals(502,assertThrows(ApiException.class,()->badToken.userId("code")).status);
    }
    @Test void expiredTokenIsDiscardedWithoutRetryingConsumedCode(){
        var requests=new ArrayList<URI>();var c=client(true,uri->{requests.add(uri);return uri.getPath().endsWith("gettoken")?"{\"errcode\":0,\"access_token\":\"test-token\",\"expires_in\":7200}":"{\"errcode\":42001}";});
        assertEquals(401,assertThrows(ApiException.class,()->c.userId("first")).status);assertEquals(2,requests.size());
        assertEquals(401,assertThrows(ApiException.class,()->c.userId("second")).status);assertEquals(4,requests.size());
    }
}
