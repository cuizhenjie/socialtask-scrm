package com.socialtask.auth;

import org.springframework.context.annotation.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;

@Configuration
public class SecurityConfig {
    @Bean SecurityFilterChain apiSecurity(HttpSecurity http,AuthService service) throws Exception {
        http.csrf(csrf->csrf.disable()) // Requests use Bearer header, never an ambient browser credential.
            .sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a->a.requestMatchers("/actuator/health","/api/v1/health","/api/v1/auth/login","/api/v1/wecom/callback").permitAll()
                .requestMatchers(HttpMethod.POST,"/api/v1/auth/wecom/start","/api/v1/auth/wecom/exchange").permitAll().anyRequest().authenticated())
            .exceptionHandling(e->e.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
            .addFilterBefore(new AuthFilter(service),UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
