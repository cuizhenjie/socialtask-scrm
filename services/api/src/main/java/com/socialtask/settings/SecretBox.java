package com.socialtask.settings;

import com.socialtask.common.ApiException;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.*;

final class SecretBox {
    private final byte[] key;
    private final SecureRandom random=new SecureRandom();
    SecretBox(String encoded){
        byte[] parsed=null;
        try{byte[] candidate=Base64.getDecoder().decode(encoded);if(candidate.length==32)parsed=candidate;}catch(Exception ignored){}
        key=parsed;
    }
    boolean ready(){return key!=null;}
    private Cipher cipher(int mode,byte[] nonce,String context)throws Exception{
        if(!ready())throw new IllegalStateException("master key missing");
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");
        c.init(mode,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,nonce));
        c.updateAAD(context.getBytes(StandardCharsets.UTF_8));return c;
    }
    String encrypt(String clear,String context){
        if(!ready())throw new ApiException(503,"配置主密钥未设置");
        try{byte[] nonce=new byte[12];random.nextBytes(nonce);byte[] data=cipher(Cipher.ENCRYPT_MODE,nonce,context).doFinal(clear.getBytes(StandardCharsets.UTF_8));
            byte[] out=new byte[nonce.length+data.length];System.arraycopy(nonce,0,out,0,nonce.length);System.arraycopy(data,0,out,nonce.length,data.length);return Base64.getEncoder().encodeToString(out);
        }catch(Exception e){throw new ApiException(503,"凭据加密失败");}
    }
    String decrypt(String encrypted,String context){
        if(!ready())throw new ApiException(503,"配置主密钥未设置");
        try{byte[] data=Base64.getDecoder().decode(encrypted);if(data.length<29)throw new IllegalArgumentException();
            return new String(cipher(Cipher.DECRYPT_MODE,Arrays.copyOfRange(data,0,12),context).doFinal(Arrays.copyOfRange(data,12,data.length)),StandardCharsets.UTF_8);
        }catch(Exception e){throw new ApiException(503,"凭据解密失败，请恢复正确主密钥或显式重新设置凭据");}
    }
}
