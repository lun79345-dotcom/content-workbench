import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');
const schema = source.match(/const SCHEMA = `([\s\S]*?)`;/)?.[1];
if (!schema) throw new Error('Database schema not found');
const dir = resolve(process.env.DATA_DIR || 'data');
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(resolve(dir, 'app.db'));
db.exec('PRAGMA foreign_keys=ON;');
db.exec(schema);
const migrationSource = readFileSync(new URL('../src/lib/migrations.ts', import.meta.url), 'utf8');
const migrationCode = ts.transpileModule(migrationSource, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { migrate } = await import('data:text/javascript;base64,' + Buffer.from(migrationCode).toString('base64'));
migrate(db);
for (const table of ['users', 'accounts', 'videos', 'ideas', 'students', 'metrics', 'bonuses', 'reviews', 'weekly', 'settings', 'notifications', 'targets', 'stage_log', 'account_weekly', 'account_review_jobs', 'metric_snapshots', 'tikhub_requests', 'tikhub_attempts']) {
  if (db.prepare(`SELECT count(*) n FROM ${table}`).get().n) throw new Error('Refusing to overwrite an existing database. Use a separate empty DATA_DIR.');
}
const date = (n) => { const d = new Date(Date.now() + 8 * 60 * 60 * 1000); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
db.exec('BEGIN');
try {
  const people = [['老板演示', 'boss'], ['编导演示 A', 'editor'], ['编导演示 B', 'editor'], ['剪辑演示 A', 'cutter'], ['剪辑演示 B', 'cutter']];
  people.forEach(([name, role]) => db.prepare('INSERT INTO users(name,role) VALUES(?,?)').run(name, role));
  ['知识分享 · 示例','生活记录 · 示例','剧情创作 · 示例'].forEach((name, i) => db.prepare('INSERT INTO accounts(name,kind,new_since,editor_id,sort) VALUES(?,?,?,?,?)').run(name, i === 2 ? '剧情号' : '人设号', i === 2 ? date(-20) : null, i === 1 ? 3 : 2, i));
  db.prepare("INSERT INTO settings(key,value) VALUES('leader_id','2')").run();
  const stages = ['选题','脚本','脚本审核','拍摄','剪辑','成片审核','待发布','已发布'];
  const titles = ['如何整理一周灵感','三种常见的开场方式','把复杂问题讲明白','记录一次城市散步','一分钟讲清工作流程','人物访谈剪辑练习','轻量生活小技巧','示例：一次创作复盘'];
  stages.forEach((stage, i) => {
    db.prepare('INSERT INTO videos(code,title,account_id,editor_id,cutter_id,content_type,cut_level,extra_units,stage,due_script,due_shoot,due_rough,due_review,publish_date,published_at,brief,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      `V${String(i+1).padStart(3,'0')}`, titles[i], i%3+1, i%2 ? 3 : 2, i%2 ? 5 : 4, '演示内容','常规',0,stage,date(-2),date(0),date(1),date(2),date(3),i===7?date(-31):null,'虚构演示选题，用于体验流程；无真实客户或员工资料。',1);
  });
  [[3,'脚本审核',2,3],[6,'成片审核',5,3]].forEach(row => db.prepare('INSERT INTO reviews(video_id,node,submitter_id,reviewer_id) VALUES(?,?,?,?)').run(...row));
  for (const [cp, views] of [['d7',18000],['d30',40000]]) for (const platform of ['douyin','wechat']) db.prepare("INSERT INTO metrics(video_id,checkpoint,platform,plays,likes,comments,collects,shares,fans,source) VALUES(8,?,?,?,?,?,?,?,?, 'manual')").run(cp,platform,views,120,15,30,12,20);
  db.prepare('INSERT INTO targets(month,account_id,target_plays) VALUES(?,?,?)').run(date(0).slice(0,7),1,100000);
  db.prepare("INSERT INTO ideas(code,submitter_id,source,content,grade,status) VALUES('I001',2,'内部拆解','虚构创意：用日常场景解释一个小知识','A','入库')").run();
  db.prepare('INSERT INTO weekly(week,user_id,insight,next_plan) VALUES(?,?,?,?)').run('2026-W41',2,'演示复盘：先确认受众和一个明确主题。','演示计划：尝试两种开场并记录反馈。');
  for (const [id, age, title, views] of [[9,7,'示例：每日播放量核对',239800],[10,10,'示例：账号周复盘样本',52000]]) {
    const url = `https://example.invalid/demo/${id}`;
    db.prepare('INSERT INTO videos(id,code,title,account_id,editor_id,cutter_id,content_type,stage,published_at,douyin_url,brief,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,`V${String(id).padStart(3,'0')}`,title,1,2,4,'口播','已发布',date(-age),url,'全部数字与链接为虚构演示；非真实平台采集。',1);
    for (const [day, plays] of [[date(-1),views-12000],[date(0),views]]) db.prepare('INSERT INTO metric_snapshots(video_id,platform,collected_date,collected_at,published_at,publication_url,plays,likes,comments,collects,shares,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'douyin',day,day+' 10:00:00',date(-age),url,plays,200,30,50,20,'demo');
    if (age>7) db.prepare("INSERT INTO metrics(video_id,checkpoint,platform,plays,source) VALUES(?,'d7','douyin',?,'manual')").run(id,views);
  }
  db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }
db.close();
console.log(`Fictitious demo data created at ${dir}. No real credentials, employees or platform data.`);
