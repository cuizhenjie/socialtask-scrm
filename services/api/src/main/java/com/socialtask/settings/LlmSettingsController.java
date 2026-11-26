package com.socialtask.settings;

import com.fasterxml.jackson.databind.*;
import com.socialtask.common.*;
import com.socialtask.task.TicketTemplate;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1/settings/llm")
public class LlmSettingsController {
    private final LlmProfileService profiles;private final Db db;private final Audit audit;private final ObjectMapper json;private final LlmReviewTransport transport;
    public LlmSettingsController(LlmProfileService profiles,Db db,Audit audit,ObjectMapper json,LlmReviewTransport transport){this.profiles=profiles;this.db=db;this.audit=audit;this.json=json;this.transport=transport;}
    @GetMapping public Map<String,Object> view(){return profiles.view();}
    @PutMapping public Map<String,Object> save(@RequestBody LlmProfileService.Input input){return profiles.save(input);}
    public record ReviewInput(String templateKey,Integer version,Boolean approveSanitized){}
    @PostMapping("/review") public Map<String,Object> review(@RequestBody ReviewInput input){
        LlmProfileService.admin();Db.badIf(input==null||!Boolean.TRUE.equals(input.approveSanitized()),"须明确确认仅向指定模型发送脱敏字段结构");
        Db.badIf(input.templateKey()==null||!input.templateKey().matches("[a-z][a-z0-9_]{0,39}")||input.version()==null||input.version()<1,"须指定已发布模板版本");
        var active=profiles.active();
        var saved=db.one("SELECT schema_json FROM ticket_templates WHERE template_key=? AND version=?",input.templateKey(),input.version());
        var template=json.convertValue(db.object(saved.get("schema_json")),TicketTemplate.class);
        List<Map<String,Object>> fields=new ArrayList<>();int position=0;
        for(var field:template.fields())fields.add(Map.of("position",++position,"phase",field.phase().name(),"kind",field.kind().name(),"required",field.required()));
        var request=Map.of("model",active.model(),"stream",false,"max_tokens",600,"messages",List.of(
            Map.of("role","system","content","Review only the provided anonymous ticket field sequence, phase, type and required flag. Suggest ordering/requiredness improvements, do not invent business facts or request identity, content or secrets. Return concise text in Chinese."),
            Map.of("role","user","content",db.json(Map.of("fields",fields)))));
        try{
            // User's provider receives only anonymous structural metadata. The template key/version never leaves this service.
            JsonNode response=json.readTree(transport.post(active.endpoint(),active.key(),json.writeValueAsString(request)));
            JsonNode content=response.path("choices").path(0).path("message").path("content");
            if(!content.isTextual()||content.asText().isBlank())throw new IllegalArgumentException();
            String output=content.asText().replace(active.key(),"[REDACTED]").replaceAll("[\\p{Cc}&&[^\\n\\t]]","");if(output.length()>4000)output=output.substring(0,4000);
            audit.record(Access.who().id(),"llm_profile",1,"SANITIZED_TEMPLATE_REVIEW",Map.of("fields",fields.size(),"outcome","SUCCESS"));
            return Map.of("review",output,"fields_sent",fields.size(),"applied",false);
        }catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();throw new ApiException(502,"模型评审暂不可用；未自动重试，也未修改模板");}
    }
}
