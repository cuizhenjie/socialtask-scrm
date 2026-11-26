import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {apply} from "../lib/index.js";
import {assessEvidence, reviewTemplate} from "../lib/workflows.js";

const fixture=JSON.parse(readFileSync(new URL("../examples/material-template.json",import.meta.url),"utf8"));

test("checks a backend-compatible template and rejects duplicates, overlong IDs, and material response fields",()=>{
  assert.deepEqual(reviewTemplate(fixture),{valid:true,issues:[],warnings:[]});
  const invalid=structuredClone(fixture);
  invalid.expectedVersion=2147483647;
  invalid.fields.push({...invalid.fields[1],phase:"RESPONSE"});
  invalid.fields[0].key="a".repeat(41);
  const result=reviewTemplate(invalid);
  assert.equal(result.valid,false);
  assert.match(result.issues.join(" "),/版本|expectedVersion/);
  assert.match(result.issues.join(" "),/标识重复/);
  assert.match(result.issues.join(" "),/素材包只能/);
  assert.match(result.issues.join(" "),/标识不合规/);
  assert.equal(reviewTemplate({...fixture,extra:"not allowed"}).valid,false);
});

test("only matching evidence mode and references can produce a pass",()=>{
  const plan=assessEvidence("wecom-synthetic",{});
  assert.equal(plan.result,"pending");
  const evidence=Object.fromEntries(plan.checks.map(({id})=>[id,{result:"pass",reference:"局部测试标签"}]));
  const passed=assessEvidence("wecom-synthetic",evidence);
  assert.equal(passed.result,"pass");
  assert.throws(()=>assessEvidence("wecom-device",evidence),/跨验收模式/);
  assert.equal(assessEvidence("wecom-device",{
    live_inbox:{result:"pass",reference:"手机录屏片段 A"},
    live_link:{result:"pass"}, // no reference
  }).result,"pending");
  assert.equal(assessEvidence("template",{assigned_download:{result:"fail",reference:"预期 200 实际 403"}}).result,"fail");
  assert.throws(()=>assessEvidence("constructor",{}),/未知/);
});

test("native DSH host receives only three read-only tools and three bundled skills",async()=>{
  const tools=[], providers=[];
  apply({
    effect: (fn)=>fn(),
    tools:{register:(tool)=>tools.push(tool)},
    skills:{registerProvider:(provider)=>providers.push(provider)},
  });
  assert.deepEqual(tools.map((x)=>x.name),["socialtask_account_entry","socialtask_review_template","socialtask_assess_evidence"]);
  assert.equal(JSON.parse(await tools[1].execute({templateJson:JSON.stringify(fixture)})).valid,true);
  assert.equal(JSON.parse(await tools[2].execute({mode:"wecom-device",evidenceJson:"{}"})).result,"pending");
  const provider=providers[0](), skills=await provider.list();
  assert.equal(skills.length,3);
  for(const candidate of skills) {
    assert.equal(candidate.invocation.userInvocable,true);
    assert.match((await provider.get(candidate)).content,/不要|不执行/);
    assert.equal(await provider.get({...candidate,locator:"../secret"}),undefined);
  }
});

test("offline terminal command accepts fixture and prevents accidental external invocation",()=>{
  const cli=new URL("../lib/cli.js",import.meta.url).pathname;
  const env={...process.env,SOCIALTASK_LLM_ENABLED:"0"};
  const offline=spawnSync(process.execPath,[cli,"review-template"],{input:JSON.stringify(fixture),encoding:"utf8",env});
  assert.equal(offline.status,0,offline.stderr);
  assert.equal(JSON.parse(offline.stdout).valid,true);
  const bypass=spawnSync(process.execPath,[cli,"model-review"],{input:JSON.stringify(fixture),encoding:"utf8",env});
  assert.equal(bypass.status,1);
  const disabled=spawnSync(process.execPath,[cli,"model-review","--approve-sanitized"],{input:JSON.stringify(fixture),encoding:"utf8",env});
  assert.equal(disabled.status,1);
  assert.match(disabled.stderr,/默认关闭/);
});
