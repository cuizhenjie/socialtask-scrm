package com.socialtask.auth;

import com.socialtask.common.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class AuthController {
    private final AuthService auth;
    public AuthController(AuthService auth) {this.auth=auth;}
    public record Login(String username,String password) {}
    @GetMapping("/health") public Map<String,Object> health(){return Map.of("ok",true,"service","socialtask","version","1.1.0");}
    @PostMapping("/auth/login") public Map<String,Object> login(@RequestBody Login input) {return auth.login(input.username(),input.password());}
    @PostMapping("/auth/logout") public Map<String,Object> logout(HttpServletRequest request) {
        String header=request.getHeader("Authorization");auth.logout(header!=null && header.startsWith("Bearer ")?header.substring(7):null);
        return Map.of("ok",true);
    }
    @GetMapping("/me") public Map<String,Object> me(){return auth.userView(Access.who());}
}
