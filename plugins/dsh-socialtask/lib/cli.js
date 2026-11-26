#!/usr/bin/env node
import { accountEntry } from "./account.js";
import { assessEvidence, parseInput, reviewTemplate } from "./workflows.js";
import { reviewWithModel } from "./model-review.js";

const usage=`用法（JSON 从标准输入读取）：
  dsh-socialtask account-entry    # 无需 JSON 输入
  dsh-socialtask review-template
  dsh-socialtask assess-evidence template|wecom-synthetic|wecom-device
  dsh-socialtask model-review --approve-sanitized
前三项完全离线。最后一项为人工、显式开启的 OpenAI Chat Completions 评审，只上传脱敏字段结构。`;

async function stdin(){
  const chunks=[];let size=0;
  for await (const chunk of process.stdin) {
    size+=chunk.length;
    if (size>16384) throw new Error("输入不能超过 16 KiB");
    chunks.push(chunk);
  }
  return parseInput(Buffer.concat(chunks,size).toString("utf8"));
}
async function main([command,mode,...extra]){
  if (!command || command==="--help") { console.log(usage); return; }
  if (extra.length) throw new Error(usage);
  let out;
  if (command==="account-entry" && !mode) out=accountEntry(process.env.SOCIALTASK_APP_URL);
  else if (command==="review-template" && !mode) out=reviewTemplate(await stdin());
  else if (command==="assess-evidence" && ["template","wecom-synthetic","wecom-device"].includes(mode)) out=assessEvidence(mode,await stdin());
  else if (command==="model-review" && mode==="--approve-sanitized") out=await reviewWithModel(await stdin(),{confirmed:true});
  else throw new Error(usage);
  console.log(JSON.stringify(out,null,2));
  if (out.valid===false || out.result==="fail") process.exitCode=1;
}
main(process.argv.slice(2)).catch(e=>{ console.error(e.message);process.exitCode=1; });
