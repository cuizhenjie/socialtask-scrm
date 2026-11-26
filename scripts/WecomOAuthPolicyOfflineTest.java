import com.socialtask.auth.WecomOAuthPolicy;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Executes actual production policy logic, without Maven, MySQL or outbound calls. */
public class WecomOAuthPolicyOfflineTest {
    private static int checks;
    private static void check(boolean condition){checks++;if(!condition)throw new AssertionError("OAuth policy assertion "+checks);}
    public static void main(String[] args){
        String state="a".repeat(64),target="/m/tasks/42";
        check(WecomOAuthPolicy.nonce(state));
        for(String bad:Arrays.asList(null,"","a".repeat(63),"a".repeat(65),"g".repeat(64),"A".repeat(64),state+"\n"))check(!WecomOAuthPolicy.nonce(bad));
        check(WecomOAuthPolicy.code("valid+code&value"));check(WecomOAuthPolicy.code("a".repeat(512)));check(WecomOAuthPolicy.code("中".repeat(170)));
        for(String bad:Arrays.asList(null,""," ","a".repeat(513),"中".repeat(171),"a\nb","a\u0000b"))check(!WecomOAuthPolicy.code(bad));
        check(target.equals(WecomOAuthPolicy.cardPath(target)));
        for(String bad:Arrays.asList(null,"https://evil.invalid","//evil.invalid","/\\evil.invalid","/admin","/m/tasks/0","/m/tasks/01","/m/tasks/1/../2","/m/tasks/1?x=1","/m/tasks/1#x","/m/tasks/1\n","/m/tasks/%31","/m/tasks/"+"9".repeat(20)))check(WecomOAuthPolicy.cardPath(bad)==null);
        String callback=WecomOAuthPolicy.callback("https://scrm.example.invalid/");check(callback.equals("https://scrm.example.invalid/api/auth/wecom/callback"));
        check(WecomOAuthPolicy.callback("https://scrm.example.invalid").equals(callback));
        for(String bad:List.of("http://scrm.example.invalid","https://user@host.invalid","https://scrm.example.invalid/path","https://scrm.example.invalid?x=1","https://scrm.example.invalid#f","//host.invalid","https:///path")){
            boolean rejected=false;try{WecomOAuthPolicy.callback(bad);}catch(IllegalArgumentException ex){rejected=true;}check(rejected);
        }
        var uri=URI.create(WecomOAuthPolicy.authorizeUrl("ww-test",1000001,callback,state));
        check(uri.getScheme().equals("https"));check(uri.getHost().equals("open.weixin.qq.com"));check(uri.getPath().equals("/connect/oauth2/authorize"));check(uri.getFragment().equals("wechat_redirect"));
        var query=new HashMap<String,String>();for(String pair:uri.getRawQuery().split("&")){var p=pair.split("=",2);query.put(p[0],URLDecoder.decode(p[1],StandardCharsets.UTF_8));}
        check(query.size()==6);check(query.get("appid").equals("ww-test"));check(query.get("agentid").equals("1000001"));check(query.get("scope").equals("snsapi_base"));check(query.get("response_type").equals("code"));check(query.get("redirect_uri").equals(callback));check(query.get("state").equals(state));
        System.out.println("PASS: "+checks+" offline Java OAuth policy assertions");
    }
}
