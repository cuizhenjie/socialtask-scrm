package com.socialtask.settings;
import com.socialtask.common.ApiException;
import org.junit.jupiter.api.Test;
import java.util.Base64;
import static org.junit.jupiter.api.Assertions.*;
class ModelSecurityTest {
 @Test void ciphertextIsRandomVersionBoundAndFailClosed(){
    String master=Base64.getEncoder().encodeToString(new byte[32]);
    var box=new SecretBox(master);
    String one=box.encrypt("unit-key","v1"),two=box.encrypt("unit-key","v1");
    assertNotEquals(one,two);assertFalse(one.contains("unit-key"));assertEquals("unit-key",box.decrypt(one,"v1"));
    assertThrows(ApiException.class,()->box.decrypt(one,"v2"));
    assertFalse(new SecretBox("").ready());assertThrows(ApiException.class,()->new SecretBox("").encrypt("unit-key","v1"));
 }
 @Test void exactOriginsAndCanonicalPaths(){
    var policy=new ModelEndpoint("https://gateway.example,https://other.example:8443");
    assertEquals("https://gateway.example/v1/chat/completions",policy.endpoint("https://gateway.example/v1",true));
    assertEquals("https://other.example:8443/chat/completions",policy.endpoint("https://other.example:8443/chat/completions",false));
    for(String bad:new String[]{"http://gateway.example/v1","https://gateway.example.evil/v1","https://gateway.example@evil/v1","https://gateway.example/v1?key=secret","https://gateway.example/v1/../v2","https://gateway.example/%2e%2e","https://gateway.example:8443/v1"})assertThrows(ApiException.class,()->policy.endpoint(bad,true));
 }
}
