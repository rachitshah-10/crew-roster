import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handleApi} from '../lib/api.mjs';
import {parseUpload} from '../lib/parse-upload.mjs';
function database(){
 const db=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')))db.exec(readFileSync('drizzle/'+file,'utf8'));
 const prepare=q=>({
  bind(...args){
   return {
    q,args,
    async first(){return db.prepare(q).get(...args)||null},
    async all(){return {results:db.prepare(q).all(...args)}},
    async run(){const r=db.prepare(q).run(...args);return {meta:{changes:Number(r.changes)}}}
   };
  }
 });
 return {prepare,async batch(statements){db.exec('BEGIN');try{const results=[];for(const st of statements)results.push(await st.run());db.exec('COMMIT');return results}catch(e){db.exec('ROLLBACK');throw e}},close:()=>db.close()};
}
function client(db){let cookie='',csrf='';return {async request(path,method='GET',body,headers={}){const init={method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,...headers}};if(body){if(body instanceof FormData)init.body=body;else{init.body=JSON.stringify(body);init.headers['Content-Type']='application/json'}}const r=await handleApi(new Request('https://demo.test'+path,init),db);if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const json=await r.json();if(json.csrf)csrf=json.csrf;return {status:r.status,json}},async login(role){const r=await this.request('/api/auth/login','POST',{role});assert.equal(r.status,200,JSON.stringify(r));return r},async upload(name='sample_roster',ext='csv'){const form=new FormData();form.set('file',new File([readFileSync(`public/samples/${name}.${ext}`)],`${name}.${ext}`));return this.request('/api/uploads','POST',form)}}}
test('isolated visitor workspaces, roles, seeded history, uploads and immutable versions',async()=>{
 const db=database(),a=client(db),b=client(db);
 assert.equal((await a.request('/api/runs')).status,401);await a.login('scheduler');await b.login('manager');
 const own=await a.request('/api/runs');assert.equal(own.json.total,1);assert.equal(own.json.items[0].summary.findings,6);
 assert.equal((await b.request('/api/runs')).json.total,2);
 assert.equal((await b.request('/api/runs/'+own.json.items[0].id)).status,404);
 assert.equal((await a.request('/api/audit')).status,403);
 const upload=await a.upload();assert.equal(upload.status,201);assert.equal(upload.json.row_count,6);
 const v1=upload.json.rules.version;
 await a.login('manager');assert.equal((await a.request('/api/runs')).json.total,2);
 const change={name:'Demo comparison',expected_version:v1,max_duty_hours:16,min_rest_hours:8,certification_at:'start',reason:'Compare an alternate illustrative policy'};
 assert.equal((await a.request('/api/rules','POST',change)).status,200);
 assert.equal((await a.request('/api/rules','POST',change)).status,409);
 const old=await a.request('/api/uploads/'+upload.json.id+'/check','POST');assert.equal(old.status,200);assert.equal(old.json.summary.findings,3);assert.equal(old.json.rules.version,1);
 const again=await a.request('/api/uploads/'+upload.json.id+'/check','POST');assert.equal(again.json.id,old.json.id);
 const fresh=await a.upload('sample_roster','xlsx');assert.equal(fresh.status,201);const next=await a.request('/api/uploads/'+fresh.json.id+'/check','POST');assert.equal(next.json.summary.findings,1);
 assert.equal(next.json.rules.version,2);
 const snapshot=JSON.parse(JSON.stringify(old.json));
 const v3=await a.request('/api/rules','POST',{...change,expected_version:2,max_duty_hours:18,reason:'Third version must not rewrite saved checks'});assert.equal(v3.status,200);
 const reopened=await a.request('/api/runs/'+old.json.id);assert.deepEqual(reopened.json,snapshot);
 const historical=(await a.request('/api/runs')).json.items.find(r=>r.id===old.json.id);assert.deepEqual(historical.rules,snapshot.rules);
 const events=await a.request('/api/audit');assert.equal(events.status,200);assert.equal(events.json.items.filter(e=>e.action==='rules.version_created').length,2);assert.equal(events.json.items.filter(e=>e.action==='roster.checked').length,2);
 await a.request('/api/auth/logout','POST');assert.equal((await a.request('/api/runs')).status,401);await a.login('scheduler');assert.equal((await a.request('/api/runs/'+next.json.id)).status,404);assert.equal((await a.request('/api/runs/'+old.json.id)).status,200);
 db.close();
});
test('CSRF, origin, invalid files, dates and thresholds',async()=>{
 const db=database(),c=client(db);await c.login('scheduler');
 assert.equal((await c.request('/api/auth/logout','POST',undefined,{'X-CSRF-Token':'bad'})).status,403);
 assert.equal((await c.request('/api/auth/logout','POST',undefined,{'Origin':'https://elsewhere.test'})).status,403);
 for(const ext of ['csv','xlsx'])assert.equal((await c.upload('input_errors',ext)).status,422);
 assert.equal((await c.request('/api/runs?from_date=2026-02-30')).status,422);
 assert.equal((await c.request('/api/runs?offset=-1')).status,422);
 assert.equal((await c.request('/api/rules','POST',{})).status,403);
 await c.login('manager');assert.equal((await c.request('/api/rules','POST',{expected_version:1,name:'Test',reason:'valid reason',max_duty_hours:0,min_rest_hours:10,certification_at:'end'})).status,422);
 assert.equal((await c.request('/api/runs')).json.total,2);db.close();
});
test('every valid Excel sample matches CSV; unsupported formats fail',()=>{
 for(const name of ['sample_roster','clean_roster','review_roster'])assert.deepEqual(parseUpload(name+'.csv',readFileSync(`public/samples/${name}.csv`)),parseUpload(name+'.xlsx',readFileSync(`public/samples/${name}.xlsx`)));
 assert.throws(()=>parseUpload('file.docx',new Uint8Array()));assert.throws(()=>parseUpload('file.xlsx',new Uint8Array([80,75,0])));
});
test('interactive import settings, mapped columns and more than 500 duties persist through history',async()=>{
 const db=database(),c=client(db);await c.login('scheduler');
 const headers=['Employee','Name','Role','Duty','Start','End','Notes'];
 const data=[headers.join(','),...Array.from({length:601},(_,i)=>`C${i},Fictional ${i},pilot,D${i},2026-11-09 06:00,2026-11-09 14:00,extra`)].join('\n');
 const form=new FormData();form.set('file',new File([data],'mapped.csv'));
 const setup=await c.request('/api/uploads','POST',form);assert.equal(setup.status,422);assert.equal(setup.json.import_options.needs_mapping,true);
 const mapping={crew_id:'Employee',crew_name:'Name',role:'Role',duty_id:'Duty',duty_start:'Start',duty_end:'End'};
 form.set('options',JSON.stringify({mapping}));const zone=await c.request('/api/uploads','POST',form);assert.equal(zone.json.import_options.needs_timezone,true);
 form.set('options',JSON.stringify({mapping,timezone:'America/New_York'}));const preview=await c.request('/api/uploads','POST',form);assert.equal(preview.status,201,JSON.stringify(preview));assert.equal(preview.json.row_count,601);assert.equal(preview.json.preview[0].duty_start,'2026-11-09T11:00:00Z');
 const run=await c.request('/api/uploads/'+preview.json.id+'/check','POST');assert.equal(run.status,200);assert.equal(run.json.summary.findings,601);assert.equal(run.json.rows[0].source_timezone,'America/New_York');
 await c.login('manager');const reopened=await c.request('/api/runs/'+run.json.id);assert.equal(reopened.json.summary.duties,601);
 const audit=await c.request('/api/audit');const upload=audit.json.items.find(e=>e.action==='roster.uploaded');assert.equal(JSON.parse(upload.details).import_settings.timezone,'America/New_York');
 db.close();
});
