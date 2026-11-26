package com.socialtask.settings;

import com.socialtask.common.ApiException;
import java.net.URI;
import java.util.*;

/** A deployment-owned allowlist, never a URL freely supplied to the transport. */
final class ModelEndpoint {
    private final Set<String> origins;
    ModelEndpoint(String allowlist){
        Set<String> parsed=new HashSet<>();
        if(allowlist!=null&&!allowlist.isBlank())for(String item:allowlist.split(",")){
            URI u=parse(item.strip());
            if(!(u.getRawPath().isEmpty()||u.getRawPath().equals("/")))throw new IllegalArgumentException("LLM allowlist must contain HTTPS origins only");
            parsed.add(origin(u));
        }
        origins=Set.copyOf(parsed);
    }
    int count(){return origins.size();}
    private static URI parse(String value){
        try{
            URI u=URI.create(value);
            if(!"https".equalsIgnoreCase(u.getScheme())||u.getHost()==null||u.getRawUserInfo()!=null||u.getRawQuery()!=null||u.getRawFragment()!=null||u.getPort()==0||u.getPort()>65535)throw new IllegalArgumentException();
            String path=u.getRawPath();
            if(path.contains("%")||path.contains("\\")||path.contains("//")||!u.normalize().getRawPath().equals(path)||!path.matches("[A-Za-z0-9_./~-]*"))throw new IllegalArgumentException();
            return u;
        }catch(Exception e){throw new IllegalArgumentException("仅支持无用户名、查询参数、片段和路径穿越的 HTTPS 模型地址");}
    }
    private static String origin(URI u){return "https://"+u.getHost().toLowerCase(Locale.ROOT)+(u.getPort()==-1||u.getPort()==443?"":":"+u.getPort());}
    String endpoint(String input,boolean baseUrl){
        if(input==null||input.isBlank()||input.length()>1024)throw new ApiException(400,"模型地址不能为空或过长");
        try{
            URI uri=parse(input.strip());String root=origin(uri);if(!origins.contains(root))throw new ApiException(400,"模型服务源不在部署允许名单中");
            String path=uri.getRawPath();if(baseUrl)path=path.replaceAll("/+$","")+"/chat/completions";
            if(path.isBlank()||path.equals("/")||!path.endsWith("/chat/completions"))throw new ApiException(400,"请输入 Chat Completions 完整路径或 Base URL");
            return root+path;
        }catch(ApiException e){throw e;}catch(IllegalArgumentException e){throw new ApiException(400,e.getMessage());}
    }
}
