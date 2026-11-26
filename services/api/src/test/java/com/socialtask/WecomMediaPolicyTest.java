package com.socialtask;
import com.socialtask.wecom.WecomMediaPolicy;
import com.socialtask.common.ApiException;
import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import static org.junit.jupiter.api.Assertions.*;
class WecomMediaPolicyTest {
 @Test void validatesBoundsAndFormat(){
    assertThrows(ApiException.class,()->WecomMediaPolicy.validate("image","bad.png",new byte[20]));
    assertThrows(ApiException.class,()->WecomMediaPolicy.validate("file","x",new byte[5]));
    assertThrows(ApiException.class,()->WecomMediaPolicy.validate("file","x",new byte[WecomMediaPolicy.MAX_BYTES+1]));
    assertThrows(ApiException.class,()->WecomMediaPolicy.validate("video","x.mp4",new byte[20]));
    byte[] amr=Arrays.copyOf("#!AMR\n".getBytes(StandardCharsets.US_ASCII),19);
    assertEquals("voice/amr",WecomMediaPolicy.validate("voice","voice.amr",amr).mime());
    assertThrows(ApiException.class,()->WecomMediaPolicy.validate("voice","x.amr",Arrays.copyOf(amr,18)));
    var file=WecomMediaPolicy.validate("file","evil\r\n\".txt",new byte[6]);assertFalse(file.filename().contains("\n"));
    assertTrue(WecomMediaPolicy.validMediaId("unit-media-id"));
    assertFalse(WecomMediaPolicy.validMediaId("https://host?token=bad"));
 }
}
