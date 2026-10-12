export type PublicStats = { plays: number | null; likes: number | null; comments: number | null; collects: number | null; shares: number | null };
export const object = (x: unknown): Record<string, unknown> => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
/** Missing, malformed and rounded text counts are unknown, not zero. */
export function exactCount(x: unknown): number | null {
  if (typeof x !== "number" && (typeof x !== "string" || !/^\d+$/.test(x.trim()))) return null;
  const n = Number(x);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
export function douyinCounts(x: unknown): PublicStats {
  const s = object(x);
  return { plays: exactCount(s.play_count), likes: exactCount(s.digg_count), comments: exactCount(s.comment_count), collects: exactCount(s.collect_count), shares: exactCount(s.share_count) };
}
/** Map only an explicit, exact video id; never rely on response order. */
export function parseDouyinPlayBatch(data: unknown, requested: string[]) {
  const found = new Map<string, PublicStats>(), ids = new Set(requested);
  const visit = (x: unknown, depth = 0) => {
    if (!x || typeof x !== "object" || depth > 5) return;
    if (Array.isArray(x)) { for (const item of x) visit(item, depth + 1); return; }
    const row = object(x), rawId = row.aweme_id ?? row.item_id;
    const id = typeof rawId === "string" ? rawId : typeof rawId === "number" && Number.isSafeInteger(rawId) ? String(rawId) : "";
    if (ids.has(id)) {
      const stats = douyinCounts(row.statistics ?? row);
      if (stats.plays != null) found.set(id, stats);
    }
    for (const [key, value] of Object.entries(row)) {
      if (ids.has(key)) {
        const nested = object(value), stats = douyinCounts(nested.statistics ?? nested);
        if (stats.plays != null) found.set(key, stats);
      }
      if (value && typeof value === "object") visit(value, depth + 1);
    }
  };
  visit(data);
  return found;
}
export function wechatCounts(data: unknown): PublicStats {
  const d = object(data), first = object(Array.isArray(d.objects) ? d.objects[0] : null);
  const ext = object(first.objectExtend ?? d.objectExtend), monotonic = object(ext.monotonicData);
  const c = object(monotonic.countInfo ?? (Object.keys(first).length ? first : d));
  // Equivalence of read_count to creator dashboard plays is unverified.
  return { plays: null, likes: exactCount(c.like_count ?? c.likeCount), comments: exactCount(c.comment_count ?? c.commentCount),
    collects: exactCount(c.fav_count ?? c.favCount), shares: exactCount(c.forward_count ?? c.forwardCount) };
}
