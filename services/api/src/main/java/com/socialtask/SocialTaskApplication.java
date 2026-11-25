package com.socialtask;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class SocialTaskApplication {
    public static void main(String[] args) { SpringApplication.run(SocialTaskApplication.class, args); }
}
