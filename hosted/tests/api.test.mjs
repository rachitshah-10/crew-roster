import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handleApi} from '../lib/api.mjs';
import {parseUpload} from '../lib/parse-upload.mjs';
function database(){
 const db=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+file,'utf8'));
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
 let queue=Promise.resolve();
 return {prepare,raw:db,batch(statements){const task=queue.then(async()=>{db.exec('BEGIN');try{const results=[];for(const st of statements)results.push(await st.run());db.exec('COMMIT');return results}catch(e){db.exec('ROLLBACK');throw e}});queue=task.catch(()=>{});return task},close:()=>db.close()};
}
function client(db){let cookie='',csrf='';return {async request(path,method='GET',body,headers={}){const init={method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,...headers}};if(body){if(body instanceof FormData)init.body=body;else{init.body=JSON.stringify(body);init.headers['Content-Type']='application/json'}}const r=await handleApi(new Request('https://demo.test'+path,init),db);if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const json=await r.json();if(json.csrf)csrf=json.csrf;return {status:r.status,json}},async login(role){const r=await this.request('/api/auth/login','POST',{role});assert.equal(r.status,200,JSON.stringify(r));return r},async upload(name='sample_roster',ext='csv'){const form=new FormData();form.set('file',new File([readFileSync(`public/samples/${name}.${ext}`)],`${name}.${ext}`));return this.request('/api/uploads','POST',form)}}}
test('separate browsers share team checks and policies while sessions and roles stay independent',async()=>{
 const db=database(),scheduler=client(db),manager=client(db);
 assert.equal((await scheduler.request('/api/runs')).status,401);
 const a=await scheduler.login('scheduler'),b=await manager.login('manager');
 assert.equal(a.json.mode,'shared-demo');assert.notEqual(a.json.csrf,b.json.csrf);
 const own=await scheduler.request('/api/runs');assert.equal(own.json.total,1);
 assert.equal((await manager.request('/api/runs')).json.total,2);
 assert.equal((await manager.request('/api/runs/'+own.json.items[0].id)).status,200);
 const managerSeed=(await manager.request('/api/runs')).json.items.find(r=>r.id!==own.json.items[0].id);
 assert.equal((await scheduler.request('/api/runs/'+managerSeed.id)).status,404);
 assert.equal((await scheduler.request('/api/audit')).status,403);
 assert.equal((await scheduler.request('/api/auth/logout','POST',undefined,{'X-CSRF-Token':b.json.csrf})).status,403);
 const upload=await scheduler.upload();assert.equal(upload.status,201);assert.equal(upload.json.row_count,6);
 const change={name:'Shared comparison',expected_version:1,max_duty_hours:16,min_rest_hours:8,certification_at:'start',reason:'Compare an alternate illustrative policy'};
 assert.equal((await manager.request('/api/rules','POST',change)).status,200);
 assert.equal((await manager.request('/api/rules','POST',change)).status,409);
 assert.equal((await scheduler.request('/api/rules')).json.version,2);
 const old=await scheduler.request('/api/uploads/'+upload.json.id+'/check','POST');assert.equal(old.status,200);assert.equal(old.json.summary.findings,3);assert.equal(old.json.rules.version,1);
 assert.deepEqual((await manager.request('/api/runs/'+old.json.id)).json,old.json);
 const again=await manager.request('/api/uploads/'+upload.json.id+'/check','POST');assert.equal(again.json.id,old.json.id);
 const fresh=await scheduler.upload('sample_roster','xlsx');const next=await scheduler.request('/api/uploads/'+fresh.json.id+'/check','POST');assert.equal(next.json.rules.version,2);assert.equal(next.json.summary.findings,1);
 assert.equal((await manager.request('/api/rules','POST',{...change,expected_version:2,max_duty_hours:18,reason:'Third version preserves earlier checks'})).status,200);
 assert.deepEqual((await manager.request('/api/runs/'+old.json.id)).json,old.json);
 const historical=(await manager.request('/api/runs')).json.items.find(r=>r.id===old.json.id);assert.deepEqual(historical.rules,old.json.rules);
 const events=await manager.request('/api/audit');assert.equal(events.json.items.filter(e=>e.action==='rules.version_created').length,2);assert.equal(events.json.items.filter(e=>e.action==='roster.checked').length,2);
 await scheduler.request('/api/auth/logout','POST');assert.equal((await scheduler.request('/api/runs')).status,401);
 assert.equal((await manager.request('/api/auth/me')).json.role,'manager');
 const anotherBrowser=client(db);await anotherBrowser.login('scheduler');assert.deepEqual((await anotherBrowser.request('/api/runs/'+old.json.id)).json,old.json);
 await anotherBrowser.login('manager');assert.equal((await manager.request('/api/auth/me')).json.role,'manager');
 assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM demo_workspaces').get().n,1);
 db.close();
});
test('concurrent first visits seed one shared workspace, expired sessions do not remove history',async()=>{
 const db=database(),browsers=Array.from({length:5},()=>client(db));await Promise.all(browsers.map(c=>c.login('manager')));
 assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM demo_workspaces').get().n,1);
 assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM demo_runs').get().n,2);
 const old=(await browsers[0].request('/api/runs')).json;
 db.raw.exec("UPDATE demo_sessions SET expires_at='2000-01-01T00:00:00Z'");
 assert.equal((await browsers[0].request('/api/runs')).status,401);
 const fresh=client(db);await fresh.login('manager');assert.deepEqual((await fresh.request('/api/runs')).json,old);
 db.close();
});
test('legacy private workspaces remain intact and are not exposed through shared sessions',async()=>{
 const db=database();db.raw.prepare('INSERT INTO demo_workspaces VALUES (?,?,?,?,?,?,?,?)').run('legacy-private','old-token','2026-01-01','2099-01-01','manager','old-csrf',17,0);
 db.raw.prepare('INSERT INTO demo_runs VALUES (?,?,?,?,?,?,?)').run('111111111111111111111111','old-upload','legacy-private','scheduler','old.csv','2026-01-01','{"private":true}');
 const c=client(db);await c.login('manager');assert.equal((await c.request('/api/runs')).json.total,2);
 assert.equal((await c.request('/api/runs/111111111111111111111111')).status,404);
 assert.equal(db.raw.prepare("SELECT result_json FROM demo_runs WHERE workspace_id='legacy-private'").get().result_json,'{"private":true}');
 assert.equal(db.raw.prepare("SELECT active_version FROM demo_workspaces WHERE id='legacy-private'").get().active_version,17);
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
test('concurrent managers cannot overwrite rules and concurrent check requests save one audit event',async()=>{
 const db=database(),a=client(db),b=client(db);await a.login('manager');await b.login('manager');
 const body={expected_version:1,name:'Concurrent policy',reason:'Verify shared optimistic updates',max_duty_hours:12,min_rest_hours:10,certification_at:'end'};
 const changes=await Promise.all([a.request('/api/rules','POST',body),b.request('/api/rules','POST',body)]);
 assert.deepEqual(changes.map(r=>r.status).sort(),[200,409]);
 const upload=await a.upload();const checks=await Promise.all([a.request('/api/uploads/'+upload.json.id+'/check','POST'),b.request('/api/uploads/'+upload.json.id+'/check','POST')]);
 assert.equal(checks[0].status,200);assert.equal(checks[1].status,200);assert.equal(checks[0].json.id,checks[1].json.id);
 const audit=(await b.request('/api/audit')).json.items;
 assert.equal(audit.filter(e=>e.action==='roster.checked').length,1);assert.equal(audit.filter(e=>e.action==='rules.version_created').length,1);
 db.close();
});
