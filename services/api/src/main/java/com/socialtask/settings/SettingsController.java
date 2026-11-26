package com.socialtask.settings;

import com.socialtask.auth.WecomOAuthPolicy;
import com.socialtask.common.Access;
import com.socialtask.common.ApiException;
import com.socialtask.wecom.WecomCrypto;
import org.springframework.core.env.Environment;
import org.springframework.web.bind.annotation.*;
import java.util.*;

/** Local configuration inspection only. Never returns credentials or contacts providers. */
@RestController
@RequestMapping("/api/v1/settings")
public class SettingsController {
    private final Environment env;
    public SettingsController(Environment env){this.env=env;}
    private String value(String key){return env.getProperty(key,"");}
    private boolean present(String key){return !value(key).isBlank();}
    private boolean enabled(String key){return Boolean.TRUE.equals(env.getProperty(key,Boolean.class,false));}
    private int integer(String key,int fallback){try{return Integer.parseInt(value(key));}catch(NumberFormatException e){return fallback;}}
    private static Map<String,Object> check(String id,String label,boolean enabled,boolean ready,String hint){
        return Map.of("id",id,"label",label,"enabled",enabled,"configured",ready,"state",!enabled?"DISABLED":ready?"CONFIGURED":"INCOMPLETE","hint",hint);
    }
    @GetMapping
    public Map<String,Object> settings(){
        if(!"admin".equals(Access.who().role()))throw new ApiException(403,"仅系统管理员可以查看全局配置");
        String corp=value("app.wecom.corp-id");
        int agent=integer("app.wecom.agent-id",0), retention=integer("app.wecom.retention-days",90);
        boolean core=!corp.isBlank()&&agent>0&&present("app.wecom.secret");
        boolean callback=false,https=false;
        try{new WecomCrypto(value("app.wecom.callback-token"),value("app.wecom.encoding-aes-key"),corp);callback=true;}catch(IllegalArgumentException ignored){}
        try{WecomOAuthPolicy.callback(value("app.public-url"));https=true;}catch(IllegalArgumentException ignored){}
        var checks=List.of(
            check("app_send","企业微信应用发送",enabled("app.wecom.enabled"),core,"WECOM_ENABLED / WECOM_CORP_ID / WECOM_AGENT_ID / WECOM_AGENT_SECRET"),
            check("app_callback","加密消息回调",enabled("app.wecom.callback-enabled"),callback&&https,"WECOM_CALLBACK_ENABLED / WECOM_CALLBACK_TOKEN / WECOM_ENCODING_AES_KEY / APP_PUBLIC_URL"),
            check("app_oauth","企业微信 OAuth",enabled("app.wecom.oauth-enabled"),core&&https,"WECOM_OAUTH_ENABLED / APP_PUBLIC_URL"),
            check("app_media","临时媒体能力",enabled("app.wecom.media-enabled"),core,"独立媒体开关 WECOM_MEDIA_ENABLED；仅在已授权环境启用")
        );
        Map<String,Object> result=new LinkedHashMap<>();
        result.put("configuration_source","SERVER_ENV");
        result.put("connection_tested",false);
        result.put("checks",checks);
        result.put("wecom",Map.of("corp_id_configured",!corp.isBlank(),"agent_id",agent,"secret_configured",present("app.wecom.secret"),
            "callback_token_configured",present("app.wecom.callback-token"),"encoding_aes_key_configured",present("app.wecom.encoding-aes-key"),
            "public_https",https,"retention_days",retention,"retention_valid",retention>=1&&retention<=3650));
        result.put("scheduler_enabled",enabled("app.scheduler.enabled"));
        result.put("followup_max_active_tasks",integer("app.followup.max-active-tasks",10));
        result.put("external_channels",List.of(
            Map.of("id","WECHAT_KF","label","微信客服","state","NOT_CONNECTED","hint","独立客服 Secret、客服账号授权及 sync_msg 接入；不使用自建应用 Secret"),
            Map.of("id","CHAT_ARCHIVE","label","会话内容存档","state","NOT_CONNECTED","hint","独立许可、员工告知、客户同意及官方存档 SDK；不是实时回复渠道")
        ));
        result.put("model",Map.of("source","DSH_HOST_ENV","protocol","OPENAI_CHAT_COMPLETIONS","state","EXTERNAL_CONFIGURATION",
            "variables",List.of("SOCIALTASK_LLM_ENABLED","SOCIALTASK_LLM_BASE_URL","SOCIALTASK_LLM_ENDPOINT","SOCIALTASK_LLM_MODEL","SOCIALTASK_LLM_API_KEY")));
        return result;
    }
}
