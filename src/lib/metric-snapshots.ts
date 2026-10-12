import { all, get, run } from "./db";
import { addDays } from "./rules";

export type MetricSnapshot = {
  id: number; video_id: number; platform: string; collected_date: string; collected_at: string;
  published_at: string; publication_url: string; source: string;
  plays: number | null; likes: number | null; comments: number | null; collects: number | null; shares: number | null;
};

/** Keep the day's latest reading; never invent an earlier checkpoint from today's total. */
export function saveMetricSnapshot(x: Omit<MetricSnapshot, "id">) {
  run(`INSERT INTO metric_snapshots(video_id,platform,collected_date,collected_at,published_at,publication_url,plays,likes,comments,collects,shares,source)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(video_id,platform,collected_date) DO UPDATE SET
    collected_at=excluded.collected_at,published_at=excluded.published_at,publication_url=excluded.publication_url,
    plays=excluded.plays,likes=excluded.likes,comments=excluded.comments,collects=excluded.collects,shares=excluded.shares,source=excluded.source`,
    x.video_id, x.platform, x.collected_date, x.collected_at, x.published_at, x.publication_url,
    x.plays, x.likes, x.comments, x.collects, x.shares, x.source);
}

export function checkpointSnapshot(videoId: number, checkpoint: "d7" | "d30") {
  const v = get<{ published_at: string | null; douyin_url: string | null }>("SELECT published_at,douyin_url FROM videos WHERE id=? AND archived_at IS NULL", videoId);
  if (!v?.published_at || !v.douyin_url) return undefined;
  return get<MetricSnapshot>(`SELECT * FROM metric_snapshots WHERE video_id=? AND platform='douyin' AND collected_date=?
    AND published_at=? AND publication_url=? AND plays IS NOT NULL`, videoId, addDays(v.published_at, checkpoint === "d7" ? 7 : 30), v.published_at, v.douyin_url);
}

export function playHistory(videoId: number) {
  return all<MetricSnapshot>(`SELECT s.* FROM metric_snapshots s JOIN videos v ON v.id=s.video_id
    WHERE s.video_id=? AND s.platform='douyin' AND s.plays IS NOT NULL
    AND s.publication_url=v.douyin_url AND s.published_at=v.published_at ORDER BY s.collected_date DESC LIMIT 31`, videoId);
}
