// Server only transcribes. Codex credentials and analysis stay on the operator's Mac.
import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { claimTranscription, finishTranscription, failAiJob } from '../.account-review-worker/ai-queue.mjs';
import { transcribeVideo } from './transcribe-video.mjs';
const config = JSON.parse(await fs.readFile(process.env.SERVER_ANALYSIS_CONFIG, 'utf8'));
const db = new DatabaseSync(config.dbFile); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
const set = (key, value) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
let stopping = false;
const controller = new AbortController();
const stop = () => { stopping = true; controller.abort(); }; process.on('SIGTERM',stop); process.on('SIGINT',stop);
const heartbeat = () => { set('transcription_worker_seen',new Date().toISOString()); };
const timer = setInterval(() => { try { heartbeat(); } catch {} },20000);
try {
  while (!stopping) {
    heartbeat();
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_jobs'").get()) {
      const job = claimTranscription(db);
      if (job) {
        try {
          const transcript = await transcribeVideo(job.input.media_url,config,controller.signal);
          const saved = finishTranscription(db,job.id,job.lease,transcript);
          process.stdout.write(`转录任务 ${job.id} ${saved?'已完成':'租约已失效'}\n`);
        } catch { failAiJob(db,job.id,job.lease,controller.signal.aborted?'stopped':'transcription'); process.stdout.write(`转录任务 ${job.id} 未完成\n`); }
        continue;
      }
    }
    await delay(10000, undefined, {signal:controller.signal}).catch(()=>{});
  }
} finally { clearInterval(timer); set('transcription_worker_seen','');db.close(); }
