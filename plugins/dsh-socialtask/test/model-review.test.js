import test from "node:test";
import assert from "node:assert/strict";
import {modelConfig,modelConfigStatus,reviewPayload,reviewWithModel} from "../lib/model-review.js";

const template={
  key:"private_key_example",
  title:"待隐藏标题",
  expectedVersion:1,
  fields:[{key:"private_field_name",label:"待隐藏标签",phase:"DISPATCH",kind:"MATERIAL_PACKAGE",required:true}],
};
const base={
  SOCIALTASK_LLM_ENABLED:"1",
  SOCIALTASK_LLM_BASE_URL:"https://gateway.example.test/v1/",
  SOCIALTASK_LLM_MODEL:"fake-model",
  SOCIALTASK_LLM_API_KEY:"fake-key-abc",
};

test("normalizes a base URL or preserves a full endpoint but rejects unsafe transport and query secrets",()=>{
  assert.equal(modelConfig(base).destination,"https://gateway.example.test/v1/chat/completions");
  const {SOCIALTASK_LLM_BASE_URL:_,...values}=base;
  assert.equal(modelConfig({...values,SOCIALTASK_LLM_ENDPOINT:"https://gateway.example.test/full"}).destination,"https://gateway.example.test/full");
  assert.equal(modelConfig({...values,SOCIALTASK_LLM_ENDPOINT:"http://127.0.0.1:8787/model"}).destination,"http://127.0.0.1:8787/model");
  for(const url of ["http://remote.example.test/path","file:///tmp/a","https://secret@gateway.example.test","https://g.test/m?k=key","https://g.test/m#x"]){
    assert.throws(()=>modelConfig({...values,SOCIALTASK_LLM_ENDPOINT:url}),/模型地址/);
  }
  assert.throws(()=>modelConfig({...base,SOCIALTASK_LLM_ENDPOINT:"https://g.test/m"}),/仅需配置/);
});

test("never contacts a provider without both explicit confirmation and enabled configuration",async()=>{
  let count=0;
  const fetchImpl=async()=>{count++;throw new Error("must not run");};
  await assert.rejects(reviewWithModel(template,{env:base,fetchImpl}),/人工确认/);
  await assert.rejects(reviewWithModel(template,{confirmed:true,env:{...base,SOCIALTASK_LLM_ENABLED:"0"},fetchImpl}),/默认关闭/);
  await assert.rejects(reviewWithModel({...template,extra:"raw case"},{confirmed:true,env:base,fetchImpl}),/本地结构校验/);
  assert.equal(count,0);
});

test("mock provider only receives structural fields with a fixed server, bounded signal and no redirects",async()=>{
  const expected={fields:[{position:1,phase:"DISPATCH",kind:"MATERIAL_PACKAGE",required:true}]};
  assert.deepEqual(reviewPayload(template),expected);
  const fetchImpl=async(url,request)=>{
    assert.equal(url,"https://gateway.example.test/v1/chat/completions");
    assert.equal(request.redirect,"error");
    assert.equal(request.headers.authorization,"Bearer fake-key-abc");
    assert.ok(request.signal instanceof AbortSignal);
    const body=JSON.parse(request.body);
    assert.equal(body.model,"fake-model");
    assert.deepEqual(JSON.parse(body.messages[1].content),expected);
    for(const secret of [template.key,template.title,template.fields[0].key,template.fields[0].label,base.SOCIALTASK_LLM_API_KEY]){
      assert.ok(!request.body.includes(secret));
    }
    return Response.json({choices:[{message:{content:"请补充回传字段 fake-key-abc"}}]});
  };
  assert.deepEqual(await reviewWithModel(template,{env:base,confirmed:true,fetchImpl}),{advisoryOnly:true,advice:"请补充回传字段 [REDACTED]"});
});

test("rejects malformed and oversized replies and hides upstream error body",async()=>{
  const call=(response)=>reviewWithModel(template,{env:base,confirmed:true,fetchImpl:async()=>response});
  await assert.rejects(call(new Response("X".repeat(32769))),/返回过大/);
  await assert.rejects(call(new Response("invalid json")),/有效 JSON/);
  await assert.rejects(call(Response.json({})),/未包含/);
  await assert.rejects(call(new Response("private upstream body",{status:403})),e=>e.message.includes("403")&&!e.message.includes("upstream"));
  const signal=AbortSignal.abort();
  await assert.rejects(reviewWithModel(template,{env:base,confirmed:true,signal,fetchImpl:async(_url,req)=>req.signal.throwIfAborted()}),/取消或超时/);
});

test("configuration check is offline and never returns the API key",()=>{
  const status=modelConfigStatus(base);assert.equal(status.state,"CONFIGURED");assert.equal(status.connectionTested,false);
  assert.ok(!JSON.stringify(status).includes(base.SOCIALTASK_LLM_API_KEY));
  assert.equal(modelConfigStatus({...base,SOCIALTASK_LLM_ENABLED:"0"}).state,"DISABLED");
  assert.equal(modelConfigStatus({...base,SOCIALTASK_LLM_API_KEY:""}).state,"INCOMPLETE");
});
