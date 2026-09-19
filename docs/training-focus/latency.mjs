const output = process.argv[2];
if (!output) throw new Error('Pass an output JSON path. See README.md.');
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const focuses=['balanced','stamina','sprint'];
function one(focus) {
 return new Promise((resolve,reject)=>{
  const start=performance.now();
  const child=fork(new URL('./latency-worker.mjs', import.meta.url),[focus],{stdio:['ignore','inherit','inherit','ipc']});
  let message;
  child.on('message',value=>message=value);
  child.on('error',reject);
  child.on('exit',code=>code===0&&message?resolve({...message,wallMs:performance.now()-start}):reject(new Error(`worker exited ${code}`)));
 });
}
let start=performance.now();
const sequential=[];
for(const f of focuses) sequential.push(await one(f));
const sequentialWallMs=performance.now()-start;
start=performance.now();
const parallel=await Promise.all(focuses.map(one));
const parallelWallMs=performance.now()-start;
for(let i=0;i<3;i++) {
 for(const key of ['key','score','selection','stats','probability']) assert.deepEqual(sequential[i].result[key],parallel[i].result[key]);
}
const out={case:201,sequentialWallMs,parallelWallMs,singleMeanWallMs:sequentialWallMs/3,parallelRatioToSingle:parallelWallMs/(sequentialWallMs/3),sequential,parallel};
writeFileSync(output,JSON.stringify(out,null,2));
console.log(JSON.stringify({sequentialWallMs,parallelWallMs,parallelRatioToSingle:out.parallelRatioToSingle,exactResults:true}));
