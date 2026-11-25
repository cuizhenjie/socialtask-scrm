package com.socialtask.auth;

import com.socialtask.common.Db;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.*;

@Configuration
public class Bootstrap {
    @Bean ApplicationRunner createFirstAdmin(Db db, AuthService auth,
        @Value("${app.bootstrap.username:}") String username,
        @Value("${app.bootstrap.password:}") String password) {
        return ignored -> {
            long users=((Number)db.one("SELECT COUNT(*) AS total FROM users").get("total")).longValue();
            if(users==0 && !username.isBlank() && !password.isBlank()) auth.createUser(username,password,"admin",null);
        };
    }
}
