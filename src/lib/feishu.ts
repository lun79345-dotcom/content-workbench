// 飞书开放平台：网页应用登录 + 应用机器人发消息
const OPEN = "https://open.feishu.cn/open-apis";

export function authorizeUrl(redirectUri: string, state: string) {
  const p = new URLSearchParams({ client_id: process.env.FEISHU_APP_ID!, redirect_uri: redirectUri, state });
  return `https://accounts.feishu.cn/open-apis/authen/v1/authorize?${p}`;
}

export async function exchangeCode(code: string, redirectUri: string) {
  const r = await fetch(`${OPEN}/authen/v2/oauth/token`, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: process.env.FEISHU_APP_ID,
      client_secret: process.env.FEISHU_APP_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("飞书换取 token 失败：" + String(j.error_description ?? j.error ?? "未知错误"));
  const u = await fetch(`${OPEN}/authen/v1/user_info`, { signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${j.access_token}` } }).then((x) => x.json());
  if (u.code !== 0) throw new Error("飞书获取用户信息失败：" + String(u.msg ?? u.code));
  return u.data as { open_id: string; name: string; avatar_url?: string };
}

let tenantToken: { v: string; exp: number } | null = null;
async function getTenantToken() {
  if (tenantToken && tenantToken.exp > Date.now()) return tenantToken.v;
  const j = await fetch(`${OPEN}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: process.env.FEISHU_APP_ID, app_secret: process.env.FEISHU_APP_SECRET }),
  }).then((x) => x.json());
  if (!j.tenant_access_token) throw new Error("获取 tenant_access_token 失败：" + j.msg);
  tenantToken = { v: j.tenant_access_token, exp: Date.now() + (j.expire - 300) * 1000 };
  return tenantToken.v;
}

/** 给用户发一条飞书消息卡片，带「打开」按钮（需开通 im:message:send_as_bot 权限并启用机器人能力） */
export async function sendCard(openId: string, text: string, url?: string) {
  const card = {
    config: { wide_screen_mode: true },
    header: { template: "blue", title: { tag: "plain_text", content: "内容工作台" } },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: text } },
      ...(url ? [{ tag: "action", actions: [{ tag: "button", type: "primary", text: { tag: "plain_text", content: "打开" }, url }] }] : []),
    ],
  };
  const token = await getTenantToken();
  const j = await fetch(`${OPEN}/im/v1/messages?receive_id_type=open_id`, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ receive_id: openId, msg_type: "interactive", content: JSON.stringify(card) }),
  }).then((x) => x.json());
  if (j.code !== 0) throw new Error("飞书发消息失败：" + j.msg);
}
