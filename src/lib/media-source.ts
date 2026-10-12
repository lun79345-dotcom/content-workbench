export function safeMediaUrl(raw: string) {
  const u = new URL(raw);
  const suffixes = ["douyinvod.com", "douyin.com", "byteimg.com", "bytecdn.cn", "snssdk.com", "amemv.com", "bytedance.com", "zjcdn.com"];
  if (u.protocol !== "https:" || u.username || u.password || u.port && u.port !== "443" || !suffixes.some((s) => u.hostname === s || u.hostname.endsWith("." + s))) throw new Error("unsupported media host");
  return u.href;
}
