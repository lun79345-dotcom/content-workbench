import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './helpers.mjs';

function sample(f, id, { date = '2026-10-12', published = '2026-10-12', url = 'https://douyin.com/video/1', platform = 'douyin', plays = 485 } = {}) {
  f.load('@/lib/metric-snapshots').saveMetricSnapshot({ video_id: id, platform, collected_date: date,
    collected_at: `${date} 12:00:00`, published_at: published, publication_url: url, source: 'tikhub',
    plays, likes: null, comments: null, collects: null, shares: null });
}

test('月汇总展示已采集的485播放，但不冒充第7天数据或生成奖金', () => {
  const f = fixture();
  try {
    const id = f.video({ stage: '已发布', published_at: '2026-10-12', douyin_url: 'https://douyin.com/video/1' });
    sample(f, id);
    const row = f.load('@/lib/stats').accountMonthly('2026-10')[0];
    assert.equal(row.latestPlays, 485);
    assert.equal(row.sampledCount, 1);
    assert.equal(row.pendingCount, 1);
    assert.equal(row.hasCheckpointPlays, false);
    assert.equal(row.plays, 0);
    assert.equal(row.hits, 0);
    assert.equal(f.get('SELECT count(*) n FROM metrics').n, 0);
    assert.equal(f.get('SELECT count(*) n FROM bonuses').n, 0);
  } finally { f.close(); }
});

test('最新累计值不累加每日快照，剔除旧发布链接和日期，保留第7天考核口径', () => {
  const f = fixture();
  try {
    const id = f.video({ stage: '已发布', published_at: '2026-10-12', douyin_url: 'https://douyin.com/video/1', wechat_url: 'https://weixin.qq.com/example' });
    sample(f, id);
    sample(f, id, { date: '2026-10-13', plays: 600 });
    sample(f, id, { date: '2026-10-14', plays: 10000, url: 'https://douyin.com/video/old' });
    sample(f, id, { date: '2026-10-15', plays: 20000, published: '2026-09-12' });
    sample(f, id, { platform: 'wechat', url: 'https://weixin.qq.com/example', plays: 200 });
    for (const [platform, plays] of [['douyin', 300], ['wechat', 100]])
      f.run("INSERT INTO metrics(video_id,checkpoint,platform,plays) VALUES(?,'d7',?,?)", id, platform, plays);
    const row = f.load('@/lib/stats').accountMonthly('2026-10')[0];
    assert.equal(row.latestPlays, 800);
    assert.equal(row.sampledCount, 1);
    assert.equal(row.plays, 400);
    assert.equal(row.pendingCount, 0);
    assert.equal(row.hasCheckpointPlays, true);
  } finally { f.close(); }
});

test('未采集与真实零播放不同，按视频发布月份归属而非采集月份', () => {
  const f = fixture();
  try {
    const stats = f.load('@/lib/stats');
    const id = f.video({ stage: '已发布', published_at: '2026-10-12', douyin_url: 'https://douyin.com/video/1' });
    assert.equal(stats.accountMonthly('2026-10')[0].latestPlays, null);
    sample(f, id, { date: '2026-11-01', plays: 0 });
    assert.equal(stats.accountMonthly('2026-10')[0].latestPlays, 0);
    assert.equal(stats.accountMonthly('2026-10')[0].sampledCount, 1);
    assert.equal(stats.accountMonthly('2026-11')[0].latestPlays, null);
    const second = f.video({ stage: '已发布', published_at: '2026-09-12', douyin_url: 'https://douyin.com/video/1' });
    sample(f, second, { published: '2026-09-12', plays: 100 });
    assert.equal(stats.accountMonthly('2026-10')[0].latestPlays, 0);
    assert.equal(stats.accountMonthly('2026-09')[0].latestPlays, 100);
  } finally { f.close(); }
});
