package com.socialtask.people;

import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1/people")
public class PeopleController {
    private final PeopleService service;
    public PeopleController(PeopleService service){this.service=service;}
    public record PersonIn(String personNo,String name,String personType,String groupName,String wecomUserId,String identityType){}
    public record BulkImportIn(List<PersonIn> rows){}
    public record PersonEdit(String name,String status,String groupName,String wecomUserId){}
    public record AccountIn(String nickname,String externalUid,String profileUrl,String platform){}
    public record Credentials(String username,String password){}
    @GetMapping public List<Map<String,Object>> list(@RequestParam(required=false) String q,@RequestParam(required=false) String role,@RequestParam(required=false) String group,@RequestParam(required=false) String status,@RequestParam(required=false) Long tagId){return service.list(q,role,group,status,tagId);}
    public record GroupInput(String name,String description){}
    public record TagInput(String name){}
    public record TagSelection(List<Long> tagIds){}
    @GetMapping("/groups") public List<Map<String,Object>> groups(){return service.groups();}
    @PostMapping("/groups") public Map<String,Object> group(@RequestBody GroupInput body){return service.addGroup(body.name(),body.description());}
    @GetMapping("/tags") public List<Map<String,Object>> tags(){return service.tags();}
    @PostMapping("/tags") public Map<String,Object> tag(@RequestBody TagInput body){return service.addTag(body.name());}
    @PutMapping("/{id}/tags") public Map<String,Object> setTags(@PathVariable long id,@RequestBody TagSelection body){return service.setTags(id,body.tagIds());}
    @GetMapping("/assignees") public List<Map<String,Object>> assignees(){return service.assignees();}
    @PostMapping public Map<String,Object> create(@RequestBody PersonIn body){return service.create(body);}
    @PostMapping("/import") public Map<String,Object> bulkImport(@RequestBody BulkImportIn body){return service.bulkImport(body==null?null:body.rows());}
    @PatchMapping("/{id}") public Map<String,Object> update(@PathVariable long id,@RequestBody PersonEdit body){return service.update(id,body);}
    @GetMapping("/{id}/accounts") public List<Map<String,Object>> accounts(@PathVariable long id){return service.accounts(id);}
    @PostMapping("/{id}/accounts") public Map<String,Object> account(@PathVariable long id,@RequestBody AccountIn body){return service.account(id,body);}
    @PostMapping("/{id}/credentials") public Map<String,Object> credentials(@PathVariable long id,@RequestBody Credentials body){return service.credentials(id,body);}
}
