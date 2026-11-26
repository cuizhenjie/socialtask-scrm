// Local business checks. No service calls, file access or external model dependency.
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const KINDS = new Set(["TEXT", "HTTPS_URL", "CHECKBOX", "MATERIAL_PACKAGE"]);
const PHASES = new Set(["DISPATCH", "RESPONSE"]);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const cleanText = (x, max) => typeof x === "string" && x.trim().length > 0 && x.trim().length <= max;
const allowedKeys = (x, keys) => Object.keys(x).every((key) => keys.includes(key));

export function reviewTemplate(input) {
  if (!record(input)) return { valid: false, issues: ["模板须是 JSON 对象"], warnings: [] };
  const issues = [], warnings = [];
  if (!allowedKeys(input, ["key","title","expectedVersion","fields"])) issues.push("模板只允许 key、title、expectedVersion、fields");
  if (typeof input.key !== "string" || !KEY.test(input.key)) issues.push("模板标识须为 1–40 位小写字母、数字或下划线，以字母开头");
  if (!cleanText(input.title, 100)) issues.push("模板名称须为 1–100 个字符");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion >= 2147483647) issues.push("expectedVersion 须是 0–2147483646 的整数，0 表示首次发布");
  if (!Array.isArray(input.fields) || input.fields.length < 1 || input.fields.length > 30) {
    issues.push("字段数量须为 1–30");
    return { valid: false, issues, warnings };
  }
  const keys = new Set();
  for (const [i, field] of input.fields.entries()) {
    const prefix = `字段 #${i+1}`;
    if (!record(field)) { issues.push(prefix+" 不是对象"); continue; }
    if (!allowedKeys(field, ["key","label","phase","kind","required"])) issues.push(prefix+" 含不支持的属性");
    if (typeof field.key !== "string" || !KEY.test(field.key)) issues.push(prefix+" 标识不合规");
    else if (keys.has(field.key)) issues.push(prefix+" 标识重复");
    else keys.add(field.key);
    if (!cleanText(field.label, 100)) issues.push(prefix+" 名称须为 1–100 个字符");
    if (!PHASES.has(field.phase)) issues.push(prefix+" 阶段须为 DISPATCH 或 RESPONSE");
    if (!KINDS.has(field.kind)) issues.push(prefix+" 类型不受支持");
    if (field.phase === "RESPONSE" && field.kind === "MATERIAL_PACKAGE") issues.push(prefix+" 素材包只能作为下发字段");
    if (typeof field.required !== "boolean") issues.push(prefix+" required 必须是布尔值");
  }
  if (!input.fields.some((f) => f?.phase === "DISPATCH" && f.kind === "MATERIAL_PACKAGE")) warnings.push("没有素材包字段：如果业务要发素材，请添加 DISPATCH / MATERIAL_PACKAGE");
  if (!input.fields.some((f) => f?.phase === "RESPONSE")) warnings.push("没有自定义回传字段：仍有系统必填的处理结果说明");
  return { valid: issues.length === 0, issues, warnings };
}

const evidenceRequired = Object.freeze({
  template: [
    ["publish_version", "管理员发布版本，拒绝过期版本号"],
    ["approved_only", "拒绝未审核的素材包和缺少必填字段的工单"],
    ["assigned_download", "当前执行人下载已审核素材"],
    ["unrelated_denied", "无关成员不能下载素材"],
    ["old_version_isolated", "发布新版后，旧单仍按原模板展示与校验"],
    ["validated_response", "后端按原版本拒绝非法回传并接受合法回传"],
  ],
  "wecom-synthetic": [
    ["signed_inbox", "模拟加密回调通过验签，重复事件只入库一次"],
    ["linked_ticket", "从入站消息创建工单并保留来源"],
    ["mock_card", "模拟渠道接收正确执行人、卡片与工单地址"],
    ["login_return", "登录后返回原工单，禁止跨站跳转"],
  ],
  "wecom-device": [
    ["live_inbox", "授权成员发送消息，后台出现匹配文本"],
    ["live_link", "从该消息建单，工单关联原入站记录"],
    ["phone_card", "授权执行人手机实际收到工单卡片"],
    ["phone_ticket", "点击卡片并登录，手机显示同一个工单"],
  ],
});

export function assessEvidence(mode, evidence) {
  if (typeof mode !== "string" || !own(evidenceRequired, mode)) throw new Error("未知验收模式");
  if (!record(evidence)) throw new Error("证据须为 JSON 对象");
  const required = evidenceRequired[mode];
  if (!allowedKeys(evidence, required.map(([id]) => id))) throw new Error("存在未知或跨验收模式的证据");
  const checks = required.map(([id,label]) => {
    const input = own(evidence, id) ? evidence[id] : null;
    if (input != null && (!record(input) || !allowedKeys(input, ["result","reference"]) ||
        !["pass","fail","pending"].includes(input.result) || (input.reference !== undefined && !cleanText(input.reference,200))))
      throw new Error(`证据格式不合法：${id}`);
    if (!input || !input.reference || input.result === "pending") return { id,label,result:"pending" };
    return { id,label,result:input.result };
  });
  const result = checks.some((c) => c.result === "fail") ? "fail" : checks.some((c) => c.result === "pending") ? "pending" : "pass";
  return { mode,result,checks,notes:"这是对输入证据的检查，不会执行验收或验证链接。模拟通过不能替代真机；平台接口接受不等于手机到件。" };
}

export function parseInput(raw) {
  if (typeof raw !== "string" || raw.length > 16384 || raw.trim() === "") throw new Error("JSON 输入为空或超过 16 KiB");
  try { return JSON.parse(raw); } catch { throw new Error("无效 JSON"); }
}
