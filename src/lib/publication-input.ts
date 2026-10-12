export const PUBLICATION_PLATFORMS = ["douyin", "wechat", "xhs"] as const;
export type PublicationPlatform = typeof PUBLICATION_PLATFORMS[number];
export const PUBLICATION_LABELS = { douyin: "抖音", wechat: "视频号", xhs: "小红书" } as const;

const DOMAINS: Record<PublicationPlatform, string[]> = {
  douyin: ["douyin.com", "iesdouyin.com"],
  wechat: ["weixin.qq.com", "wx.qq.com"],
  xhs: ["xiaohongshu.com", "xhslink.com"],
};

/** Parse pasted share text locally. Unknown hosts are never guessed or fetched. */
export function parsePublicationText(text: string) {
  const links: Record<PublicationPlatform, string[]> = { douyin: [], wechat: [], xhs: [] };
  const unknown: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'，。；、（）【】「」《》“”‘’]+/gi)) {
    const raw = match[0].replace(/[.!?;:,)\]}]+$/, "");
    let address: URL;
    try { address = new URL(raw); } catch { invalid.push(raw); continue; }
    const href = address.href;
    if (seen.has(href)) continue;
    seen.add(href);
    const platform = !address.username && !address.password && PUBLICATION_PLATFORMS.find((p) =>
      DOMAINS[p].some((domain) => address.hostname === domain || address.hostname.endsWith(`.${domain}`)));
    if (platform) links[platform].push(href); else unknown.push(href);
  }
  return { links, unknown, invalid };
}
