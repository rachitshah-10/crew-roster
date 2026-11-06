import fixtures from './demo-fixtures.json' with {type:'json'};
import {DEFAULT_RULES,checkRoster,RosterError,MAX_BYTES} from './checker.mjs';
import {parseUpload} from './parse-upload.mjs';
const COOKIE='crewcheck_demo',DAYS=7,MAX_UPLOADS=30;
const id=()=>crypto.randomUUID().replaceAll('-','').slice(0,24);
const token=()=>crypto.randomUUID()+crypto.randomUUID();
const now=()=>new Date().toISOString();
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))).map(x=>x.toString(16).padStart(2,'0')).join('');
const names={scheduler:'Alex Morgan · Demo',manager:'Taylor Reed · Demo'};
class ApiError extends Error{constructor(status,message){super(message);this.status=status}}
const error=(status,message)=>{throw new ApiError(status,message)};
const response=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
const sql=(db,query,...args)=>db.prepare(query).bind(...args);
const first=(db,q,...args)=>sql(db,q,...args).first();
const all=async(db,q,...args)=>(await sql(db,q,...args).all()).results;
const cookieValue=request=>(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
const identity=w=>({id:w.id+':'+w.role,name:names[w.role],email:w.role+'@crewcheck.demo',role:w.role,csrf:w.csrf,mode:'isolated-demo',expires_at:w.expires_at});
const audit=(db,w,action,target,details={})=>sql(db,'INSERT INTO demo_audit_events VALUES (?,?,?,?,?,?,?)',id(),w.id,w.role||'visitor',action,target,now(),JSON.stringify(details));
async function readBody(request,limit){
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();const chunks=[];let total=0;
 while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>limit){await reader.cancel();error(413,'Request is too large.')}chunks.push(value)}
 const bytes=new Uint8Array(total);let p=0;for(const chunk of chunks){bytes.set(chunk,p);p+=chunk.length}return bytes;
}
async function getWorkspace(db,request){const value=cookieValue(request);if(!value||value.length>200)return null;return first(db,'SELECT * FROM demo_workspaces WHERE token_hash=? AND expires_at>?',await hash(value),now())}
async function getRule(db,w,version=w.active_version){const r=await first(db,'SELECT data FROM demo_rule_versions WHERE workspace_id=? AND version=?',w.id,version);if(!r)error(404,'Rule version not found.');return JSON.parse(r.data)}
async function newWorkspace(db,role){
 const raw=token(),w={id:id(),role,csrf:token(),created_at:now(),expires_at:new Date(Date.now()+DAYS*86400000).toISOString(),active_version:1};
 const policy={...DEFAULT_RULES,version:1,created_at:w.created_at,created_by:'Demo setup',reason:'Initial illustrative policy'};
 const commands=[sql(db,'INSERT INTO demo_workspaces VALUES (?,?,?,?,?,?,?,?)',w.id,await hash(raw),w.created_at,w.expires_at,w.role,w.csrf,1,0),sql(db,'INSERT INTO demo_rule_versions VALUES (?,?,?,?)',id(),w.id,1,JSON.stringify(policy))];
 // Fictional checks are copied into every visitor's isolated workspace.
 for(const [index,name] of ['review_roster','clean_roster'].entries()){
  const f=fixtures.find(x=>x.name===name),upload=id(),run=id(),ownerRole=index===0?'scheduler':'manager',created=new Date(Date.now()-(index+1)*3600000).toISOString();
  const digest=await hash(f.csv),result={...checkRoster(f.rows),id:run,created_at:created,filename:name+'.csv',owner:names[ownerRole],file_hash:digest,rules:policy};
  commands.push(sql(db,'INSERT INTO demo_uploads VALUES (?,?,?,?,?,?,?,?)',upload,w.id,ownerRole,name+'.csv',created,digest,1,JSON.stringify(f.rows)),sql(db,'INSERT INTO demo_runs VALUES (?,?,?,?,?,?,?)',run,upload,w.id,ownerRole,name+'.csv',created,JSON.stringify(result)));
 }
 commands.push(audit(db,w,'demo.created',w.id,{synthetic_seed_checks:2}));await db.batch(commands);
 return {w,raw};
}
export async function handleApi(request,db,settings={}){
 const configured=Number(settings.CREWCHECK_MAX_UPLOAD_BYTES);
 const maxBytes=Number.isSafeInteger(configured)&&configured>0?configured:MAX_BYTES;
 try{
  if(!db)error(503,'The demo database is not ready.');
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(method!=='GET'&&method!=='POST')error(405,'Method not supported.');
  if(method==='POST'){
   const origin=request.headers.get('origin');
   if(origin&&origin!==url.origin)error(403,'Cross-origin writes are not allowed.');
   if(request.headers.get('sec-fetch-site')==='cross-site')error(403,'Cross-site writes are not allowed.');
  }
  if(path==='/api/health')return response({status:'ok',mode:'hosted-demo',storage:'SQLite-based D1'});
  let w=await getWorkspace(db,request);
  if(path==='/api/auth/login'&&method==='POST'){
   let body;try{body=JSON.parse(new TextDecoder().decode(await readBody(request,4096)))}catch(e){if(e instanceof ApiError)throw e;error(422,'Provide a demo role.')}
   const role=body.role;if(!['scheduler','manager'].includes(role))error(422,'Choose Scheduler or Manager.');
   let raw;
   if(!w){({w,raw}=await newWorkspace(db,role))}
   else{w.role=role;w.csrf=token();await db.batch([sql(db,'UPDATE demo_workspaces SET role=?,csrf=? WHERE id=?',role,w.csrf,w.id),audit(db,w,'demo.role_selected',w.id,{role})])}
   const headers=raw?{'Set-Cookie':`${COOKIE}=${raw}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS*86400}${url.protocol==='https:'?'; Secure':''}`} : {};
   return response(identity(w),200,headers);
  }
  if(!w||!['scheduler','manager'].includes(w.role))error(401,'Choose a demo role to begin.');
  if(method==='POST'&&request.headers.get('x-csrf-token')!==w.csrf)error(403,'This demo session changed. Refresh and choose a role again.');
  const manager=()=>{if(w.role!=='manager')error(403,'Manager access required.')};
  if(path==='/api/auth/me')return response(identity(w));
  if(path==='/api/auth/logout'&&method==='POST'){await db.batch([audit(db,w,'demo.role_left',w.id),sql(db,'UPDATE demo_workspaces SET role=?,csrf=? WHERE id=?','',token(),w.id)]);return response({ok:true})}
  if(path==='/api/rules'&&method==='GET')return response(await getRule(db,w));
  if(path==='/api/rules/history'&&method==='GET'){manager();return response((await all(db,'SELECT data FROM demo_rule_versions WHERE workspace_id=? ORDER BY version DESC LIMIT 100',w.id)).map(r=>JSON.parse(r.data)))}
  if(path==='/api/rules'&&method==='POST'){
   manager();let b;try{b=JSON.parse(new TextDecoder().decode(await readBody(request,8192)))}catch(e){if(e instanceof ApiError)throw e;error(422,'Invalid settings JSON.')}
   if(!Number.isInteger(b.expected_version)||b.expected_version!==w.active_version)error(409,'Rules changed in another tab. Reload before saving.');
   if(w.active_version>=100)error(422,'This demo supports up to 100 rule versions.');
   if(typeof b.name!=='string'||b.name.trim().length<3||b.name.length>80||typeof b.reason!=='string'||b.reason.trim().length<5||b.reason.length>400)error(422,'Supply a rule name and a change reason of at least five characters.');
   if(!Number.isFinite(b.max_duty_hours)||b.max_duty_hours<1||b.max_duty_hours>24||!Number.isFinite(b.min_rest_hours)||b.min_rest_hours<1||b.min_rest_hours>48||!['start','end'].includes(b.certification_at))error(422,'Thresholds must be within the allowed range.');
   const policy={name:b.name.trim(),max_duty_hours:b.max_duty_hours,min_rest_hours:b.min_rest_hours,certification_at:b.certification_at,version:w.active_version+1,created_at:now(),created_by:names[w.role],reason:b.reason.trim()};
   const results=await db.batch([
    sql(db,'INSERT INTO demo_rule_versions SELECT ?,id,?,? FROM demo_workspaces WHERE id=? AND active_version=?',id(),policy.version,JSON.stringify(policy),w.id,w.active_version),
    sql(db,'INSERT INTO demo_audit_events SELECT ?,id,?,?,?,?,? FROM demo_workspaces WHERE id=? AND active_version=?',id(),w.role,'rules.version_created',String(policy.version),now(),JSON.stringify({before:w.active_version,after:policy.version,reason:policy.reason}),w.id,w.active_version),
    sql(db,'UPDATE demo_workspaces SET active_version=? WHERE id=? AND active_version=?',policy.version,w.id,w.active_version)
   ]);
   if(!results[2].meta.changes)error(409,'Rules changed in another tab. Reload before saving.');
   return response(policy);
  }
  if(path==='/api/uploads'&&method==='POST'){
   const count=await first(db,'SELECT COUNT(*) AS n FROM demo_uploads WHERE workspace_id=?',w.id);if(count.n>=MAX_UPLOADS)error(422,'This sample workspace has reached its 30-upload limit.');
   const bytes=await readBody(request,maxBytes+1024*1024);let form;
   try{form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData()}catch{error(422,'Use a CSV or XLSX file upload.')}
   const file=form.get('file');if(!file||typeof file==='string')error(422,'Select a roster file.');
   const filename=file.name.replaceAll('\\','/').split('/').at(-1).slice(0,160),content=new Uint8Array(await file.arrayBuffer());
   let options;try{options=JSON.parse(form.get('options')||'{}');if(!options||typeof options!=='object'||Array.isArray(options))throw Error();if(options.mapping&&(typeof options.mapping!=='object'||Array.isArray(options.mapping)))throw Error();for(const k of ['worksheet','timezone'])if(options[k]!=null&&typeof options[k]!=='string')throw Error()}catch{error(422,'Invalid import settings.')}
   const rows=parseUpload(filename,content,options,maxBytes),uid=id(),policy=await getRule(db,w),digest=await hash(content);
   if(new TextEncoder().encode(JSON.stringify(rows)).length>1500000)error(422,'This import exceeds the current storage capacity. Contact the administrator to increase deployment capacity.');
   await db.batch([sql(db,'INSERT INTO demo_uploads VALUES (?,?,?,?,?,?,?,?)',uid,w.id,w.role,filename,now(),digest,policy.version,JSON.stringify(rows)),audit(db,w,'roster.uploaded',uid,{filename,rows:rows.length,rule_version:policy.version,file_sha256:digest,import_settings:options})]);
   return response({id:uid,filename,row_count:rows.length,crew_count:new Set(rows.map(r=>r.crew_id)).size,preview:rows.slice(0,20),rules:policy,preview_limit:20,import_settings:options},201);
  }
  const check=/^\/api\/uploads\/([a-f0-9]{24})\/check$/.exec(path);
  if(check&&method==='POST'){
   const upload=await first(db,'SELECT * FROM demo_uploads WHERE id=? AND workspace_id=?',check[1],w.id);
   if(!upload||(w.role!=='manager'&&upload.owner_role!==w.role))error(404,'Upload not found.');
   const existing=await first(db,'SELECT result_json FROM demo_runs WHERE upload_id=? AND workspace_id=?',upload.id,w.id);if(existing)return response(JSON.parse(existing.result_json));
   const policy=await getRule(db,w,upload.rule_version),run=id(),result={...checkRoster(JSON.parse(upload.rows_json),policy),id:run,created_at:now(),filename:upload.filename,owner:names[upload.owner_role],file_hash:upload.file_hash,rules:policy};
   const json=JSON.stringify(result);if(new TextEncoder().encode(json).length>1500000)error(422,'This result exceeds the current storage capacity. Contact the administrator to increase deployment capacity.');
   // Unique upload_id makes repeat/concurrent requests return one immutable result.
   await db.batch([sql(db,'INSERT OR IGNORE INTO demo_runs VALUES (?,?,?,?,?,?,?)',run,upload.id,w.id,upload.owner_role,upload.filename,result.created_at,json),sql(db,'INSERT INTO demo_audit_events SELECT ?,workspace_id,?,?,?,?,? FROM demo_runs WHERE id=?',id(),w.role,'roster.checked',run,now(),JSON.stringify({upload_id:upload.id,rule_version:policy.version,findings:result.summary.findings}),run)]);
   const stored=await first(db,'SELECT result_json FROM demo_runs WHERE upload_id=? AND workspace_id=?',upload.id,w.id),saved=JSON.parse(stored.result_json);
   return response(saved);
  }
  if(path==='/api/runs'&&method==='GET'){
   const q=url.searchParams.get('q')||'',from=url.searchParams.get('from_date')||'',to=url.searchParams.get('to_date')||'',offset=Number(url.searchParams.get('offset')||0);
   if(q.length>160||!Number.isSafeInteger(offset)||offset<0)error(422,'Invalid search or page offset.');
   for(const value of [from,to])if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))error(422,'Use valid YYYY-MM-DD dates.');
   let where='workspace_id=?',args=[w.id];if(w.role!=='manager'){where+=' AND owner_role=?';args.push(w.role)}
   if(q){where+=' AND filename LIKE ?';args.push('%'+q+'%')}if(from){where+=' AND substr(created_at,1,10)>=?';args.push(from)}if(to){where+=' AND substr(created_at,1,10)<=?';args.push(to)}
   const total=await first(db,'SELECT COUNT(*) AS n FROM demo_runs WHERE '+where,...args);
   const records=await all(db,'SELECT result_json FROM demo_runs WHERE '+where+' ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET ?',...args,offset);
   return response({items:records.map(r=>{const data=JSON.parse(r.result_json);return Object.fromEntries(['id','created_at','filename','owner','summary','rules'].map(k=>[k,data[k]]))}),total:total.n,offset,limit:25});
  }
  const runMatch=/^\/api\/runs\/([a-f0-9]{24})$/.exec(path);
  if(runMatch&&method==='GET'){
   const r=await first(db,'SELECT * FROM demo_runs WHERE id=? AND workspace_id=?',runMatch[1],w.id);if(!r||(w.role!=='manager'&&r.owner_role!==w.role))error(404,'Check not found.');return response(JSON.parse(r.result_json));
  }
  if(path==='/api/audit'&&method==='GET'){manager();return response({items:await all(db,'SELECT id,actor_role,action,target_id,created_at,details FROM demo_audit_events WHERE workspace_id=? ORDER BY created_at DESC,id DESC LIMIT 100',w.id)})}
  if(/^\/api\/templates\/(csv|xlsx)$/.test(path)&&method==='GET')return new Response(null,{status:302,headers:{Location:'/samples/sample_roster.'+path.split('/').at(-1)}});
  error(404,'Endpoint not found.');
 }catch(e){
  if(e instanceof RosterError)return response({detail:e.message,errors:e.errors,...(e.import_options?{import_options:e.import_options}:{})},422);
  if(e instanceof ApiError)return response({detail:e.message},e.status);
  console.error('CrewCheck API error',e?.name,e?.message);return response({detail:'The request could not be completed. Please try again.'},500);
 }
}
