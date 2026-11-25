package com.socialtask.common;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.*;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestControllerAdvice
public class ApiErrors {
    @ExceptionHandler(ApiException.class)
    ResponseEntity<?> known(ApiException ex) { return ResponseEntity.status(ex.status).body(Map.of("error",ex.getMessage())); }
    @ExceptionHandler({DataIntegrityViolationException.class})
    ResponseEntity<?> conflicting(Exception ex) { return ResponseEntity.status(409).body(Map.of("error","唯一性或关联约束冲突，请刷新后重试")); }
    @ExceptionHandler({IllegalArgumentException.class,HttpMessageNotReadableException.class,MissingServletRequestParameterException.class})
    ResponseEntity<?> invalid(Exception ex) { return ResponseEntity.badRequest().body(Map.of("error",ex.getMessage()==null?"参数有误":ex.getMessage())); }
    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<?> forbidden(Exception ex) { return ResponseEntity.status(403).body(Map.of("error","没有访问权限")); }
}
