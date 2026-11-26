import assert from 'node:assert/strict';
import {startOAuth,finishOAuth,parseAttempt,oauthCookie,oauthCookieOptions,oauthSessionOptions} from '../apps/web/src/lib/wecom-oauth.ts';
import {cardReturnPath,afterLoginPath} from '../apps/web/src/lib/login-return.ts';
let checks=0,calls=0;
const eq=(a,b)=>{assert.equal(a,b);checks++;};
const ok=(a)=>{assert.ok(a);checks++;};
const api='http://isolated-api.invalid', state='a'.repeat(64), token='x'.repeat(43);
const provider='https://open.weixin.qq.com/connect/oauth2/authorize?state='+state+'#wechat_redirect';
const expected='/m/tasks/42';
const mock=async (url,init)=>{
  calls++;eq(init.method,'POST');eq(init.cache,'no-store');eq(init.redirect,'error');
  const body=JSON.parse(init.body);
  if(url.endsWith('/start')){eq(url,api+'/api/v1/auth/wecom/start');ok(/^[0-9a-f]{64}$/.test(body.browserNonce));return Response.json({authorization_url:provider});}
  eq(url,api+'/api/v1/auth/wecom/exchange');eq(body.state,state);eq(body.code,'mock+code');eq(body.browserNonce,attempt.browserNonce);
  return Response.json({access_token:token,expires_in:43200,user:{role:'support'},next:expected});
};
const start=await startOAuth(api,expected,mock),attempt=start.attempt;
eq(start.location,provider);eq(attempt.next,expected);eq(parseAttempt(JSON.stringify(attempt)).browserNonce,attempt.browserNonce);
const another=await startOAuth(api,expected,mock);ok(another.attempt.browserNonce!==attempt.browserNonce);
const q=new URLSearchParams({state,code:'mock+code'}),cookie=JSON.stringify(attempt);
const finish=await finishOAuth(api,q,cookie,mock);eq(finish.location,expected);eq(finish.accessToken,token);
// Cookie and response data never become an externally controlled redirect.
const mockedResponse=(data,status=200)=>async()=>Response.json(data,{status});
for(const bad of ['https://evil.invalid','//evil.invalid','/\\evil.invalid','/m/tasks/0','/m/tasks/1/../2','/m/tasks/01','/m/tasks/1?x=1','/m/tasks/1#x','/m/tasks/1\n','/m/tasks/%31','/admin','/m/tasks/'+'9'.repeat(20)]){
  const s=await startOAuth(api,bad,mock);eq(s.attempt.next,null);
  const f=await finishOAuth(api,q,cookie,mockedResponse({access_token:token,expires_in:43200,user:{role:'support'},next:bad}));eq(f.location,'/m');
}
for(const role of ['admin','manager','author','creator','assistant','support']){
  const f=await finishOAuth(api,q,cookie,mockedResponse({access_token:token,expires_in:43200,user:{role},next:null}));eq(f.location,afterLoginPath(null,role));
}
const before=calls;
for(const [params,c] of [[q,undefined],[q,'not-json'],[q,'{"browserNonce":"short"}'],[new URLSearchParams({state:'bad',code:'abc'}),cookie],[new URLSearchParams({state}),cookie],[new URLSearchParams({state,code:'x'.repeat(513)}),cookie],[new URLSearchParams({state,code:'x\ny'}),cookie],[new URLSearchParams('state='+state+'&state='+state+'&code=abc'),cookie],[new URLSearchParams('state='+state+'&code=one&code=two'),cookie]]){
  const r=await finishOAuth(api,params,c,mock);ok(r.location.startsWith('/login?wecom_error=invalid'));eq(r.accessToken,undefined);
}
eq(calls,before);
for(const [status,reason] of [[400,'invalid'],[401,'invalid'],[403,'unbound'],[404,'disabled'],[502,'unavailable']]){
  const r=await finishOAuth(api,q,cookie,mockedResponse({error:'secret upstream text'},status));eq(r.accessToken,undefined);eq(r.location,'/login?wecom_error='+reason+'&next=%2Fm%2Ftasks%2F42');
}
for(const body of [{access_token:'bad',expires_in:43200,user:{role:'support'}},{access_token:token,expires_in:90000,user:{role:'support'}},{access_token:token,expires_in:43200,user:{role:'root'}}]){
  const r=await finishOAuth(api,q,cookie,mockedResponse(body));eq(r.accessToken,undefined);ok(r.location.includes('wecom_error=unavailable'));
}
for(const url of ['https://evil.invalid/connect/oauth2/authorize?state='+state+'#wechat_redirect','https://open.weixin.qq.com.evil.invalid/connect/oauth2/authorize?state='+state+'#wechat_redirect','http://open.weixin.qq.com/connect/oauth2/authorize?state='+state+'#wechat_redirect','https://open.weixin.qq.com/connect/oauth2/authorize?state=invalid#wechat_redirect']){
  const r=await startOAuth(api,expected,mockedResponse({authorization_url:url}));eq(r.attempt,undefined);ok(r.location.startsWith('/login?'));
}
const disabled=await startOAuth(api,expected,mockedResponse({},404));eq(disabled.location,'/login?wecom_error=disabled&next=%2Fm%2Ftasks%2F42');eq(disabled.attempt,undefined);
const offline=await finishOAuth(api,q,cookie,async()=>{throw Error('network unavailable')});eq(offline.accessToken,undefined);ok(offline.location.includes('wecom_error=unavailable'));
// A callback-provided next is ignored; only the backend state result matters.
const injected=await finishOAuth(api,new URLSearchParams({state,code:'mock+code',next:'https://evil.invalid'}),cookie,mock);eq(injected.location,expected);
eq(cardReturnPath(expected),expected);eq(oauthCookie,'__Host-socialtask_wecom_attempt');eq(oauthCookieOptions.path,'/');eq(oauthCookieOptions.httpOnly,true);eq(oauthCookieOptions.secure,true);eq(oauthCookieOptions.sameSite,'lax');eq(oauthCookieOptions.maxAge,300);eq(oauthSessionOptions.httpOnly,true);eq(oauthSessionOptions.secure,true);eq(oauthSessionOptions.sameSite,'lax');eq(oauthSessionOptions.maxAge,43200);
console.log(`PASS: ${checks} offline OAuth BFF assertions (mock fetch; no network)`);
