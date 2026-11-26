import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {fileURLToPath} from "node:url";

const read=(path)=>readFileSync(new URL(path,import.meta.url),"utf8");
const foreign=/deepseek|深度求索/i;
test("installed package exposes the 3COOL title and original icon in Chinese and English",()=>{
 const pkg=JSON.parse(read("../package.json"));
 assert.equal(pkg.name,"dsh-socialtask");
 assert.equal(pkg.icon,"./icon.png");
 assert.match(pkg.description,/^3COOL/);
 assert.equal(pkg.exports["./locale/*.json"],"./locale/*.json");
 assert.ok(pkg.files.includes("locale"));
 for(const locale of ["en","zh"]){
   const text=read(`../locale/${locale}.json`);
   assert.equal(JSON.parse(text).meta.title,"3COOL · SocialTask SCRM");
   assert.doesNotMatch(text,foreign);
 }
 for(const path of ["../package.json","../lib/index.js","../lib/account.js",
    "../skills/socialtask-account/SKILL.md","../skills/socialtask-acceptance/SKILL.md","../skills/socialtask-ticket-template/SKILL.md"]){
   assert.doesNotMatch(read(path),foreign,path);
 }
 // The link destinations may still name the compatible upstream host; visible text may not.
 assert.doesNotMatch(read("../README.md").replace(/\]\(https?:\/\/[^)]*\)/g,"]"),foreign);
 const cli=spawnSync(process.execPath,[fileURLToPath(new URL("../lib/cli.js",import.meta.url)),"--help"],{encoding:"utf8"});
 assert.equal(cli.status,0);
 assert.match(cli.stdout,/^3COOL/);
 assert.doesNotMatch(cli.stdout,foreign);
});
