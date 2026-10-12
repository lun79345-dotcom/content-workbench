import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './helpers.mjs';
const sec = 'MS4wLjABAAAA00000000000000000000000000';
test('账号查询使用新播放批量接口，按精确ID匹配，缺失不作0，24小时缓存不再付费', async () => {
  let calls = 0;
  const f = fixture({ mocks: { './tikhub': { call: async (_method, path, params) => {
    calls++;
    if (path.includes('fetch_user_post')) return { has_more: '0', aweme_list: [
      { aweme_id: '12345678901234567', author: { sec_uid: sec, nickname: '测试账号' }, create_time: Math.floor(Date.now()/1000), desc: '作品1', video: { play_addr: {url_list:['https://v.douyinvod.com/video']}, duration: 10000 } },
      { aweme_id: '12345678901234568', author: { sec_uid: sec }, create_time: Math.floor(Date.now()/1000), desc: '作品2', video: { play_addr: {url_list:['https://v.douyinvod.com/video']} } },
      { aweme_id: '12345678901234569', author: { sec_uid: 'other' }, create_time: Math.floor(Date.now()/1000), video: { play_addr: {url_list:[]} } },
    ] };
    assert.equal(params.aweme_ids, '12345678901234567,12345678901234568');
    return { statistics_list: [{ aweme_id: '12345678901234567', play_count: 485 }] };
  } } } });
  try {
    const b = f.load('@/lib/benchmark'), link = `https://www.douyin.com/user/${sec}`;
    const id = await b.queryBenchmark(link, 1), videos = b.benchmarkVideos(id);
    assert.equal(videos.length, 2); assert.equal(videos[0].plays, 485);assert.equal(videos[1].plays, null);assert.equal(calls, 2);
    assert.equal(b.benchmarkRun(id).truncated, 0);
    assert.equal(await b.queryBenchmark(link, 2), id);assert.equal(calls, 2);
    assert.throws(()=>b.accountLink('https://evil.example/user/test'), /抖音/);
  } finally { f.close(); }
});
test('AI任务互斥，陈旧租约不能回填，凭空引用会被拒绝，坏任务不阻塞队列', () => {
  const f=fixture();try {
    const q=f.load('@/lib/ai-queue'), input={kind:'hit_analysis',title:'示例',caption:'示例',aweme_id:'12345678901234567',transcript:'今天公司突然放假了。',plays:485};
    f.run("INSERT INTO ai_jobs(kind,source_key,requested_by,input_json,input_hash) VALUES('hit_analysis','bad',1,'invalid','bad')");
    assert.equal(q.claimAiJob(f.d),null);assert.equal(f.get("SELECT status FROM ai_jobs WHERE source_key='bad'").status,'failed');
    f.run("INSERT INTO ai_jobs(kind,source_key,requested_by,input_json,input_hash) VALUES('hit_analysis','one',1,?,'one')",JSON.stringify(input));
    const job=q.claimAiJob(f.d);assert.equal(q.claimAiJob(f.d),null);
    const report={title:'结构',summary:'结论',draft:'原创提纲',sections:[{title:'开场',evidence:'今天公司突然放假了。',analysis:'制造意外'}],actions:['验证选题'],limits:['仅文字分析']};
    assert.equal(q.finishAiJob(f.d,job.id,'wrong',report),false);
    assert.throws(()=>q.finishAiJob(f.d,job.id,job.lease,{...report,sections:[{title:'开场',evidence:'不存在的对白',analysis:'虚构'}]}),/evidence/);
    assert.equal(q.finishAiJob(f.d,job.id,job.lease,report),true);
    assert.equal(q.finishAiJob(f.d,job.id,job.lease,report),false);
  } finally {f.close();}
});
test('下载仅允许受信视频域名，拒绝内网、凭证和非HTTPS地址', () => {
  const f=fixture();try{
    const {safeMediaUrl}=f.load('@/lib/media-source');
    assert.match(safeMediaUrl('https://v3.douyinvod.com/video'),/^https:/);
    for(const url of ['http://v3.douyinvod.com/video','https://127.0.0.1/test','https://name:pass@v3.douyinvod.com/test','https://douyinvod.com.evil.example/test','https://v3.douyinvod.com:8080/test'])assert.throws(()=>safeMediaUrl(url));
  }finally{f.close();}
});
test('服务器只领取转录，本机只领取文字；转录过期或旧租约不能跨阶段回填', () => {
  const f=fixture();try {
    const q=f.load('@/lib/ai-queue'),input={kind:'hit_analysis',title:'测试',caption:'测试',aweme_id:'12345678901234567',media_url:'https://v3.douyinvod.com/video',plays:123};
    f.run("INSERT INTO ai_jobs(kind,source_key,requested_by,input_json,input_hash) VALUES('hit_analysis','media',1,?,'hash')",JSON.stringify(input));
    assert.equal(q.claimAiJob(f.d),null);
    const asr=q.claimTranscription(f.d); assert.ok(asr);assert.equal(q.claimTranscription(f.d),null);assert.equal(q.claimAiJob(f.d),null);
    assert.equal(q.finishTranscription(f.d,asr.id,'wrong','今天放假'),false);
    assert.throws(()=>q.finishTranscription(f.d,asr.id,asr.lease,''),/transcript/);
    assert.equal(q.finishTranscription(f.d,asr.id,asr.lease,'今天放假'),true);
    assert.equal(q.finishTranscription(f.d,asr.id,asr.lease,'覆盖原文'),false);
    assert.equal(q.claimTranscription(f.d),null);
    const job=q.claimAiJob(f.d); assert.equal(job.input.transcript,'今天放假');assert.notEqual(job.lease,asr.lease);
    const report={title:'测试',summary:'文字结构',draft:'原创',sections:[{title:'开场',evidence:'今天放假',analysis:'意外'}],actions:[],limits:['仅文字分析']};
    assert.equal(q.finishAiJob(f.d,job.id,asr.lease,report),false);
    assert.equal(q.finishAiJob(f.d,job.id,job.lease,report,Date.now()+7*60000),false);
    assert.equal(q.finishAiJob(f.d,job.id,job.lease,report),true);
    assert.equal(f.get('SELECT transcript FROM ai_jobs WHERE id=?',job.id).transcript,'今天放假');
  }finally{f.close();}
});
