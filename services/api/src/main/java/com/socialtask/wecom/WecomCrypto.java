package com.socialtask.wecom;

import javax.crypto.*;
import javax.crypto.spec.*;
import javax.xml.XMLConstants;
import javax.xml.parsers.*;
import org.w3c.dom.*;
import org.xml.sax.InputSource;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;

/** Enterprise WeChat AES-256-CBC encrypted callback verification, without external SDK dependencies. */
public final class WecomCrypto {
    private final String token,corpId;private final byte[] key;
    public WecomCrypto(String token,String encodingAESKey,String corpId){
        if(token==null||token.isBlank()||corpId==null||corpId.isBlank()) throw new IllegalArgumentException("回调 Token 和 CorpID 未配置");
        try{key=Base64.getDecoder().decode(encodingAESKey+"=");}catch(Exception e){throw new IllegalArgumentException("EncodingAESKey 无效");}
        if(key.length!=32) throw new IllegalArgumentException("EncodingAESKey 必须为 43 字符的企业微信密钥");
        this.token=token;this.corpId=corpId;
    }
    public String signature(String timestamp,String nonce,String encrypted){
        try{
            String[] items={token,timestamp,nonce,encrypted};Arrays.sort(items);
            byte[] hash=MessageDigest.getInstance("SHA-1").digest(String.join("",items).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        }catch(GeneralSecurityException e){throw new IllegalStateException(e);}
    }
    public boolean valid(String signature,String timestamp,String nonce,String encrypted){
        if(signature==null||timestamp==null||nonce==null||encrypted==null) return false;
        byte[] given=signature.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.US_ASCII);
        byte[] expected=signature(timestamp,nonce,encrypted).getBytes(StandardCharsets.US_ASCII);
        return MessageDigest.isEqual(given,expected);
    }
    public String decrypt(String encrypted){
        try{
            byte[] ciphertext=Base64.getDecoder().decode(encrypted);
            if(ciphertext.length==0 || ciphertext.length%16!=0) throw new SecurityException("加密回调格式非法");
            Cipher cipher=Cipher.getInstance("AES/CBC/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new IvParameterSpec(key,0,16));
            byte[] bytes=cipher.doFinal(ciphertext);
            int padding=bytes[bytes.length-1]&0xff;
            if(padding<1||padding>32||bytes.length<=padding) throw new SecurityException("回调填充非法");
            for(int i=bytes.length-padding;i<bytes.length;i++) if((bytes[i]&0xff)!=padding) throw new SecurityException("回调填充不匹配");
            int length=bytes.length-padding;
            if(length<20) throw new SecurityException("回调内容不足");
            long len=Integer.toUnsignedLong(ByteBuffer.wrap(bytes,16,4).getInt());
            if(len>1024*1024 || 20+len>length) throw new SecurityException("回调内容长度非法");
            String payload=new String(bytes,20,(int)len,StandardCharsets.UTF_8);
            String receiver=new String(bytes,20+(int)len,length-20-(int)len,StandardCharsets.UTF_8);
            if(!corpId.equals(receiver)) throw new SecurityException("回调目标企业不匹配");
            return payload;
        }catch(GeneralSecurityException|IllegalArgumentException e){throw new SecurityException("回调无法解密或未通过校验",e);}
    }
    public String verify(String given,String timestamp,String nonce,String encrypted){
        if(!valid(given,timestamp,nonce,encrypted)) throw new SecurityException("签名校验失败");
        return decrypt(encrypted);
    }
    public static Map<String,String> parseXml(String xml){
        if(xml==null||xml.length()>1_000_000) throw new SecurityException("回调超过大小限制");
        try{
            DocumentBuilderFactory f=DocumentBuilderFactory.newInstance();
            f.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);
            f.setFeature("http://xml.org/sax/features/external-general-entities",false);
            f.setFeature("http://xml.org/sax/features/external-parameter-entities",false);
            f.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING,true);
            f.setXIncludeAware(false);f.setExpandEntityReferences(false);
            DocumentBuilder builder=f.newDocumentBuilder();
            Document doc=builder.parse(new InputSource(new StringReader(xml)));
            if(!"xml".equals(doc.getDocumentElement().getTagName())) throw new SecurityException("回调 XML 根标签错误");
            Map<String,String> result=new HashMap<>();
            NodeList children=doc.getDocumentElement().getChildNodes();
            for(int i=0;i<children.getLength();i++)if(children.item(i) instanceof Element e) result.put(e.getTagName(),e.getTextContent());
            return result;
        }catch(Exception e){throw new SecurityException("回调 XML 无效",e);}
    }
    /** Test-only fixture production helper; never used by controller to send callbacks. */
    public String encryptForTest(String plain,byte[] random16){
        if(random16.length!=16) throw new IllegalArgumentException();
        try{
            byte[] content=plain.getBytes(StandardCharsets.UTF_8),corp=corpId.getBytes(StandardCharsets.UTF_8);
            ByteBuffer data=ByteBuffer.allocate(20+content.length+corp.length+32);
            data.put(random16).putInt(content.length).put(content).put(corp);
            int padding=32-(data.position()%32);for(int i=0;i<padding;i++)data.put((byte)padding);
            Cipher cipher=Cipher.getInstance("AES/CBC/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(key,"AES"),new IvParameterSpec(key,0,16));
            return Base64.getEncoder().encodeToString(cipher.doFinal(Arrays.copyOf(data.array(),data.position())));
        }catch(GeneralSecurityException e){throw new IllegalStateException(e);}
    }
}
