package com.socialtask.auth;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/** Pure validation rules, shared by the OAuth state and provider adapter. */
public final class WecomOAuthPolicy {
    private WecomOAuthPolicy() {}
    public static boolean nonce(String value) { return value!=null && value.matches("[0-9a-f]{64}"); }
    public static boolean code(String value) {
        return value!=null && !value.isBlank() && value.getBytes(StandardCharsets.UTF_8).length<=512
            && value.chars().noneMatch(c->Character.isWhitespace(c)||Character.isISOControl(c));
    }
    public static String cardPath(String value) {
        return value!=null && value.matches("/m/tasks/[1-9][0-9]{0,18}") ? value : null;
    }
    public static String callback(String publicUrl) {
        URI uri=URI.create(publicUrl);
        if(!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost()==null || uri.getRawUserInfo()!=null
            || uri.getRawQuery()!=null || uri.getRawFragment()!=null || !(uri.getRawPath().isEmpty()||uri.getRawPath().equals("/")))
            throw new IllegalArgumentException("OAuth requires a canonical HTTPS origin");
        return "https://"+uri.getRawAuthority()+"/api/auth/wecom/callback";
    }
    static String enc(String value){return URLEncoder.encode(value,StandardCharsets.UTF_8);}
    public static String authorizeUrl(String corpId,int agentId,String callback,String state) {
        return "https://open.weixin.qq.com/connect/oauth2/authorize?appid="+enc(corpId)
            +"&redirect_uri="+enc(callback)+"&response_type=code&scope=snsapi_base&agentid="+agentId
            +"&state="+enc(state)+"#wechat_redirect";
    }
}
