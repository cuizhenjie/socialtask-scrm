package com.socialtask.wecom;

import com.socialtask.common.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1/wecom")
public class WecomInboxController {
    private final WecomInboxService service;
    @Value("${app.wecom.enabled:false}") private boolean sendEnabled;
    @Value("${app.wecom.callback-enabled:false}") private boolean callbackEnabled;
    @Value("${app.wecom.corp-id:}") private String corpId;
    @Value("${app.wecom.callback-token:}") private String callbackToken;
    @Value("${app.wecom.encoding-aes-key:}") private String aesKey;
    public WecomInboxController(WecomInboxService service){this.service=service;}
    private WecomCrypto crypto(){
        if(!callbackEnabled) throw new ApiException(503,"企业微信消息回调未启用");
        try{return new WecomCrypto(callbackToken,aesKey,corpId);}catch(IllegalArgumentException ex){throw new ApiException(503,"企业微信回调尚未完成配置");}
    }
    @GetMapping("/config") public Map<String,Object> config(){Access.admin();return Map.of("outbound_enabled",sendEnabled,"callback_configured",callbackEnabled&&!callbackToken.isBlank()&&!aesKey.isBlank()&&!corpId.isBlank(),"channel","WECOM_APP","external_customer_chats_supported",false);}
    @GetMapping("/inbox/conversations") public List<Map<String,Object>> threads(@RequestParam(required=false) String q){return service.threads(q);}
    @GetMapping("/inbox/conversations/{id}/messages") public List<Map<String,Object>> messages(@PathVariable long id){return service.messages(id);}
    @PostMapping("/inbox/conversations/{id}/read") public Map<String,Object> read(@PathVariable long id){return service.markRead(id);}
    public record Reply(String content){}
    @PostMapping("/inbox/conversations/{id}/reply") public Map<String,Object> reply(@PathVariable long id,@RequestBody Reply body){return service.reply(id,body.content());}
    // Official WeCom URL verification: signature is over token,timestamp,nonce,encryptedEcho.
    @GetMapping(value="/callback",produces=MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> verify(@RequestParam("msg_signature") String sig,@RequestParam String timestamp,@RequestParam String nonce,@RequestParam("echostr") String echo){
        try{return ResponseEntity.ok(crypto().verify(sig,timestamp,nonce,echo));}catch(SecurityException error){return ResponseEntity.status(403).body("invalid signature");}
    }
    @PostMapping(value="/callback",consumes={MediaType.APPLICATION_XML_VALUE,MediaType.TEXT_XML_VALUE,MediaType.ALL_VALUE},produces=MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> receive(@RequestParam("msg_signature") String sig,@RequestParam String timestamp,@RequestParam String nonce,@RequestBody String body){
        try{
            var payload=WecomCrypto.parseXml(body);
            String encrypted=payload.get("Encrypt");
            String decrypted=crypto().verify(sig,timestamp,nonce,encrypted);
            service.receive(WecomCrypto.parseXml(decrypted));
            return ResponseEntity.ok("success");
        }catch(SecurityException|IllegalArgumentException ex){return ResponseEntity.status(403).body("invalid callback");}
    }
}
