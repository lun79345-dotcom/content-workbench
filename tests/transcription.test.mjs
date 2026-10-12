import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {downloadVideo,boundedProcess} from '../scripts/transcribe-video.mjs';
test('转录下载每次重定向重新检查地址，大文件在落盘前拒绝',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'asr-test-')),original=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}});};
  await assert.rejects(downloadVideo('https://v3.douyinvod.com/video',path.join(dir,'one.mp4')));assert.equal(calls,1);
  globalThis.fetch=async()=>new Response('large',{headers:{'content-length':String(201*1024*1024)}});
  await assert.rejects(downloadVideo('https://v3.douyinvod.com/video',path.join(dir,'two.mp4')));assert.deepEqual(await fs.readdir(dir),[]);
 }finally{globalThis.fetch=original;await fs.rm(dir,{recursive:true,force:true});}
});
test('转录子进程取消后退出，不留下长期计算任务',async()=>{
 const controller=new AbortController();const task=boundedProcess(process.execPath,['-e','setInterval(()=>{},10000)'],{signal:controller.signal});controller.abort();await assert.rejects(task,/transcription/);
});
