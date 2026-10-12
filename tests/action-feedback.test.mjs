import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, form, videoForm } from './helpers.mjs';
const scenario = (name, fn) => test(name, async () => { const f = fixture(); try { await fn(f); } finally { f.close(); } });

scenario('日期倒序在原表单返回具体中文提示，没有写入新视频', async (f) => {
  const result = await f.load('@/app/(main)/videos/actions').createVideoForm(form({ title: '日期倒序', account_id: 1, editor_id: 2, cutter_id: 3, cut_level: '常规', due_script: '2026-10-15', due_shoot: '2026-10-14' }));
  assert.match(result.error, /拍摄截止.*2026-10-14.*脚本截止.*2026-10-15/);
  assert.equal(f.get('SELECT count(*) n FROM videos').n, 0);
});

scenario('缺发布链接返回表单提示，视频保持待发布', async (f) => {
  const id = f.video({ stage: '待发布' });
  const result = await f.load('@/app/(main)/videos/actions').publishVideoForm(videoForm(f, { id, published_at: '2026-01-01' }));
  assert.match(result.error, /至少一个平台/);
  assert.equal(f.get('SELECT stage FROM videos').stage, '待发布');
  assert.equal(f.get('SELECT published_at FROM videos').published_at, null);
});

scenario('未知故障不会作为业务提示返回，成功创建的重定向不被吞掉', async (f) => {
  const { actionResult } = f.load('@/lib/action-errors');
  await assert.rejects(actionResult(async () => { throw new Error('internal-only'); }), /internal-only/);
  await assert.rejects(f.load('@/app/(main)/videos/actions').createVideoForm(form({ title: '正常创建', account_id: 1, editor_id: 2, cutter_id: 3, cut_level: '常规' })), /redirect:/);
  assert.equal(f.get('SELECT count(*) n FROM videos').n, 1);
});

scenario('保留历史档位的加件申请可确认，超过两位小数的奖金被拒绝', async (f) => {
  const id = f.video({ cut_level: '精剪' }), a = f.load('@/app/(main)/videos/actions'); f.as(3);
  await a.advance(videoForm(f, { id }));
  const rules = f.load('@/lib/rules'); rules.saveRules({ ...rules.getRules(), cut_levels: { 常规: 1 } });
  await a.requestWorkload(form({ id, cut_level: '精剪', extra_units: 0.5, reason: '新增版式' }));
  f.as(2); await a.decideWorkload(form({ request_id: f.get('SELECT id FROM workload_requests').id, decision: 'approve' }));
  assert.equal(f.get('SELECT base_units+extra_units units FROM work_deliveries').units, 2);
  f.as(1);
  const result = await f.load('@/app/(main)/bonus/actions').addBonusForm(form({ month: '2026-10', user_id: 3, kind: '其他', amount: 1.001, description: '小数验证' }));
  assert.match(result.error, /两位小数/);
  assert.equal(f.get('SELECT count(*) n FROM bonuses').n, 0);
});

scenario('旧公示快照保留双平台口径，新增快照冻结实际发布平台', (f) => {
  const rules = f.load('@/lib/rules'), stats = f.load('@/lib/stats');
  const id = f.video({ stage: '已发布', published_at: '2026-01-01', douyin_url: 'https://douyin.com/video/1' });
  for (const p of ['douyin','wechat']) f.run("INSERT INTO metrics(video_id,checkpoint,platform,plays) VALUES(?,'d7',?,50000)", id, p);
  const basis = { editor_id: 2, cutter_id: 3, rules: rules.getRules(), new_since: null };
  f.run('UPDATE videos SET bonus_snapshot=? WHERE id=?', JSON.stringify(basis), id);
  rules.recalcVideoBonus(id); assert.equal(f.get('SELECT sum(amount) total FROM bonuses').total, 200);
  assert.equal(stats.accountMonthly('2026-01')[0].hits, 1);
  f.run("INSERT INTO metrics(video_id,checkpoint,platform,plays) VALUES(?,'d30','douyin',100000)", id);
  assert.equal(rules.needsMetrics(id, 'd30'), true);
  const second = f.video({ stage: '已发布', published_at: '2026-01-01', douyin_url: 'https://douyin.com/video/2' });
  rules.freezeBonusBasis(second);
  assert.deepEqual(JSON.parse(f.get('SELECT bonus_snapshot FROM videos WHERE id=?', second).bonus_snapshot).platforms, ['douyin']);
});

