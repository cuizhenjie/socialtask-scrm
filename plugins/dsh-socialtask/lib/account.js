// Derive a read-only account entry. No session/token/password handling or network.
const LOOPBACK=new Set(["localhost","127.0.0.1","[::1]"]);
export function accountEntry(configuredUrl) {
  const raw=typeof configuredUrl==="string"?configuredUrl.trim():"";
  const common={authMethod:"account-password",loginUrl:null,
     instruction:"在 SocialTask 自己的登录页输入账号和密码。不要在 DSH 对话、插件或模型设置中输入密码。"};
  if (!raw) return {...common,status:"not-configured"};
  // Reject userinfo, query, fragments, control characters, and URL normalization of backslashes.
  if (raw.length>2048 || /[\\\p{Cc}]/u.test(raw)) return {...common,status:"invalid-address"};
  let base;
  try { base=new URL(raw); } catch { return {...common,status:"invalid-address"}; }
  if (base.username||base.password||base.search||base.hash||
      !(base.protocol==="https:"||base.protocol==="http:"&&LOOPBACK.has(base.hostname))) {
    return {...common,status:"invalid-address"};
  }
  base.pathname=base.pathname.replace(/\/+$/,"").replace(/\/login$/,"")+"/login";
  return {...common,status:"ready",loginUrl:base.toString()};
}
