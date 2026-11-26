package com.socialtask.auth;

import com.socialtask.common.ApiException;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1/auth/wecom")
public class WecomOAuthController {
    private final WecomOAuthState states;
    private final WecomOAuthClient provider;
    private final AuthService auth;
    public WecomOAuthController(WecomOAuthState states,WecomOAuthClient provider,AuthService auth){this.states=states;this.provider=provider;this.auth=auth;}
    public record Start(String browserNonce,String next){}
    public record Exchange(String state,String browserNonce,String code){}
    @PostMapping("/start") public Map<String,Object> start(@RequestBody Start input){
        provider.requireConfigured();
        String state=states.create(input.browserNonce(),input.next());
        return Map.of("authorization_url",provider.authorization(state));
    }
    @PostMapping("/exchange") public Map<String,Object> exchange(@RequestBody Exchange input){
        provider.requireConfigured();
        if(!WecomOAuthPolicy.code(input.code())) throw new ApiException(400,"授权码无效");
        var attempt=states.consume(input.state(),input.browserNonce());
        // Only the server-to-server provider result may be used as a local identity.
        var response=new LinkedHashMap<>(auth.loginWecom(provider.userId(input.code())));
        response.put("next",attempt.next());
        return response;
    }
}
