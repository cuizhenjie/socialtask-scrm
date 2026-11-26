import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { accountEntry } from "../lib/account.js";

test("prefers account/password and builds login entry only from configured origin",()=>{
  assert.deepEqual({...accountEntry(undefined),instruction:undefined},
    {authMethod:"account-password",status:"not-configured",loginUrl:null,instruction:undefined});
  assert.equal(accountEntry("https://app.example.test/").loginUrl,"https://app.example.test/login");
  assert.equal(accountEntry("https://app.example.test/crm/login").loginUrl,"https://app.example.test/crm/login");
  assert.equal(accountEntry("http://127.0.0.1:3000").loginUrl,"http://127.0.0.1:3000/login");
});

test("refuses unsafe URLs and never echoes credential material",()=>{
  for(const value of ["https://user:secret@app.example.test","https://app.example.test/path?next=/report",
    "https://app.example.test/#hidden","http://app.example.test","javascript:alert(1)",
    "https://app.example.test\\hidden","https://app.example.test/\nsecret"]){
    const result=accountEntry(value);
    assert.equal(result.status,"invalid-address");
    assert.equal(result.loginUrl,null);
    assert.ok(!JSON.stringify(result).includes(value));
  }
});

test("account-entry CLI does not read stdin credentials or contact host",()=>{
  const cli=fileURLToPath(new URL("../lib/cli.js",import.meta.url));
  const result=spawnSync(process.execPath,[cli,"account-entry"],{encoding:"utf8",
    env:{...process.env,SOCIALTASK_APP_URL:"https://app.invalid"},input:"should-not-appear"});
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).loginUrl,"https://app.invalid/login");
  assert.ok(!result.stdout.includes("should-not-appear"));
});
