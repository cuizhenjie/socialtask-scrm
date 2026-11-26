package com.socialtask.settings;

import org.springframework.stereotype.Component;
import java.net.*;
import java.net.http.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.Flow;
import java.nio.charset.StandardCharsets;

/** No redirects, no automatic retries, bounded output, fixed request destination validated by profile service. */
@Component
public class LlmReviewTransport {
    private final HttpClient http=HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).connectTimeout(Duration.ofSeconds(5)).build();
    public String post(String endpoint,String key,String json)throws Exception{
        var request=HttpRequest.newBuilder(URI.create(endpoint)).timeout(Duration.ofSeconds(30)).header("Content-Type","application/json;charset=utf-8").header("Authorization","Bearer "+key).POST(HttpRequest.BodyPublishers.ofString(json)).build();
        var future=http.sendAsync(request,info->new HttpResponse.BodySubscriber<byte[]>(){
            private final CompletableFuture<byte[]> done=new CompletableFuture<>();
            private final ByteArrayOutputStream buffer=new ByteArrayOutputStream();private Flow.Subscription subscription;
            public CompletionStage<byte[]> getBody(){return done;}
            public void onSubscribe(Flow.Subscription s){subscription=s;s.request(1);}
            public void onNext(List<ByteBuffer> parts){
                for(var part:parts){if(part.remaining()>65536-buffer.size()){subscription.cancel();done.completeExceptionally(new IOException("model response exceeds limit"));return;}byte[] b=new byte[part.remaining()];part.get(b);buffer.writeBytes(b);}subscription.request(1);
            }
            public void onError(Throwable t){done.completeExceptionally(t);}
            public void onComplete(){done.complete(buffer.toByteArray());}
        });
        HttpResponse<byte[]> r;
        try{r=future.get(35,TimeUnit.SECONDS);}catch(Exception e){future.cancel(true);throw e;}
        if(r.statusCode()!=200)throw new IOException("model response rejected");
        return new String(r.body(),StandardCharsets.UTF_8);
    }
}
