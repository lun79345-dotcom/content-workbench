import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, form } from './helpers.mjs';
const scenario = (name, fn) => test(name, async () => { const f = fixture(); try { await fn(f); } finally { f.close(); } });
const metric = (f, id, platform, plays) => f.run("INSERT INTO metrics(video_id,checkpoint,platform,plays) VALUES(?,'d7',?,?)", id, platform, plays);
const snapshot = { current: { videos: [{ id: 1 }] }, previous: { videos: [] }, performance: { videos: [{ id: 1 }] }, previous_performance: { videos: [] } };
const report = { overview: '数据有限', observations: [{ point: '本周发布一条', video_ids: [1] }], hypotheses: ['原因待验证'], actions: ['先补齐数据'], limits: ['没有完播率数据'] };

scenario('账号周统计限定账号和发布日期，成熟样本缺失不算零，未满7天不参与', (f) => {
  const a = f.load('@/lib/account-weekly');
  const published = { stage: '已发布', douyin_url: 'https://douyin.com/video/1', wechat_url: null };
  f.video({ ...published, published_at: '2026-10-06' });
  const zero = f.video({ ...published, published_at: '2026-09-28', brief: '私密需求SECRET', note: '内部备注SECRET' }); metric(f, zero, 'douyin', 0);
  const missing = f.video({ ...published, published_at: '2026-10-04', wechat_url: 'https://channels.weixin.qq.com/1' }); metric(f, missing, 'douyin', 1000);
  f.run("INSERT INTO accounts(id,name,kind) VALUES(2,'其他账号','剧情号')");
  f.video({ ...published, account_id: 2, published_at: '2026-10-06' });
  f.video({ stage: '待发布' }); f.video({ stage: '剪辑', archived_at: '2026-10-01' });
  const early = a.accountWeek(1, '2026-W41', '2026-10-06');
  assert.equal(early.current.published, 1); assert.equal(early.previous.published, 2);
  assert.equal(early.performance.eligible, 1); assert.equal(early.performance.complete, 1); assert.equal(early.performance.plays, 0);
  const full = a.accountWeek(1, '2026-W41', '2026-10-11');
  assert.equal(full.performance.eligible, 2); assert.equal(full.performance.missing, 1);
  assert.equal(full.performance.average_plays, 0); assert.equal(full.performance.videos.find(v => v.id === missing).total_plays_d7, null);
  assert.equal(full.reserve, 1);
  assert.equal(full.data_cutoff, '2026-10-11'); assert.equal(full.is_complete_week, false);
  const historical = a.accountWeek(1, '2026-W41', '2026-10-12');
  assert.equal(historical.data_cutoff, '2026-10-11'); assert.equal(historical.is_complete_week, true);
  assert.doesNotMatch(JSON.stringify(full), /SECRET|editor_id|cutter_id|https:\/\/|feishu|bonus_snapshot/);
  assert.equal(a.accountWeek(999, '2026-W41'), null);
});

scenario('只发小红书作品不会虚构抖音/视频号播放，零播放不算爆款', (f) => {
  const id = f.video({ stage: '已发布', published_at: '2026-09-28', douyin_url: null, wechat_url: null, xhs_url: 'https://xiaohongshu.com/explore/1' });
  f.run("INSERT INTO metrics(video_id,checkpoint,platform,likes,collects) VALUES(?,'d7','xhs',20,5)", id);
  const s = f.load('@/lib/account-weekly').accountWeek(1, '2026-W41', '2026-10-11');
  assert.equal(s.performance.eligible, 1); assert.equal(s.performance.applicable, 0); assert.equal(s.performance.plays, null); assert.equal(s.performance.hits, 0);
  assert.equal(s.performance.videos[0].xhs_likes, 20);
});

scenario('账号复盘权限限定老板和负责编导，旧版本不能覆盖新复盘', async (f) => {
  f.run('UPDATE accounts SET editor_id=2 WHERE id=1');
  const a = f.load('@/app/(main)/weekly/account-actions'), fd = form({ account_id: 1, week: '2026-W41', revision: 0, summary: '第一版' });
  f.as(3); assert.match((await a.saveAccountReviewForm(fd)).error, /负责编导/);
  f.as(5); assert.match((await a.saveAccountReviewForm(fd)).error, /负责编导/);
  f.as(2); assert.equal((await a.saveAccountReviewForm(fd)).ok, true);
  assert.match((await a.saveAccountReviewForm(fd)).error, /更新/);
  assert.equal(f.get('SELECT summary,revision FROM account_weekly').summary, '第一版');
  f.as(1); assert.equal((await a.saveAccountReviewForm(form({ account_id: 1, week: '2026-W41', revision: 1, summary: '老板补充' }))).ok, true);
  assert.equal(f.get('SELECT revision FROM account_weekly').revision, 2);
});

