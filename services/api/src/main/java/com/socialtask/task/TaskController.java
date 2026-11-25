package com.socialtask.task;

import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class TaskController {
    private final TaskService service;
    public TaskController(TaskService service){this.service=service;}
    public record BatchIn(String title,long contentId,List<Long> assigneeIds,String deadline,Integer reminderInterval,Integer reminderMax,String priority) {}
    @GetMapping("/publish-batches") public List<Map<String,Object>> batches(){return service.batches();}
    @PostMapping("/publish-batches") public Map<String,Object> batch(@RequestBody BatchIn body){return service.createBatch(body);}
    @GetMapping("/tasks") public List<Map<String,Object>> tasks(@RequestParam(required=false) String q,@RequestParam(required=false) String status,@RequestParam(required=false) String type,@RequestParam(required=false) String group,@RequestParam(required=false) Long tagId,@RequestParam(required=false) String priority,@RequestParam(required=false) String sla){return service.list(new TaskService.TaskFilters(q,status,type,group,tagId,priority,sla));}
    @GetMapping("/me/tasks") public List<Map<String,Object>> mine(){return service.list(null);}
    @PostMapping("/tickets") public Map<String,Object> createTicket(@RequestBody TaskService.TicketIn input){return service.createTicket(input);}
    @GetMapping("/tasks/{id}") public Map<String,Object> task(@PathVariable long id){return service.get(id);}
    @PostMapping("/tasks/{id}/submissions") public Map<String,Object> submit(@PathVariable long id,@RequestBody TaskService.TaskSubmit body){return service.submit(id,body);}
    @PostMapping("/tasks/{id}/review") public Map<String,Object> review(@PathVariable long id,@RequestBody TaskService.TaskReview body){return service.review(id,body);}
    @PostMapping("/tasks/{id}/transfer") public Map<String,Object> transfer(@PathVariable long id,@RequestBody TaskService.TaskTransfer body){return service.transfer(id,body);}
    @PostMapping("/tasks/{id}/cancel") public Map<String,Object> cancel(@PathVariable long id){return service.cancel(id);}
}
