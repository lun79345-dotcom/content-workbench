import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, form, videoForm } from './helpers.mjs';
const scenario = (name, fn) => test(name, async () => { const f = fixture(); try { await fn(f); } finally { f.close(); } });
scenario('首次飞书登录：同名老板仍待审批，不绑定预设账号', (f) => {
  f.run("INSERT INTO users(name,role) VALUES('同名老板','boss')");
  process.env.BOSS_FEISHU_NAMES = '同名老板';
  const identity = f.load('@/lib/identity');
  const result = identity.identifyFeishu({ open_id: 'new-open-id', name: '同名老板' });
  assert.equal(f.get('SELECT role FROM users WHERE id=?', result.id).role, 'pending');
  assert.equal(f.get("SELECT count(*) n FROM users WHERE name='同名老板'").n, 2);
  assert.equal(identity.identifyFeishu({ open_id: 'new-open-id', name: '另一个名称' }).id, result.id);
});
scenario('无关剪辑不能登记数据、代审批或自行发布', async (f) => {
  const id = f.video({ stage: '已发布', published_at: '2026-01-01' }); f.as(4);
  const a = f.load('@/app/(main)/videos/actions');
  await assert.rejects(a.saveMetrics(form({ id, checkpoint: 'd7', douyin_plays: 100000 })), /只有/);
  await assert.rejects(a.publishVideo(videoForm(f, { id, published_at: '2026-01-01', douyin_url: 'https://douyin.com/video/1' })), /负责人/);
  await assert.rejects(a.setRecheck(form({ review_id: 1, recheck: '免责' })), /仅老板/);
  assert.equal(f.get('SELECT count(*) n FROM metrics').n, 0);
});
scenario('指定剪辑只能推进剪辑阶段；不能绕过审核发布或编辑考核字段', async (f) => {
  const id = f.video({ stage: '脚本' }); f.as(3); const a = f.load('@/app/(main)/videos/actions');
  await assert.rejects(a.advance(videoForm(f, { id })), /无推进权限/);
  await assert.rejects(a.updateVideo(videoForm(f, { id, extra_units: 100 })), /需要编导/);
  await assert.rejects(a.publishVideo(videoForm(f, { id, published_at: '2026-01-01', douyin_url: 'https://douyin.com/video/1' })), /负责人/);
  assert.equal(f.get('SELECT stage,extra_units FROM videos WHERE id=?', id).stage, '脚本');
});
scenario('编导代交成片记到剪辑，重复提交不重复计件', async (f) => {
  const id = f.video({ cut_level: '精剪', extra_units: 0.5 }); f.as(2); const a = f.load('@/app/(main)/videos/actions');
  await a.advance(videoForm(f, { id }));
  const delivery = f.get('SELECT * FROM work_deliveries WHERE video_id=?', id);
  assert.equal(delivery.cutter_id, 3); assert.equal(delivery.base_units + delivery.extra_units, 2);
  await assert.rejects(a.advance(videoForm(f, { id })), /待审记录/);
  await a.decideReview(form({ review_id: f.get('SELECT id FROM reviews').id, decision: 'reject', reason: '剪辑责任-错别字/字幕', comment: '字幕错误' }));
  f.as(3); await a.advance(videoForm(f, { id }));
  assert.equal(f.get('SELECT count(*) n FROM work_deliveries').n, 1);
  assert.equal(f.get('SELECT count(*) n FROM reviews').n, 2);
});
scenario('工作量调整申请审批前不生效，确认后保留审计', async (f) => {
  const id = f.video(); f.as(3); const a = f.load('@/app/(main)/videos/actions');
  await a.advance(videoForm(f, { id }));
  await a.requestWorkload(form({ id, cut_level: '精剪', extra_units: 1, due_rough: '2026-10-13', reason: '新增两个改版' }));
  assert.equal(f.get('SELECT extra_units FROM work_deliveries').extra_units, 0);
  f.as(2); await a.decideWorkload(form({ request_id: f.get('SELECT id FROM workload_requests').id, decision: 'approve' }));
  assert.equal(f.get('SELECT base_units+extra_units units FROM work_deliveries').units, 2.5);
  assert.equal(f.get("SELECT count(*) n FROM audit_log WHERE action='确认工作量调整'").n, 1);
});
scenario('冻结期实际改需求才免责，普通保存不产生免责', async (f) => {
  const { today } = f.load('@/lib/rules'); const id = f.video({ publish_date: today(), title: '原标题', brief: '原需求' }); f.as(2);
  const a = f.load('@/app/(main)/videos/actions');
  await a.updateVideo(videoForm(f, { id, title: '原标题', brief: '原需求' }));
  assert.equal(f.get('SELECT late_exempt_reason FROM videos').late_exempt_reason, null);
  await a.updateVideo(videoForm(f, { id, brief: '新需求' }));
  assert.match(f.get('SELECT late_exempt_reason FROM videos').late_exempt_reason, /冻结/);
});
scenario('手动阶段只能回退，发布必须经过待发布阶段', async (f) => {
  const id = f.video(); f.as(2); const a = f.load('@/app/(main)/videos/actions');
  await assert.rejects(a.setStage(videoForm(f, { id, stage: '已发布', reason: '跳过' })), /仅允许回退/);
  await a.setStage(videoForm(f, { id, stage: '拍摄', reason: '补拍素材' }));
  assert.equal(f.get('SELECT stage FROM videos').stage, '拍摄');
  await assert.rejects(a.publishVideo(videoForm(f, { id, published_at: '2026-01-01', douyin_url: 'https://douyin.com/video/1' })), /负责人/);
  f.run("UPDATE videos SET stage='待发布' WHERE id=?", id);
  await a.publishVideo(videoForm(f, { id, published_at: '2026-01-01', douyin_url: 'https://douyin.com/video/1' }));
  assert.equal(f.get('SELECT stage FROM videos').stage, '已发布');
});
scenario('数据节点、负数、非整数和未来日期被拒绝，事务不写入部分数据', async (f) => {
  const id = f.video({ stage: '已发布', published_at: '2026-01-01' }); f.as(2); const a = f.load('@/app/(main)/videos/actions');
  for (const fields of [{ checkpoint: 'd1', douyin_plays: 1 }, { checkpoint: 'd7', douyin_plays: -1 }, { checkpoint: 'd7', douyin_plays: 'NaN' }, { checkpoint: 'd7', douyin_plays: 1.5 }, { checkpoint: 'd7', douyin_plays: 10, wechat_plays: -1 }]) await assert.rejects(a.saveMetrics(form({ id, ...fields })));
  assert.equal(f.get('SELECT count(*) n FROM metrics').n, 0);
});
scenario('归档保留公示奖金、数据、审核与交付记录', async (f) => {
  const id = f.video({ stage: '已发布', published_at: '2026-01-01' });
  f.run("INSERT INTO bonuses(month,user_id,kind,amount,video_id,published) VALUES('2026-01',3,'爆款奖',80,?,1)", id);
  f.run("INSERT INTO metrics(video_id,checkpoint,platform,plays) VALUES(?,'d7','douyin',100000)", id);
  const { recordDelivery } = f.load('@/lib/workload'); recordDelivery(f.load('@/lib/queries').getVideo(id));
  const a = f.load('@/app/(main)/videos/actions');
  await assert.rejects(a.deleteVideo(form({ id })), /redirect:/);
  assert.ok(f.get('SELECT archived_at FROM videos').archived_at);
  assert.equal(f.get('SELECT count(*) n FROM bonuses').n, 1); assert.equal(f.get('SELECT count(*) n FROM work_deliveries').n, 1);
  assert.equal(f.load('@/lib/queries').listVideos().length, 0);
  assert.throws(() => f.run('DELETE FROM bonuses'), /不可删除/);
});
scenario('最后一位可登录老板不可停用，未绑定占位老板不能替代', async (f) => {
  process.env.FEISHU_APP_ID = 'test'; process.env.FEISHU_APP_SECRET = 'test';
  f.run("INSERT INTO users(name,role) VALUES('占位老板','boss')");
  const actions = f.load('@/app/(main)/settings/actions');
  await assert.rejects(actions.saveUser(form({ id: 1, name: '老板', role: 'disabled' })), /至少需要保留/);
  await assert.rejects(actions.saveUser(form({ id: 3, name: '剪辑', role: 'administrator' })), /无效/);
  f.run("UPDATE users SET role='disabled' WHERE id=5");
  await assert.rejects(actions.saveLeader(form({ leader_id: 5 })), /有效|可登录/);
});
scenario('无效规则被拒绝，原规则和奖金不改变', async (f) => {
  const actions = f.load('@/app/(main)/settings/actions');
  await assert.rejects(actions.saveRulesAction(form({ tier_0: 10, tier_1: 5, tier_2: 100, amount_0: 200, amount_1: 500, amount_2: 1000, new_discount: 0.7, new_months: 2, editor_share: 60, target_growth: 1.3, cut_levels: '常规=1' })), /严格递增/);
  assert.equal(f.get("SELECT value FROM settings WHERE key='rules'"), undefined);
});
scenario('审核失败时不推进阶段；无关编导不可复核', async (f) => {
  const id = f.video({ stage: '成片审核' });
  f.run("INSERT INTO reviews(video_id,node,submitter_id,reviewer_id) VALUES(?,'成片审核',3,2)", id);
  const a = f.load('@/app/(main)/videos/actions'); f.as(2);
  await assert.rejects(a.decideReview(form({ review_id: 1, decision: 'reject', reason: '剪辑责任-错别字/字幕' })), /comment/);
  assert.equal(f.get('SELECT status FROM reviews').status, '待审');
  await assert.rejects(a.setRecheck(form({ review_id: 1, recheck: '免责' })), /仅老板/);
});