scenario('账号更换负责编导后旧负责人不能继续改账号复盘，未分配账号可由实际编导填写', (f) => {
  f.video({ editor_id: 2 }); f.run('UPDATE accounts SET editor_id=5 WHERE id=1');
  const a = f.load('@/lib/account-weekly'), account = f.get('SELECT * FROM accounts WHERE id=1');
  assert.equal(a.canReviewAccount({ id: 2, role: 'editor' }, account), false);
  assert.equal(a.canReviewAccount({ id: 5, role: 'editor' }, account), true);
  f.run('UPDATE accounts SET editor_id=NULL WHERE id=1');
  assert.equal(a.canReviewAccount({ id: 2, role: 'editor' }, f.get('SELECT * FROM accounts WHERE id=1')), true);
});

scenario('AI任务需要在线服务，重复生成去重，AI结果不覆盖人工复盘', async (f) => {
  const a = f.load('@/app/(main)/weekly/account-actions'), q = f.load('@/lib/account-review-queue');
  const fd = form({ account_id: 1, week: '2026-W41' });
  assert.match((await a.generateAccountReviewForm(fd)).error, /连接/);
  q.heartbeatReviewWorker(f.d); assert.equal((await a.generateAccountReviewForm(fd)).ok, true);
  assert.match((await a.generateAccountReviewForm(fd)).error, /生成/);
  const job = q.claimAccountReview(f.d);
  f.run("INSERT INTO account_weekly(account_id,week,summary,updated_by) VALUES(1,'2026-W41','人工结论',1)");
  assert.equal(q.finishAccountReview(f.d, job.id, job.lease, { ...report, observations: [] }), true);
  assert.equal(f.get('SELECT summary FROM account_weekly').summary, '人工结论');
  assert.match((await a.generateAccountReviewForm(fd)).error, /已经生成/);
});

scenario('任务互斥和租约保护，断开后可恢复，过期结果不能写入', (f) => {
  const q = f.load('@/lib/account-review-queue'), now = Date.now();
  f.run("INSERT INTO account_review_jobs(account_id,week,requested_by,input_json,input_hash) VALUES(1,'2026-W41',1,?,'hash')", JSON.stringify(snapshot));
  const job = q.claimAccountReview(f.d, now);
  assert.equal(q.claimAccountReview(f.d, now), null);
  assert.equal(q.finishAccountReview(f.d, job.id, 'wrong', report, now), false);
  assert.equal(q.finishAccountReview(f.d, job.id, job.lease, report, now + 7 * 60000), false);
  q.claimAccountReview(f.d, now + 7 * 60000);
  assert.equal(f.get('SELECT status FROM account_review_jobs').status, 'failed');
  assert.equal(q.finishAccountReview(f.d, job.id, job.lease, report, now), false);
});

scenario('AI格式和作品引用在服务端校验，故障详情不会泄露到页面', (f) => {
  const q = f.load('@/lib/account-review-queue');
  f.run("INSERT INTO account_review_jobs(account_id,week,requested_by,input_json,input_hash) VALUES(1,'2026-W41',1,?,'hash')", JSON.stringify(snapshot));
  const job = q.claimAccountReview(f.d);
  assert.throws(() => q.finishAccountReview(f.d, job.id, job.lease, { ...report, observations: [{ point: '伪造作品', video_ids: [999] }] }), /不存在/);
  assert.equal(f.get('SELECT status FROM account_review_jobs').status, 'running');
  assert.equal(q.failAccountReview(f.d, job.id, job.lease, 'sensitive token SECRET'), true);
  assert.doesNotMatch(f.get('SELECT error FROM account_review_jobs').error, /SECRET|token/);
  assert.equal(q.failAccountReview(f.d, job.id, job.lease, 'auth'), false);
});

scenario('损坏的任务标记失败，不会阻塞后续账号；过期或未来心跳不算在线', (f) => {
  const q = f.load('@/lib/account-review-queue'), a = f.load('@/lib/account-weekly');
  f.run("INSERT INTO account_review_jobs(account_id,week,requested_by,input_json,input_hash) VALUES(1,'2026-W41',1,'broken','hash')");
  assert.equal(q.claimAccountReview(f.d), null);
  assert.equal(f.get('SELECT status FROM account_review_jobs').status, 'failed');
  assert.equal(a.workerOnline(), true);
  q.heartbeatReviewWorker(f.d, Date.now() - 100000); assert.equal(a.workerOnline(), false);
  q.heartbeatReviewWorker(f.d, Date.now() + 100000); assert.equal(a.workerOnline(), false);
});
