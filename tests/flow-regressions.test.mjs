import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, form, videoForm } from './helpers.mjs';
const scenario = (name, fn) => test(name, async () => { const f = fixture(); try { await fn(f); } finally { f.close(); } });

scenario('重复下一步不会跳过脚本或剪辑，旧页面不能覆盖新版需求', async (f) => {
  const a = f.load('@/app/(main)/videos/actions'), id = f.video({ stage: '选题', brief: '旧需求' }); f.as(2);
  const next = videoForm(f, { id });
  await a.advance(next);
  await assert.rejects(a.advance(next), /更新|刷新/);
  assert.equal(f.get('SELECT stage FROM videos').stage, '脚本');
  assert.equal(f.get('SELECT count(*) n FROM reviews').n, 0);
  const stale = videoForm(f, { id, brief: '旧页面修改' });
  await a.updateVideo(videoForm(f, { id, brief: '新需求' }));
  await assert.rejects(a.updateVideo(stale), /更新|刷新/);
  assert.equal(f.get('SELECT brief FROM videos').brief, '新需求');
});

scenario('换剪辑后旧申请可以拒绝，新剪辑能够重新申请', async (f) => {
  const id = f.video(), a = f.load('@/app/(main)/videos/actions'); f.as(3);
  await a.requestWorkload(form({ id, cut_level: '精剪', extra_units: 1, reason: '增加包装' }));
  const rid = f.get('SELECT id FROM workload_requests').id;
  f.as(2); await a.updateVideo(videoForm(f, { id, cutter_id: 4 }));
  await assert.rejects(a.decideWorkload(form({ request_id: rid, decision: 'approve' })), /归属/);
  await a.decideWorkload(form({ request_id: rid, decision: 'reject', comment: '已换负责人，请重新申请' }));
  f.as(4); await a.requestWorkload(form({ id, cut_level: '常规', extra_units: 0.5, reason: '重新确认' }));
  assert.equal(f.get("SELECT count(*) n FROM workload_requests WHERE status='pending'").n, 1);
});

scenario('待审期间改核心需求撤回旧审核，备注修改不撤回', async (f) => {
  const id = f.video({ stage: '脚本', brief: '原脚本' }), a = f.load('@/app/(main)/videos/actions'); f.as(2);
  await a.advance(videoForm(f, { id }));
  const rid = f.get('SELECT id FROM reviews').id;
  await a.updateVideo(videoForm(f, { id, note: '补充沟通备注' }));
  assert.equal(f.get('SELECT status FROM reviews').status, '待审');
  await a.updateVideo(videoForm(f, { id, brief: '全新脚本' }));
  assert.equal(f.get('SELECT stage FROM videos').stage, '脚本');
  assert.equal(f.get('SELECT status FROM reviews').status, '已撤回');
  f.as(5); await assert.rejects(a.decideReview(form({ review_id: rid, decision: 'pass' })), /已完成/);
});

scenario('待发布改核心需求后必须重新成片审核，首次计件保留', async (f) => {
  const id = f.video({ brief: '原需求' }), a = f.load('@/app/(main)/videos/actions'); f.as(3);
  await a.advance(videoForm(f, { id }));
  f.as(2); await a.decideReview(form({ review_id: f.get('SELECT id FROM reviews').id, decision: 'pass' }));
  const stalePublish = videoForm(f, { id, published_at: '2026-01-01', douyin_url: 'https://douyin.com/video/1' });
  await a.updateVideo(videoForm(f, { id, brief: '改版新需求' }));
  assert.equal(f.get('SELECT stage FROM videos').stage, '剪辑');
  await assert.rejects(a.publishVideo(stalePublish), /负责人|刷新|更新/);
  await a.advance(videoForm(f, { id }));
  assert.equal(f.get('SELECT count(*) n FROM work_deliveries').n, 1);
});

scenario('编导停用后老板仍可管理历史需求并代审新提交', async (f) => {
  const id = f.video(), a = f.load('@/app/(main)/videos/actions');
  await f.load('@/app/(main)/settings/actions').saveUser(form({ id: 2, name: '编导', role: 'disabled' }));
  await a.updateVideo(videoForm(f, { id, note: '老板接手处理' }));
  f.as(3); await a.advance(videoForm(f, { id }));
  assert.equal(f.get('SELECT reviewer_id FROM reviews').reviewer_id, 1);
  f.as(1); await a.decideReview(form({ review_id: f.get('SELECT id FROM reviews').id, decision: 'pass' }));
  assert.equal(f.get('SELECT stage FROM videos').stage, '待发布');
});

scenario('停用剪辑不能成为新的素材接收人，既有交付允许老板代提交返工', async (f) => {
  const id = f.video({ stage: '拍摄' }), a = f.load('@/app/(main)/videos/actions');
  await f.load('@/app/(main)/settings/actions').saveUser(form({ id: 3, name: '剪辑', role: 'disabled' }));
  await assert.rejects(a.advance(videoForm(f, { id })), /有效|启用/);
  assert.equal(f.get('SELECT stage FROM videos').stage, '拍摄');
});

scenario('已交付的旧定档停用后返工可重提，件数不变', async (f) => {
  const id = f.video({ cut_level: '精剪' }), a = f.load('@/app/(main)/videos/actions'); f.as(3);
  await a.advance(videoForm(f, { id }));
  f.as(2); await a.decideReview(form({ review_id: f.get('SELECT id FROM reviews').id, decision: 'reject', reason: '剪辑责任-音画问题', comment: '调整音量' }));
  const rules = f.load('@/lib/rules'); rules.saveRules({ ...rules.getRules(), cut_levels: { 常规: 1 } });
  await a.updateVideo(videoForm(f, { id, note: '补充说明' }));
  f.as(3); await a.advance(videoForm(f, { id }));
  assert.equal(f.get('SELECT base_units FROM work_deliveries').base_units, 1.5);
  assert.equal(f.get('SELECT count(*) n FROM reviews').n, 2);
});

