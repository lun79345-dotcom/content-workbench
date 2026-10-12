import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture,form} from './helpers.mjs';
async function submitted(f,values){try{await f.load('@/app/(main)/ai/actions').generateAssistForm(form(values));assert.fail('expected redirect');}catch(e){assert.match(e.redirect||'',/^\/ai\?job=/);return Number(e.redirect.split('=').at(-1));}}
function online(f){f.run("INSERT INTO settings(key,value) VALUES('account_review_worker_seen',?)",new Date().toISOString());}
test('创意AI生成草稿去重，不创建视频；脚本检查需实际正文且限定负责人',async()=>{
 const f=fixture();try{
  online(f); f.run("INSERT INTO ideas(id,code,content,account_id) VALUES(1,'C1','上班迟到的反转',1)");
  f.as(2);const job=await submitted(f,{kind:'idea_brief',entity_id:1});assert.equal(await submitted(f,{kind:'idea_brief',entity_id:1}),job);assert.equal(f.get('SELECT count(*) n FROM videos').n,0);
  f.as(3);assert.match((await f.load('@/app/(main)/ai/actions').generateAssistForm(form({kind:'idea_brief',entity_id:1}))).error,/权限/);
  const v=f.video({stage:'脚本',brief:'必须拍电梯口的等候'});f.as(5);assert.match((await f.load('@/app/(main)/ai/actions').generateAssistForm(form({kind:'script_check',entity_id:v,script:'正文'}))).error,/权限/);
  f.as(2);assert.match((await f.load('@/app/(main)/ai/actions').generateAssistForm(form({kind:'script_check',entity_id:v,script:'https://docs.feishu.cn/test'}))).error,/实际脚本/);
  const check=await submitted(f,{kind:'script_check',entity_id:v,script:'开场：同事站在电梯口。'});assert.match(f.get('SELECT input_json FROM ai_jobs WHERE id=?',check).input_json,/必须拍电梯口/);
  assert.equal(f.get('SELECT stage FROM videos WHERE id=?',v).stage,'脚本');
 }finally{f.close();}
});
test('审核清单引用原打回记录，剪辑只能处理自己的视频，不修改原审核和工作量',async()=>{
 const f=fixture();try{
  online(f);const v=f.video();f.run("INSERT INTO reviews(video_id,node,status,reason,comment) VALUES(?,'成片审核','打回','剪辑责任-错别字','第2句字幕改为准时；原声保留')",v);
  f.as(4);assert.match((await f.load('@/app/(main)/ai/actions').generateAssistForm(form({kind:'review_changes',entity_id:v}))).error,/权限/);
  f.as(3);const id=await submitted(f,{kind:'review_changes',entity_id:v});const input=JSON.parse(f.get('SELECT input_json FROM ai_jobs WHERE id=?',id).input_json);assert.match(input.transcript,/原声保留/);assert.match(input.transcript,/剪辑责任-错别字/);
  assert.equal(f.get('SELECT status FROM reviews').status,'打回');assert.equal(f.get('SELECT extra_units FROM videos').extra_units,0);
  f.run("UPDATE videos SET archived_at='2026-10-12' WHERE id=?",v);assert.equal(f.load('@/lib/ai-assist').canAccessAiInput(f.state.me,input),false);
 }finally{f.close();}
});
test('异常检查不将缺失、小样本或平台改变视为播放下降；真实下降需双方至少3条',()=>{
 const f=fixture();try{
  const {detectAccountSignals,completedReviewWeek}=f.load('@/lib/account-anomalies');assert.equal(completedReviewWeek('2026-01-01'),'2025-W52');
  const videos=Array.from({length:3},()=>({plays_complete:true,platforms:['douyin']}));
  const s={is_complete_week:true,current:{published:2},previous:{published:6},performance:{complete:3,missing:0,average_plays:400,videos},previous_performance:{complete:3,missing:0,average_plays:1000,videos}};
  assert.deepEqual(detectAccountSignals(s).map(x=>x.key),['output','plays']);
  assert.equal(detectAccountSignals({...s,performance:{...s.performance,missing:1}}).some(x=>x.key==='plays'),false);
  assert.equal(detectAccountSignals({...s,performance:{...s.performance,complete:2}}).some(x=>x.key==='plays'),false);
  assert.equal(detectAccountSignals({...s,performance:{...s.performance,videos:videos.map(v=>({...v,platforms:['douyin','wechat']}))}}).some(x=>x.key==='plays'),false);
  assert.equal(detectAccountSignals({...s,is_complete_week:false}).some(x=>x.key==='output'),false);
 }finally{f.close();}
});
test('同账号同周异常提醒只留一条，AI解读权限跟随账号归属变化',async()=>{
 const f=fixture();try{
  online(f);f.run('UPDATE accounts SET editor_id=2 WHERE id=1');
  const a=f.load('@/lib/account-anomalies'),{weekRange,addDays}=f.load('@/lib/rules');const start=weekRange(a.completedReviewWeek())[0];
  f.video({stage:'已发布',published_at:addDays(start,-7),douyin_url:'https://www.douyin.com/video/12345678901234567'});
  await a.notifyAccountAnomalies();await a.notifyAccountAnomalies();assert.equal(f.get("SELECT count(*) n FROM notifications WHERE dedupe LIKE 'account-signal-%'").n,1);
  f.as(2);const id=await submitted(f,{kind:'account_anomaly',entity_id:1});const input=JSON.parse(f.get('SELECT input_json FROM ai_jobs WHERE id=?',id).input_json);assert.match(input.transcript,/缺少第7天数据/);
  f.run('UPDATE accounts SET editor_id=5 WHERE id=1');assert.equal(f.load('@/lib/ai-assist').canAccessAiInput(f.state.me,input),false);
 }finally{f.close();}
});
