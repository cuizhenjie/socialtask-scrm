package com.socialtask.wecom;

import com.socialtask.common.ApiException;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.imageio.ImageIO;

/** Conservative local limits, independently of the provider's maximum size. */
public final class WecomMediaPolicy {
    public static final int MAX_BYTES=5*1024*1024;
    private WecomMediaPolicy(){}
    public record Upload(String type,String filename,String mime,byte[] bytes){}
    public static boolean validMediaId(String id){return id!=null&&id.matches("[A-Za-z0-9_.@=+/-]{1,512}");}
    public static String digest(byte[] bytes){
        try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
        catch(GeneralSecurityException e){throw new IllegalStateException(e);}
    }
    private static boolean prefix(byte[] bytes,byte[] expected){
        if(bytes.length<expected.length)return false;
        for(int i=0;i<expected.length;i++)if(bytes[i]!=expected[i])return false;
        return true;
    }
    private static void reject(boolean condition,String message){if(condition)throw new ApiException(400,message);}
    public static Upload validate(String type,String filename,byte[] bytes){
        reject(type==null||!Set.of("image","voice","video","file").contains(type),"不支持的媒体类型");
        int max=Set.of("image","voice").contains(type)?2*1024*1024:MAX_BYTES;
        reject(bytes==null||bytes.length<=5||bytes.length>max,"媒体须大于 5 字节且不超过本系统类型上限");
        String name=filename==null?"file":filename.replaceAll("[^A-Za-z0-9_.-]","_");
        if(name.length()>100)name=name.substring(name.length()-100);
        if(name.isBlank()||name.equals(".")||name.equals(".."))name="file";
        String mime=switch(type){
            case "image" -> {
                boolean png=prefix(bytes,new byte[]{(byte)0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a});
                boolean jpeg=prefix(bytes,new byte[]{(byte)0xff,(byte)0xd8,(byte)0xff});
                reject(!png&&!jpeg,"只允许 PNG/JPEG 图片");
                try(var stream=ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))){
                    if(stream==null)throw new IOException();
                    var readers=ImageIO.getImageReaders(stream);if(!readers.hasNext())throw new IOException();
                    var reader=readers.next();
                    try{reader.setInput(stream,true,true);int w=reader.getWidth(0),h=reader.getHeight(0);
                        if(w<=0||h<=0||w>4096||h>4096||(long)w*h>12_000_000L||reader.read(0)==null)throw new IOException();
                    }finally{reader.dispose();}
                }catch(Exception e){throw new ApiException(400,"图片无法解析或尺寸超限");}
                yield png?"image/png":"image/jpeg";
            }
            case "voice" -> {
                reject(!prefix(bytes,"#!AMR\n".getBytes(StandardCharsets.US_ASCII)),"语音仅支持 AMR-NB");
                int[] sizes={12,13,15,17,19,20,26,31,5};int offset=6,frames=0;
                while(offset<bytes.length){int ft=(bytes[offset]>>3)&15;reject(ft>=sizes.length,"AMR 帧格式不支持");offset+=1+sizes[ft];frames++;reject(offset>bytes.length||frames>3000,"语音帧不完整或超过 60 秒");}
                reject(frames==0,"语音无有效帧");yield "voice/amr";
            }
            case "video" -> {reject(bytes.length<12||!new String(bytes,4,4,StandardCharsets.US_ASCII).equals("ftyp"),"视频仅支持 MP4 容器");yield "video/mp4";}
            default -> "application/octet-stream";
        };
        return new Upload(type,name,mime,bytes);
    }
}
