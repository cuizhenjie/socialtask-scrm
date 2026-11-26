import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assessEvidence, parseInput, reviewTemplate } from "./workflows.js";

export const name = "socialtask";
export const inject = ["skills", "tools"];
const packagedSkills = [
  ["socialtask-ticket-template", "设计、审阅 SocialTask 的版本化工单模板与素材下发"],
  ["socialtask-acceptance", "区分 SocialTask 工单模板、企微模拟与真机验收证据"],
];
const skillEntries = packagedSkills.map(([name, description])=>{
  const path=fileURLToPath(new URL(`../skills/${name}/SKILL.md`,import.meta.url));
  return {name,description,path,locator:name,rank:600,source:"bundled",provider:"socialtask",
    resourceBase:{kind:"directory",path:dirname(path)},invocation:{userInvocable:true,modelInvocable:true}};
});

export function apply(ctx) {
  ctx.effect(() => ctx.skills.registerProvider(() => ({
    name: "socialtask",
    async list() { return skillEntries; },
    async get(candidate) {
      const skill=skillEntries.find((entry)=>entry.locator===candidate.locator&&entry.name===candidate.name);
      if (!skill) return undefined;
      const {rank,locator,...summary}=skill;
      const markdown=readFileSync(skill.path,"utf8");
      const content=markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,"");
      return {...summary,content};
    },
  })));
  const string = { type:"string" };
  const output = {schema:string,render:(_args,value)=>[{type:"text",text:value}]};
  ctx.tools.register({
    name:"socialtask_review_template",
    description:"本地检查 SocialTask /ticket-templates 的草稿。只传模板定义；不要传客户数据、附件或密钥。不会发布模板或访问网络。",
    parameters:{type:"object",additionalProperties:false,required:["templateJson"],properties:{templateJson:string}},
    output,
    async execute({templateJson}) { return JSON.stringify(reviewTemplate(parseInput(templateJson)),null,2); },
  });
  ctx.tools.register({
    name:"socialtask_assess_evidence",
    description:"按 template、wecom-synthetic 或 wecom-device 评估证据。先用空 evidenceJson '{}' 取得检查项，再填真实结果；不会调用后端、企微或验证证据链接。",
    parameters:{type:"object",additionalProperties:false,required:["mode","evidenceJson"],properties:{
      mode:{type:"string",enum:["template","wecom-synthetic","wecom-device"]},evidenceJson:string}},
    output,
    async execute({mode,evidenceJson}) { return JSON.stringify(assessEvidence(mode,parseInput(evidenceJson)),null,2); },
  });
}
