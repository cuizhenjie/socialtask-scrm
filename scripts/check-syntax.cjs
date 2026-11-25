/* Syntax-only TS/TSX validation. Does not replace dependency-installed tsc --noEmit. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../apps/web');
const globalRoot=cp.execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim();
const typescript=require(require.resolve('typescript',{paths:[root,globalRoot]}));
const files=[];
function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
 const name=path.join(folder,entry.name);if(entry.isDirectory())walk(name);else if(/\.(tsx?|jsx?)$/.test(name))files.push(name);
}}
walk(path.join(root,'src'));
let failed=0;
for(const file of files){const text=fs.readFileSync(file,'utf8');
 const report=typescript.transpileModule(text,{fileName:file,reportDiagnostics:true,compilerOptions:{target:typescript.ScriptTarget.ES2022,module:typescript.ModuleKind.ESNext,jsx:typescript.JsxEmit.Preserve}});
 for(const d of report.diagnostics||[]){if(d.category===typescript.DiagnosticCategory.Error){failed++;console.error(`${path.relative(root,file)} TS${d.code}: ${typescript.flattenDiagnosticMessageText(d.messageText,' ')}`);}}
}
console.log(`${failed?'FAIL':'PASS'}: parsed ${files.length} frontend TypeScript/TSX modules; ${failed} syntax errors`);
if(failed)process.exit(1);
