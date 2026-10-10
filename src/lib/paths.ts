/** 子路径前缀（如 /yunying）。next/link、redirect() 会自动加，裸 <a>/<form>/API 跳转需手动加。 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function withBase(path: string) {
  return BASE_PATH + path;
}

/** 对外完整地址（含子路径），用于飞书回调和消息里的链接 */
export function appUrl(origin?: string) {
  return (process.env.APP_URL || (origin ?? "") + BASE_PATH).replace(/\/$/, "");
}
