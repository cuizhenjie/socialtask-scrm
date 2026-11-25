package com.socialtask.customer;

import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1/customers")
public class CustomerController {
    private final CustomerService service;
    public CustomerController(CustomerService service){this.service=service;}
    public record SegmentInput(String name,String description){}
    public record CustomerTagInput(String name){}
    public record Classification(Long segmentId,List<Long> tagIds){}
    @GetMapping public List<Map<String,Object>> list(@RequestParam(required=false) String q,
             @RequestParam(required=false) String status,
             @RequestParam(required=false) Long segmentId,
             @RequestParam(required=false) Long tagId){return service.list(q,status,segmentId,tagId);}
    @GetMapping("/segments") public List<Map<String,Object>> segments(){return service.segments();}
    @PostMapping("/segments") public Map<String,Object> addSegment(@RequestBody SegmentInput body){return service.addSegment(body.name(),body.description());}
    @GetMapping("/tags") public List<Map<String,Object>> tags(){return service.tags();}
    @PostMapping("/tags") public Map<String,Object> addTag(@RequestBody CustomerTagInput body){return service.addTag(body.name());}
    @PutMapping("/{id}/classification") public Map<String,Object> classify(@PathVariable long id,@RequestBody Classification body){return service.classify(id,body.segmentId(),body.tagIds());}
    @PostMapping public Map<String,Object> create(@RequestBody CustomerService.NewCustomer body){return service.create(body);}
    @GetMapping("/{id}") public Map<String,Object> detail(@PathVariable long id){return service.detail(id);}
    @GetMapping("/{id}/timeline") public Object timeline(@PathVariable long id){return service.detail(id).get("timeline");}
    @PostMapping("/{id}/contact-permission") public Map<String,Object> permission(@PathVariable long id,@RequestBody CustomerService.ContactPermission body){return service.permission(id,body);}
    @PostMapping("/{id}/do-not-contact") public Map<String,Object> stop(@PathVariable long id,@RequestBody CustomerService.StopContact body){return service.doNotContact(id,body.reason());}
    @PostMapping("/{id}/contact-rounds") public Map<String,Object> round(@PathVariable long id,@RequestBody CustomerService.FirstRound body){return service.firstRound(id,body);}
}
