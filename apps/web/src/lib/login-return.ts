// Only card task-detail paths may survive a login. Never accept external URLs,
// protocol-relative URLs, queries, fragments or arbitrary admin routes.
export function cardReturnPath(value:unknown):string|null {
  return typeof value==="string" && /^\/m\/tasks\/[1-9][0-9]{0,18}$/.test(value) && !/\s/.test(value) ? value : null;
}
export function loginUrl(path:unknown):string {
  const target=cardReturnPath(path);
  return target ? `/login?next=${encodeURIComponent(target)}` : "/login";
}
export function afterLoginPath(target:unknown,role:unknown):string {
  return cardReturnPath(target) ?? (["admin","manager"].includes(String(role))?"/admin":"/m");
}
