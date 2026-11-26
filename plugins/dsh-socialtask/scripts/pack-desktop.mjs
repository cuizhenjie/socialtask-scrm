import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = resolve(process.argv[2] ?? join(packageRoot, "dist"));
if (process.argv.length > 3) throw new Error("用法：npm run pack:desktop -- <输出目录>");
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"),"utf8"));
const icon = readFileSync(join(packageRoot,"icon.png"));
if (manifest.icon!=="./icon.png" || icon.length < 24 ||
    icon.subarray(0,8).toString("hex")!=="89504e470d0a1a0a" || icon.subarray(12,16).toString("ascii")!=="IHDR" ||
    icon.readUInt32BE(16)<1 || icon.readUInt32BE(20)<1)
  throw new Error("插件图标必须是可验证的 PNG");
mkdirSync(destination,{recursive:true});

// npm invokes this script and provides the actual npm CLI path, portable on Windows/macos/Linux.
const npmCli=process.env.npm_execpath;
if(!npmCli) throw new Error("请通过 npm run pack:desktop 运行");
const pack=spawnSync(process.execPath,[npmCli,"pack","--ignore-scripts","--json","--pack-destination",destination],
    {cwd:packageRoot,encoding:"utf8",maxBuffer:1024*1024});
if (pack.error || pack.status!==0) throw new Error("npm pack 失败\n"+(pack.error?.message??pack.stderr));
const [result]=JSON.parse(pack.stdout);
const expectedFile=`${manifest.name}-${manifest.version}.tgz`;
if (result.filename!==expectedFile) throw new Error("打包文件名与插件版本不一致");
const paths=result.files.map(f=>f.path);
const required=["package.json","README.md","icon.png","cordis.patch.yml","lib/index.js","lib/account.js","lib/cli.js",
  "skills/socialtask-account/SKILL.md","skills/socialtask-acceptance/SKILL.md","skills/socialtask-ticket-template/SKILL.md",
  "locale/en.json","locale/zh.json"];
for (const entry of required) if(!paths.includes(entry)) throw new Error(`缺少打包文件：${entry}`);
if (paths.some(p=>!["package.json","README.md","icon.png","cordis.patch.yml"].includes(p) &&
      !/^(lib|skills|examples|locale)\//.test(p)))
  throw new Error("包中包含非运行时文件");
const archive=join(destination,expectedFile);
console.log(JSON.stringify({archive,size:result.size,version:manifest.version,sha256:createHash("sha256").update(readFileSync(archive)).digest("hex"),
  files:paths},null,2));
