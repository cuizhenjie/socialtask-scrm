package com.socialtask;

import com.socialtask.auth.RequestUser;
import com.socialtask.common.ApiException;
import com.socialtask.settings.SettingsController;
import org.junit.jupiter.api.*;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class SettingsControllerTest {
    private static void identity(String role){
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(new RequestUser(1L,"unit",role,null),null,List.of()));
    }
    @AfterEach void clear(){SecurityContextHolder.clearContext();}
    @Test void refusesNonAdminAndNeverExposesSecrets(){
        var env=new MockEnvironment().withProperty("app.wecom.enabled","true").withProperty("app.wecom.oauth-enabled","true")
            .withProperty("app.wecom.corp-id","ww-sensitive-corp").withProperty("app.wecom.agent-id","10001").withProperty("app.wecom.secret","unit-secret-never-return")
            .withProperty("app.wecom.callback-token","unit-token-never-return").withProperty("app.wecom.encoding-aes-key","AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA")
            .withProperty("app.wecom.callback-enabled","true").withProperty("app.public-url","https://unit.example.test");
        var controller=new SettingsController(env);
        for(String role:List.of("manager","creator","support")){identity(role);assertEquals(403,assertThrows(ApiException.class,controller::settings).status);}
        identity("admin");
        var data=controller.settings();assertEquals(false,data.get("connection_tested"));
        String serialized=data.toString();
        for(String secret:List.of("ww-sensitive-corp","unit-secret-never-return","unit-token-never-return","AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA"))assertFalse(serialized.contains(secret));
        var checks=(List<?>)data.get("checks");assertEquals("CONFIGURED",((Map<?,?>)checks.getFirst()).get("state"));
        assertEquals("DISABLED",((Map<?,?>)checks.getLast()).get("state"));
    }
    @Test void incompleteConfigCannotClaimReady(){
        identity("admin");var data=new SettingsController(new MockEnvironment().withProperty("app.wecom.oauth-enabled","true")).settings();
        assertEquals("INCOMPLETE",((Map<?,?>)((List<?>)data.get("checks")).get(2)).get("state"));
    }
}
