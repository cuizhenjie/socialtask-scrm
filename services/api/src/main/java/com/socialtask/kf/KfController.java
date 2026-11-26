package com.socialtask.kf;

import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1/kf")
public class KfController {
    private final KfService service;
    public KfController(KfService service){this.service=service;}
    @GetMapping("/state") public Map<String,Object> state(){return service.state();}
    public record SyncIn(Boolean confirm){}
    @PostMapping("/sync") public Map<String,Object> sync(@RequestBody SyncIn body){return service.sync(body!=null&&Boolean.TRUE.equals(body.confirm()));}
    @GetMapping("/conversations") public List<Map<String,Object>> conversations(){return service.conversations();}
    @GetMapping("/conversations/{peer}/messages") public List<Map<String,Object>> messages(@PathVariable String peer){return service.messages(peer);}
}