scenario('选题到奖金公示再更正归档：审核、计件、账目完整衔接', async (f) => {
  const ideaActions = f.load('@/app/(main)/ideas/actions'), a = f.load('@/app/(main)/videos/actions'), bonusActions = f.load('@/app/(main)/bonus/actions');
  f.as(3); await ideaActions.submitIdea(form({ content: '全流程测试', kind: '形式', source: '内部拆解' }));
  f.as(2); await ideaActions.gradeIdea(form({ id: 1, grade: 'A', status: '入库' }));
  await assert.rejects(a.createVideo(form({ title: '全流程测试', account_id: 1, editor_id: 2, cutter_id: 3, cut_level: '常规', extra_units: 0.5, idea_id: 1, due_script: '2026-01-01', due_shoot: '2026-01-02', due_rough: '2026-01-03', due_review: '2026-01-04', publish_date: '2026-01-05', brief: '初始脚本' })), /redirect:/);
  const id = f.get('SELECT id FROM videos').id;
  await a.advance(videoForm(f, { id })); await a.advance(videoForm(f, { id }));
  f.as(5); await a.decideReview(form({ review_id: 1, decision: 'reject', reason: '编导责任-脚本问题', comment: '补充结尾' }));
  assert.equal(f.get('SELECT count(*) n FROM work_deliveries').n, 0);
  f.as(2); await a.updateVideo(videoForm(f, { id, brief: '补充结尾后的脚本' })); await a.advance(videoForm(f, { id }));
  f.as(5); await a.decideReview(form({ review_id: 2, decision: 'pass' }));
  f.as(2); await a.advance(videoForm(f, { id }));
  f.as(3); await a.advance(videoForm(f, { id }));
  f.as(2); await a.decideReview(form({ review_id: 3, decision: 'pass' }));
  await a.publishVideo(videoForm(f, { id, published_at: '2026-01-05', douyin_url: 'https://douyin.com/video/1', wechat_url: 'https://weixin.qq.com/sph/1' }));
  assert.equal(f.get('SELECT status FROM ideas').status, '已拍');
  assert.equal(f.get('SELECT base_units+extra_units units FROM work_deliveries').units, 1.5);
  await a.saveMetrics(form({ id, checkpoint: 'd7', douyin_plays: 60000, wechat_plays: 40000 }));
  f.as(1); await bonusActions.publishMonth(form({ month: '2026-01' }));
  const confirmed = f.all('SELECT * FROM bonuses WHERE published=1');
  f.as(2); await a.saveMetrics(form({ id, checkpoint: 'd30', douyin_plays: 300000, wechat_plays: 200000 }));
  assert.equal(f.get('SELECT sum(amount) total FROM bonuses').total, 500);
  await a.saveMetrics(form({ id, checkpoint: 'd7', douyin_plays: 300000, wechat_plays: 200000 }));
  assert.equal(f.get('SELECT sum(amount) total FROM bonuses').total, 500);
  assert.deepEqual(f.all('SELECT * FROM bonuses WHERE published=1'), confirmed);
  f.as(1); await assert.rejects(a.deleteVideo(form({ id })), /redirect:/);
  assert.equal(f.get('SELECT count(*) n FROM reviews').n, 3);
  assert.equal(f.get('SELECT count(*) n FROM work_deliveries').n, 1);
  assert.equal(f.get('SELECT sum(amount) total FROM bonuses').total, 500);
  assert.deepEqual(f.all('PRAGMA foreign_key_check'), []);
});
