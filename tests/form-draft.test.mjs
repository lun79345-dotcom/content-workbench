import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftKey, decodeDraft, DRAFT_TTL, draftCreationSucceeded } from '../src/lib/form-draft.ts';
test('草稿隔离登录人、账号和周次，不恢复过期、损坏或未知字段', () => {
  const now = Date.now(), defaults = { title: '', brief: '' };
  const encode = (x = {}) => JSON.stringify({ version: '3', fields: { title: '脚本', brief: '内容', admin: 'true' }, savedAt: now, ...x });
  assert.notEqual(draftKey(1, 'new'), draftKey(2, 'new'));
  assert.notEqual(draftKey(1, 'account-review:1:W42'), draftKey(1, 'account-review:2:W42'));
  assert.deepEqual(decodeDraft(encode(), defaults, now).fields, { title: '脚本', brief: '内容' });
  assert.equal(decodeDraft(encode({ savedAt: now - DRAFT_TTL - 1 }), defaults, now), null);
  assert.equal(decodeDraft(encode({ savedAt: now + 61000 }), defaults, now), null);
  assert.equal(decodeDraft('invalid', defaults, now), null);
  assert.equal(decodeDraft(encode({ fields: { title: 1, brief: '' } }), defaults, now), null);
  assert.equal(decodeDraft(encode({ fields: { title: 'x'.repeat(10001), brief: '' } }), defaults, now), null);
  assert.equal(decodeDraft(encode(), defaults, now).version, '3');
});
test('创建成功才清草稿，登录过期、异常和外站跳转都保留输入', () => {
  const key = draftKey(1, 'new-video:blank:any'), origin = 'https://example.com';
  assert.equal(draftCreationSucceeded(key, 'NEXT_REDIRECT;replace;/yunying/videos/12;307;', origin), true);
  for (const digest of ['NEXT_REDIRECT;replace;/login;307;', 'NEXT_REDIRECT;replace;https://other.example/videos/12;307;', 'NEXT_NOT_FOUND', null])
    assert.equal(draftCreationSucceeded(key, digest, origin), false);
  assert.equal(draftCreationSucceeded(draftKey(1,'account-review:1:W42'), 'NEXT_REDIRECT;replace;/videos/12;307;', origin), false);
});
