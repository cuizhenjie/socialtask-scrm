package com.socialtask;

import com.socialtask.sla.SlaClock;
import com.socialtask.wecom.WecomCrypto;
import java.time.*;
import java.util.*;

/** Pure JDK tests usable without Maven; exceptions fail CI. */
public class FeatureOfflineTest {
    private static int count=0;
    private static void ok(boolean cond,String name){count++;if(!cond)throw new AssertionError(name);}
    private static void fails(Runnable run,String name){boolean failed=false;try{run.run();}catch(RuntimeException ex){failed=true;}ok(failed,name);}
    public static void main(String[] args){
        Instant fri=ZonedDateTime.of(2026,11,27,17,30,0,0,ZoneId.of("Asia/Shanghai")).toInstant();
        Instant monday=ZonedDateTime.of(2026,11,30,10,30,0,0,ZoneId.of("Asia/Shanghai")).toInstant();
        ok(SlaClock.deadline(fri,120,"BUSINESS_HOURS","Asia/Shanghai","09:00","18:00","1,2,3,4,5").equals(monday),"cross weekend business-hours clock");
        ok(SlaClock.deadline(fri,120,"24X7","Asia/Shanghai","09:00","18:00","1,2,3,4,5").equals(fri.plusSeconds(7200)),"24x7 calendar");
        fails(()->SlaClock.deadline(fri,20,"BUSINESS_HOURS","Asia/Shanghai","18:00","09:00","1,2,3,4,5"),"reversed business hours rejected");
        fails(()->SlaClock.parseDays("1,2,2"),"duplicate weekdays rejected");
        fails(()->SlaClock.parseDays("0,9"),"invalid weekdays rejected");
        byte[] raw=new byte[32];for(int i=0;i<32;i++)raw[i]=(byte)(i+1);
        String key=Base64.getEncoder().withoutPadding().encodeToString(raw);
        var crypt=new WecomCrypto("callback-token",key,"corp-abc");
        byte[] random=new byte[16];Arrays.fill(random,(byte)7);
        String xml="<xml><FromUserName><![CDATA[user001]]></FromUserName><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[需要协助]]></Content></xml>";
        String encrypted=crypt.encryptForTest(xml,random);
        String ts="1795491000",nonce="nonce-001",sig=crypt.signature(ts,nonce,encrypted);
        ok(crypt.verify(sig,ts,nonce,encrypted).equals(xml),"signed AES callback roundtrip");
        ok("user001".equals(WecomCrypto.parseXml(xml).get("FromUserName")),"secure XML parse");
        fails(()->crypt.verify("invalid",ts,nonce,encrypted),"reject forged callback signature");
        fails(()->crypt.verify(sig,ts,"other-nonce",encrypted),"reject modified nonce");
        var otherCorp=new WecomCrypto("callback-token",key,"corp-wrong");
        fails(()->otherCorp.verify(sig,ts,nonce,encrypted),"reject callback target corp mismatch");
        fails(()->WecomCrypto.parseXml("<!DOCTYPE xml [ <!ENTITY x SYSTEM 'file:///etc/passwd'> ]><xml>&x;</xml>"),"reject XXE payload");
        System.out.println("PASS: "+count+" feature offline assertions");
    }
}
