import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, form, videoForm } from './helpers.mjs';
const scenario = (name, fn) => test(name, async () => { const f = fixture(); try { await fn(f); } finally { f.close(); } });

scenario('编导简化创建自动归属本人，不猜测截止日期和剪辑', async (f) => {
  f.as(2);
  await assert.rejects(f.load('@/app/(main)/videos/actions').createVideo(form({ title: '最少填写', account_id: 1 })), /redirect:/);
  const v = f.get('SELECT * FROM videos');
  assert.equal(v.editor_id, 2); assert.equal(v.cutter_id, null); assert.equal(v.cut_level, '常规'); assert.equal(v.extra_units, 0);
  for (const field of ['due_script', 'due_shoot', 'due_rough', 'due_review', 'publish_date']) assert.equal(v[field], null);
});

scenario('老板代建使用账号已配置的有效编导，未配置或停用时要求选择', async (f) => {
  const a = f.load('@/app/(main)/videos/actions');
  assert.match((await a.createVideoForm(form({ title: '未配置', account_id: 1 }))).error, /编导/);
  f.run('UPDATE accounts SET editor_id=2 WHERE id=1');
  await assert.rejects(a.createVideo(form({ title: '已配置', account_id: 1 })), /redirect:/);
  assert.equal(f.get('SELECT * FROM videos').editor_id, 2);
  f.run("UPDATE users SET role='disabled' WHERE id=2");
  assert.match((await a.createVideoForm(form({ title: '停用负责人', account_id: 1 }))).error, /编导/);
  assert.equal(f.get('SELECT count(*) n FROM videos').n, 1);
});

scenario('自动带入不允许编导把需求单归给别人，默认档位适配现有规则', async (f) => {
  const rules = f.load('@/lib/rules'); rules.saveRules({ ...rules.getRules(), cut_levels: { 定制: 2 } });
  f.as(2); const a = f.load('@/app/(main)/videos/actions');
  assert.match((await a.createVideoForm(form({ title: '错误归属', account_id: 1, editor_id: 5 }))).error, /自己负责/);
  await assert.rejects(a.createVideo(form({ title: '新规则', account_id: 1 })), /redirect:/);
  assert.equal(f.get('SELECT * FROM videos').cut_level, '定制');
});

scenario('分享文案识别三个平台、去重，域名伪装不会自动归类', (f) => {
  const parse = f.load('@/lib/publication-input').parsePublicationText;
  const result = parse('复制打开： https://v.douyin.com/abc/， https://v.douyin.com/abc/\n视频号 https://channels.weixin.qq.com/video/123。小红书 https://xhslink.com/a/xyz!');
  assert.deepEqual(result.links, { douyin: ['https://v.douyin.com/abc/'], wechat: ['https://channels.weixin.qq.com/video/123'], xhs: ['https://xhslink.com/a/xyz'] });
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(parse('https://www.douyin.com.attacker.test/video/1').unknown, ['https://www.douyin.com.attacker.test/video/1']);
  assert.equal(parse('https://example.test/?next=https://douyin.com/video/1').links.douyin.length, 0);
  assert.equal(parse('http://[').invalid.length, 1);
});

scenario('仅粘贴分享文案即可登记多平台发布，保留日期和正常流转', async (f) => {
  const id = f.video({ stage: '待发布' }), a = f.load('@/app/(main)/videos/actions');
  const result = await a.publishVideoForm(videoForm(f, { id, published_at: '2026-01-01', publish_text: '作品 https://www.douyin.com/video/123\nhttps://channels.weixin.qq.com/video/456' }));
  assert.equal(result.ok, true);
  const v = f.get('SELECT * FROM videos');
  assert.equal(v.stage, '已发布'); assert.equal(v.published_at, '2026-01-01');
  assert.equal(v.douyin_url, 'https://www.douyin.com/video/123'); assert.equal(v.wechat_url, 'https://channels.weixin.qq.com/video/456'); assert.equal(v.xhs_url, null);
  assert.equal(f.get('SELECT count(*) n FROM stage_log').n, 1);
});

scenario('同平台多个发布链接必须明确选择，不会静默取第一条', async (f) => {
  const id = f.video({ stage: '待发布' }), a = f.load('@/app/(main)/videos/actions');
  const values = { id, published_at: '2026-01-01', publish_text: 'https://douyin.com/video/1 https://douyin.com/video/2' };
  assert.match((await a.publishVideoForm(videoForm(f, values))).error, /多个链接/);
  assert.equal(f.get('SELECT stage FROM videos').stage, '待发布');
  assert.equal((await a.publishVideoForm(videoForm(f, { ...values, douyin_url: 'https://douyin.com/video/2' }))).ok, true);
  assert.equal(f.get('SELECT douyin_url FROM videos').douyin_url, 'https://douyin.com/video/2');
});

scenario('无法识别的平台需手动指定，未知和损坏的链接不会悄悄丢失', async (f) => {
  const id = f.video({ stage: '待发布' }), a = f.load('@/app/(main)/videos/actions');
  const values = { id, published_at: '2026-01-01', publish_text: 'https://douyin.com/video/1 https://short.example.test/video/2' };
  assert.match((await a.publishVideoForm(videoForm(f, values))).error, /无法识别/);
  assert.match((await a.publishVideoForm(videoForm(f, { ...values, publish_text: 'https://douyin.com/video/1 http://[' }))).error, /格式不正确/);
  assert.equal((await a.publishVideoForm(videoForm(f, { ...values, wechat_url: 'https://short.example.test/video/2' }))).ok, true);
  assert.equal(f.get('SELECT wechat_url FROM videos').wechat_url, 'https://short.example.test/video/2');
});

scenario('手动阶段日期仍保留并校验，简化表单不绕过顺序校验', async (f) => {
  f.as(2); const a = f.load('@/app/(main)/videos/actions');
  const fields = { title: '手动排期', account_id: 1, due_script: '2026-10-15', due_shoot: '2026-10-14', publish_date: '2026-10-20' };
  assert.match((await a.createVideoForm(form(fields))).error, /拍摄截止.*脚本截止/);
  await assert.rejects(a.createVideo(form({ ...fields, due_shoot: '2026-10-16' })), /redirect:/);
  const v = f.get('SELECT * FROM videos'); assert.equal(v.due_script, '2026-10-15'); assert.equal(v.due_shoot, '2026-10-16'); assert.equal(v.publish_date, '2026-10-20');
});
