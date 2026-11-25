package com.socialtask.sla;

import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class SlaController {
    private final SlaService service;
    public SlaController(SlaService service){this.service=service;}
    @GetMapping("/sla/policies") public List<Map<String,Object>> policies(){return service.policies();}
    @PostMapping("/sla/policies") public Map<String,Object> create(@RequestBody SlaService.PolicyInput input){return service.create(input);}
    @PutMapping("/sla/policies/{id}") public Map<String,Object> update(@PathVariable long id,@RequestBody SlaService.PolicyInput input){return service.update(id,input);}
    @GetMapping("/tasks/{id}/sla") public Map<String,Object> detail(@PathVariable long id){return service.view(id);}
    public record PriorityUpdate(String priority){}
    @PostMapping("/tasks/{id}/priority") public Map<String,Object> priority(@PathVariable long id,@RequestBody PriorityUpdate data){return service.reprioritize(id,data.priority());}
}