scenario('新规则不能移除尚未首次交付的视频正在使用的档位', async (f) => {
  f.video({ cut_level: '精剪' });
  const action = f.load('@/app/(main)/settings/actions');
  await assert.rejects(action.saveRulesAction(form({ tier_0: 10, tier_1: 50, tier_2: 100, amount_0: 200, amount_1: 500, amount_2: 1000, new_discount: 0.7, new_months: 2, editor_share: 60, target_growth: 1.3, cut_levels: '常规=1' })), /交付|使用/);
  assert.equal(f.get("SELECT value FROM settings WHERE key='rules'"), undefined);
});

scenario('单平台发布按实际发布平台定档，未发布平台不要求虚填零', async (f) => {
  const id = f.video({ stage: '已发布', published_at: '2026-01-01', douyin_url: 'https://douyin.com/video/1' }); f.as(2);
  await f.load('@/app/(main)/videos/actions').saveMetrics(form({ id, checkpoint: 'd7', douyin_plays: 100000 }));
  assert.equal(f.load('@/lib/rules').combinedPlays(id, 'd7').complete, true);
  assert.equal(f.get('SELECT sum(amount) total FROM bonuses').total, 200);
});

scenario('只发小红书不产生抖音视频号数据待办或自动爆款奖', async (f) => {
  const id = f.video({ stage: '已发布', published_at: '2026-01-01', xhs_url: 'https://xiaohongshu.com/explore/example' }); f.as(2);
  const rules = f.load('@/lib/rules');
  assert.equal(rules.needsMetrics(id, 'd30'), false);
  assert.equal(rules.needsMetrics(id, 'd7'), true);
  await f.load('@/app/(main)/videos/actions').saveMetrics(form({ id, checkpoint: 'd7', xhs_likes: 1000, xhs_collects: 100 }));
  assert.equal(rules.needsMetrics(id, 'd7'), false);
  assert.equal(f.get('SELECT count(*) n FROM bonuses').n, 0);
});

scenario('月汇总爆款仅计完整数据，并使用已公示视频的冻结规则', (f) => {
  const id = f.video({ stage: '已发布', published_at: '2026-01-01' });
  const rules = f.load('@/lib/rules'), stats = f.load('@/lib/stats');
  f.run("INSERT INTO metrics(video_id,checkpoint,platform,plays) VALUES(?,'d7','douyin',100000)", id);
  assert.equal(stats.accountMonthly('2026-01')[0].hits, 0);
  f.run("INSERT INTO metrics(video_id,checkpoint,platform,plays) VALUES(?,'d7','wechat',0)", id);
  rules.freezeBonusBasis(id); rules.saveRules({ ...rules.getRules(), tiers: [500000,1000000,2000000] });
  assert.equal(stats.accountMonthly('2026-01')[0].hits, 1);
});

scenario('奖金按分拆分，奇数或带小数的总奖金额不会因各自取整而多发', (f) => {
  const id = f.video({ stage: '已发布', published_at: '2026-01-01' }), rules = f.load('@/lib/rules');
  for (const p of ['douyin','wechat']) f.run("INSERT INTO metrics(video_id,checkpoint,platform,plays) VALUES(?,'d7',?,50000)", id, p);
  rules.saveRules({ ...rules.getRules(), editor_share: 0.5, tier_amounts: [201,501,1001] }); rules.recalcVideoBonus(id);
  assert.equal(f.get('SELECT sum(amount) total FROM bonuses').total, 201);
  assert.equal(f.get('SELECT amount FROM bonuses WHERE user_id=2').amount, 100.5);
  rules.saveRules({ ...rules.getRules(), editor_share: 0.6, tier_amounts: [200.01,500.01,1000.01] }); rules.recalcVideoBonus(id);
  assert.equal(Math.round(f.get('SELECT sum(amount) total FROM bonuses').total * 100), 20001);
  assert.equal(f.get('SELECT amount FROM bonuses WHERE user_id=2').amount, 120.01);
});

scenario('创意库所有可见类型都能正常投递，排期后不允许手动倒退状态', async (f) => {
  const ideas = f.load('@/app/(main)/ideas/actions'); f.as(3);
  for (const kind of ['选题','钩子','梗/台词','形式','BGM/包装']) await ideas.submitIdea(form({ content: `${kind}测试`, kind, source: '内部拆解' }));
  assert.equal(f.get('SELECT count(*) n FROM ideas').n, 5);
  f.as(2); const id = f.video({ stage: '拍摄' });
  f.run("UPDATE ideas SET status='已排期',video_id=? WHERE id=1", id);
  await assert.rejects(ideas.gradeIdea(form({ id: 1, grade: 'A', status: '入库' })), /流程|排期/);
  assert.equal(f.get('SELECT status FROM ideas WHERE id=1').status, '已排期');
});

scenario('审核逾期负责人取实际审核人，不把组长自审误记为组长拖期', (f) => {
  const id = f.video({ editor_id: 5, stage: '脚本审核' });
  f.run("INSERT INTO reviews(video_id,node,reviewer_id) VALUES(?,'脚本审核',1)", id);
  assert.equal(f.load('@/lib/rules').stageOwner(f.load('@/lib/queries').getVideo(id), 5), 1);
});
