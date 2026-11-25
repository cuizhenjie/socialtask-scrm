package com.socialtask.common;

import com.socialtask.auth.RequestUser;
import org.springframework.security.core.context.SecurityContextHolder;

public final class Access {
    private Access() {}
    public static RequestUser who() {
        var auth=SecurityContextHolder.getContext().getAuthentication();
        if(auth==null || !(auth.getPrincipal() instanceof RequestUser u)) throw new ApiException(401,"请先登录");
        return u;
    }
    public static boolean isAdmin() { return who().role().equals("admin") || who().role().equals("manager"); }
    public static RequestUser admin() { if (!isAdmin()) throw new ApiException(403,"仅管理员可操作"); return who(); }
    public static void ownsTask(long assigneeId) {
        if(!isAdmin() && (who().personId()==null || who().personId()!=assigneeId)) throw new ApiException(403,"不能访问其他人员任务");
    }
}
