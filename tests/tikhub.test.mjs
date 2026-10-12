import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, form } from './helpers.mjs';
const idFor = (n) => String(7448118827402972400n + BigInt(n));
const response = (data) => new Response(JSON.stringify({ code: 200, data }), { status: 200 });
const scenario = (name, fn) => test(name, async () => {
  const f = fixture(), originalFetch = global.fetch;
  process.env.TIKHUB_API_KEY = 'fixture-key';
  process.env.TIKHUB_DAILY_REQUEST_LIMIT = '1000';
  process.env.TIKHUB_DAILY_PLAY_BATCH_LIMIT = '10';
  const day = f.get("SELECT date('now','+8 hours') day").day;
  const published = f.get("SELECT date('now','+8 hours','-7 day') day").day;
  const video = (n = 1, extra = {}) => f.video({ stage: '已发布', published_at: published, douyin_url: `https://www.douyin.com/video/${idFor(n)}`, ...extra });
  try { await fn({ f, day, published, video, api: f.load('@/lib/tikhub'), snapshots: f.load('@/lib/metric-snapshots') }); }
  finally { global.fetch = originalFetch; f.close(); }
});
const stats = (ids) => ({ statistics_list: ids.map(aweme_id => ({ aweme_id, play_count: 1234, digg_count: 12, share_count: 2 })) });
const detail = (id) => ({ aweme_detail: { aweme_id: id, statistics: { play_count: 0, digg_count: 12, comment_count: 3, collect_count: 4, share_count: 2 } } });
scenario('播放解析按精确ID匹配，真实零保留，缺失/缩写/非法数字保留未知', ({ f }) => {
  const p = f.load('@/lib/tikhub-data');
  for (const x of [null, undefined, '', true, {}, -1, 1.5, '1.2万', 'null', Number.MAX_SAFE_INTEGER + 1]) assert.equal(p.exactCount(x), null);
  assert.equal(p.exactCount('0'), 0); assert.equal(p.exactCount(0), 0);
  const a = idFor(1), b = idFor(2);
  const parsed = p.parseDouyinPlayBatch({ statistics_list: [{ aweme_id: b, play_count: 0 }, { aweme_id: a, statistics: { play_count: '250' } }, { aweme_id: idFor(3), play_count: 9999 }, { play_count: 888 }] }, [a,b]);
  assert.equal(parsed.get(a).plays, 250); assert.equal(parsed.get(b).plays, 0); assert.equal(parsed.size, 2);
  assert.equal(p.parseDouyinPlayBatch({ statistics_list: [{ aweme_id: Number(a), play_count: 4 }] }, [a]).size, 0);
  assert.equal(p.wechatCounts({ read_count: 12345, like_count: 0, comment_count: 3 }).plays, null);
  assert.equal(p.wechatCounts({ read_count: 12345, like_count: 0 }).likes, 0);
});
scenario('51条作品分为两批，互动保留、每日快照不自动影响考核，重复采集跳过成功播放', async ({ f, video, api }) => {
  const requests = []; for (let n=1;n<=51;n++) video(n);
  global.fetch = async (url) => {
    const u = new URL(url); requests.push(u);
    return response(u.pathname.endsWith('fetch_multi_video_statistics') ? stats(u.searchParams.get('aweme_ids').split(',')) : detail(u.searchParams.get('aweme_id')));
  };
  const r = await api.syncTikhub();
  assert.equal(r.playsOk, 51); assert.equal(r.ok, 51);
  const batches = requests.filter(x => x.pathname.endsWith('fetch_multi_video_statistics'));
  assert.deepEqual(batches.map(x => x.searchParams.get('aweme_ids').split(',').length), [50,1]);
  assert.equal(f.get("SELECT count(*) n FROM metrics WHERE checkpoint='d7'").n, 0);
  assert.equal(f.get('SELECT count(*) n FROM bonuses').n, 0);
  assert.equal(f.get('SELECT count(*) n FROM metric_snapshots WHERE plays=1234').n, 51);
  assert.equal(f.get("SELECT comments FROM metrics WHERE checkpoint='live'").comments, 3);
  await api.syncTikhub(); assert.equal(requests.length, 53);
  await api.syncTikhub(true); assert.equal(requests.length, 104);
  assert.equal(requests.filter(x => x.pathname.endsWith('fetch_multi_video_statistics')).length, 2);
  await api.syncTikhub(true); assert.equal(requests.length, 104);
});
scenario('部分批次缺项只重试缺项，不把空值写成0，不复制旧播放到今天', async ({ f, video, api, day }) => {
  const first = video(1), second = video(2); let batches = 0; const queried = [];
  f.run("INSERT INTO metrics(video_id,checkpoint,platform,plays,updated_at) VALUES(?,'live','douyin',800,'2020-01-01 10:00:00')", second);
  global.fetch = async (url) => {
    const u = new URL(url);
    if (!u.pathname.endsWith('fetch_multi_video_statistics')) return response(detail(u.searchParams.get('aweme_id')));
    const ids = u.searchParams.get('aweme_ids').split(','); queried.push(ids); batches++;
    return response(stats(batches === 1 ? [idFor(1)] : ids));
  };
  await api.syncTikhub();
  assert.equal(f.get('SELECT plays FROM metric_snapshots WHERE video_id=? AND collected_date=?', second, day).plays, null);
  assert.equal(f.get("SELECT plays FROM metrics WHERE video_id=? AND checkpoint='live'", second).plays, 800);
  await api.syncTikhub(); assert.deepEqual(queried, [[idFor(1),idFor(2)],[idFor(2)]]);
  assert.equal(f.get('SELECT plays FROM metric_snapshots WHERE video_id=?', first).plays, 1234);
});
scenario('短链接首次解析ID并复用互动结果，后续使用缓存ID', async ({ f, video, api }) => {
  video(1, { douyin_url: 'https://v.douyin.com/test-link/' }); const paths=[];
  global.fetch = async (url) => {
    const u = new URL(url); paths.push(u.pathname);
    return response(u.pathname.endsWith('fetch_multi_video_statistics') ? stats([idFor(1)]) : detail(idFor(1)));
  };
  await api.syncTikhub(); assert.equal(paths.length, 2);
  assert.equal(f.get('SELECT item_id FROM platform_video_ids').item_id, idFor(1));
  f.run('DELETE FROM tikhub_attempts'); f.run('DELETE FROM metric_snapshots');
  await api.syncTikhub();
  assert.equal(paths.filter(x => x.endsWith('fetch_one_video_by_share_url')).length, 1);
});
scenario('失败每天最多两次且跨重启持久化，403停止整轮', async ({ f, video, api }) => {
  video(); let calls = 0;
  global.fetch = async () => { calls++; return new Response('{}', { status: 500 }); };
  await api.syncTikhub(); await api.syncTikhub(); await api.syncTikhub();
  assert.equal(calls, 4); // plays and interaction each at most two attempts
  assert.equal(f.get('SELECT count(*) n FROM metric_snapshots').n, 0);
  f.run('DELETE FROM tikhub_attempts'); video(2, { wechat_url: 'https://weixin.qq.com/sph/test' }); calls = 0;
  global.fetch = async () => { calls++; return new Response('{}', { status: 403 }); };
  await api.syncTikhub(); assert.equal(calls, 1);
});
scenario('每日总额度与批次额度包含失败请求，手动操作不能越过上限，0关闭', async ({ f, video, api }) => {
  for(let n=1;n<=51;n++) video(n);
  f.run("INSERT INTO settings(key,value) VALUES('tikhub_daily_play_batches','1'),('tikhub_daily_requests','2')");
  let calls = 0;
  global.fetch = async (url) => { calls++; const u=new URL(url); return response(stats(u.searchParams.get('aweme_ids').split(','))); };
  const r=await api.syncTikhub(); assert.equal(calls, 1); assert.equal(r.usage.playBatches, 1);
  await api.syncTikhub(true); assert.equal(calls, 1);
  f.run("UPDATE settings SET value='0' WHERE key='tikhub_daily_requests'");
  await api.syncTikhub(true); assert.equal(calls, 1);
});
scenario('手动与自动同步互斥，完成后释放锁', async ({ f, video, api }) => {
  video(); let release, entered;
  const started = new Promise(resolve => { entered=resolve; });
  global.fetch = async (url) => {
    const u=new URL(url);
    if(u.pathname.endsWith('fetch_multi_video_statistics')) { entered(); await new Promise(resolve => { release=resolve; }); return response(stats([idFor(1)])); }
    return response(detail(idFor(1)));
  };
  const first=api.syncTikhub(); await started;
  assert.match((await api.syncTikhub(true)).skipped, /正在进行/); release(); await first;
  assert.equal(f.get("SELECT value FROM settings WHERE key='tikhub_sync_lock'"), undefined);
});
scenario('仅正确日期/当前链接的节点快照可预填，人工保存后仍可修正，采集不覆盖人工值', async ({ f, day, published, video, api, snapshots }) => {
  const id=video(), url=`https://www.douyin.com/video/${idFor(1)}`;
  const save=(date, plays=100) => snapshots.saveMetricSnapshot({ video_id:id,platform:'douyin',collected_date:date,collected_at:date+' 10:00:00',published_at:published,publication_url:url,plays,likes:null,comments:null,collects:null,shares:null,source:'tikhub' });
  save('2020-01-01'); assert.equal(snapshots.checkpointSnapshot(id,'d7'),undefined);
  save(day,0); assert.equal(snapshots.checkpointSnapshot(id,'d7').plays,0);
  f.as(2); await f.load('@/app/(main)/videos/actions').saveMetrics(form({id,checkpoint:'d7',douyin_plays:0}));
  global.fetch=async(url) => { const u=new URL(url); return response(u.pathname.endsWith('fetch_multi_video_statistics')?stats([idFor(1)]):detail(idFor(1))); };
  await api.syncTikhub(); assert.equal(f.get("SELECT plays FROM metrics WHERE checkpoint='d7'").plays,0);
  f.run('UPDATE videos SET douyin_url=? WHERE id=?','https://www.douyin.com/video/'+idFor(2),id);
  assert.equal(snapshots.checkpointSnapshot(id,'d7'),undefined); assert.equal(snapshots.playHistory(id).length,0);
});
scenario('额度设置仅老板可修改，非法和负数被拒绝', async ({ f, api }) => {
  const action=f.load('@/app/(main)/settings/actions'); f.as(2);
  await assert.rejects(action.saveTikhubLimits(form({daily_requests:1,daily_play_batches:1})), /无权限/);
  f.as(1); await assert.rejects(action.saveTikhubLimits(form({daily_requests:-1,daily_play_batches:1})));
  await action.saveTikhubLimits(form({daily_requests:20,daily_play_batches:2}));
  assert.deepEqual(api.tikhubLimits(),{requests:20,playBatches:2});
});
