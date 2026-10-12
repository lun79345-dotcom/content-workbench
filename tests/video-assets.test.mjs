import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, form, videoForm } from './helpers.mjs';
const scenario = (name, fn) => test(name, async () => { const f = fixture(); try { await fn(f); } finally { f.close(); } });
const assetForm = (f, id, kind, url = 'https://example.com/file') => videoForm(f, { id, kind, url, note: '测试交付' });

scenario('交付新增版本保留历史，旧页面不能覆盖新版本，未关联成员无权提交', async (f) => {
  const id = f.video({ stage: '剪辑' }), action = f.load('@/app/(main)/videos/actions');
  f.as(3); const old = assetForm(f, id, 'cut');
  await action.saveVideoAsset(old);
  await assert.rejects(action.saveVideoAsset(old), /更新|刷新/);
  await action.saveVideoAsset(assetForm(f, id, 'cut', 'https://example.com/v2'));
  assert.deepEqual(f.all('SELECT version FROM video_assets ORDER BY version').map(x => x.version), [1, 2]);
  f.as(4); await assert.rejects(action.saveVideoAsset(assetForm(f, id, 'cut')), /权限/);
  f.as(3); await assert.rejects(action.saveVideoAsset(assetForm(f, id, 'material')), /权限/);
  await assert.rejects(action.saveVideoAsset(assetForm(f, id, 'cut', 'https://name:secret@example.com')), /密码/);
  assert.equal(f.get('SELECT count(*) n FROM video_assets').n, 2);
});

scenario('脚本和成片审核绑定提交版本，待审时无法偷偷替换，返工保留旧审核链接', async (f) => {
  const id = f.video({ stage: '脚本' }), action = f.load('@/app/(main)/videos/actions'); f.as(2);
  await action.saveVideoAsset(assetForm(f, id, 'script'));
  await action.advance(videoForm(f, { id }));
  const scriptReview = f.get("SELECT id,asset_id_snapshot FROM reviews WHERE node='脚本审核'");
  assert.equal(scriptReview.asset_id_snapshot, f.get('SELECT id FROM video_assets').id);
  await assert.rejects(action.saveVideoAsset(assetForm(f, id, 'script')), /权限/);
  f.as(5); await action.decideReview(form({ review_id: scriptReview.id, decision: 'pass' }));
  f.as(2); await action.saveVideoAsset(assetForm(f, id, 'material')); await action.advance(videoForm(f, { id }));
  f.as(3); await action.saveVideoAsset(assetForm(f, id, 'cut')); await action.advance(videoForm(f, { id }));
  const cutReview = f.get("SELECT id,asset_id_snapshot FROM reviews WHERE node='成片审核'");
  const first = f.get("SELECT id FROM video_assets WHERE kind='cut'").id;
  assert.equal(cutReview.asset_id_snapshot, first);
  await assert.rejects(action.saveVideoAsset(assetForm(f, id, 'cut')), /权限/);
  f.as(2); await action.decideReview(form({ review_id: cutReview.id, decision: 'reject', reason: '剪辑责任-音画问题', comment: '02:14 修订音量' }));
  f.as(3); await action.saveVideoAsset(assetForm(f, id, 'cut', 'https://example.com/revised')); await action.advance(videoForm(f, { id }));
  assert.equal(f.get('SELECT asset_id_snapshot FROM reviews WHERE id=?', cutReview.id).asset_id_snapshot, first);
  assert.notEqual(f.get('SELECT asset_id_snapshot FROM reviews ORDER BY id DESC LIMIT 1').asset_id_snapshot, first);
  assert.equal(f.get('SELECT count(*) n FROM work_deliveries').n, 1);
});

scenario('交接链接是可选补充，旧需求可继续审核，发布和归档后交接历史只读', async (f) => {
  const id = f.video(), action = f.load('@/app/(main)/videos/actions'); f.as(3);
  await action.advance(videoForm(f, { id }));
  assert.equal(f.get('SELECT asset_id_snapshot FROM reviews').asset_id_snapshot, null);
  f.as(2); await action.decideReview(form({ review_id: f.get('SELECT id FROM reviews').id, decision: 'pass' }));
  await action.publishVideo(videoForm(f, { id, douyin_url: 'https://douyin.com/video/1', published_at: '2026-01-01' }));
  await assert.rejects(action.saveVideoAsset(assetForm(f, id, 'cut')), /权限/);
  f.as(1); await assert.rejects(action.deleteVideo(form({ id })), /redirect:/);
  await assert.rejects(action.saveVideoAsset(assetForm(f, id, 'cut')), /归档/);
});
