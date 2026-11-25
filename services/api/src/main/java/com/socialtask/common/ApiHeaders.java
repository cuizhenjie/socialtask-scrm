package com.socialtask.common;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.stereotype.Component;
import java.io.IOException;

/** Prevent accidental caching or embedding of authenticated API responses. */
@Component
public class ApiHeaders implements Filter {
    @Override public void doFilter(ServletRequest request,ServletResponse response,FilterChain chain) throws IOException,ServletException {
        if(response instanceof HttpServletResponse r){r.setHeader("Cache-Control","no-store");r.setHeader("X-Content-Type-Options","nosniff");r.setHeader("X-Frame-Options","DENY");}
        chain.doFilter(request,response);
    }
}
