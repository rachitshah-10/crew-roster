const $ = (s, root=document) => root.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {shield:'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z"/><path d="m8 12 3 3 5-6"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',rules:'<path d="M5 4v16M12 4v16M19 4v16M2 8h6m1 8h6m1-6h6"/>',file:'<path d="M5 3h9l5 5v13H5zM14 3v5h5M8 13h8M8 17h6"/>',arrow:'<path d="M4 12h16m-5-5 5 5-5 5"/>',book:'<path d="M12 5v16M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2z"/>',plus:'<path d="M12 4v16M4 12h16"/>'};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.file}</svg>`;
let user=null, rules=null, preview=null, currentRun=null, history=null, route='', offset=0, filter='all', query='', role='all', generation=0, lastFocus=null;
let uploadGeneration=0;
let historyQ='', historyFrom='', historyTo='';
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),4500)}
async function api(url, options={}){
  const headers={...(options.headers||{})};
  if(user?.csrf && options.method && options.method!=='GET') headers['X-CSRF-Token']=user.csrf;
  if(options.body && !(options.body instanceof FormData)) headers['Content-Type']='application/json';
  const response=await fetch(url,{...options,headers,credentials:'same-origin'});
  let data;try{data=await response.json()}catch{throw new Error('The server returned an unreadable response.')}
  if(!response.ok){
    if(response.status===401 && !url.endsWith('/login')){user=null;loginScreen()}
    let message=typeof data.detail==='string'?data.detail:(Array.isArray(data.detail)?data.detail.map(e=>e.msg).join('; '):'Request failed.');
    const error=new Error(message);error.errors=data.errors;error.import_options=data.import_options;throw error;
  }
  return data;
}
function date(value){return new Date(value).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}
function shortDate(value){return new Date(value).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
function hours(row){return ((new Date(row.duty_end)-new Date(row.duty_start))/3600000).toFixed(2).replace(/\.?0+$/,'')}
function shell(content){
 const manager=user.role==='manager';
 $('#app').innerHTML=`<div class="layout"><aside class="sidebar"><div class="brand">${icon('shield')}CrewCheck</div><div class="navlabel">Workspace</div><nav><button data-nav="checks" class="${route==='checks'||route.startsWith('run/')?'active':''}">${icon('grid')}${manager?'Check history':'My roster checks'}</button><button data-nav="upload" class="${route==='upload'?'active':''}">${icon('upload')}Load roster</button><div class="navgap"></div><button data-nav="rules" class="${route==='rules'?'active':''}">${icon('rules')}${manager?'Rules & thresholds':'Active rule set'}</button><a class="navlink" href="/documentation" target="_blank" rel="noopener">${icon('book')}Architecture & guide</a></nav><div class="sidefoot"><strong><span class="statusdot"></span>Local demo workspace</strong>Synthetic crew and duties.<br>Illustrative rules for discussion.</div></aside><main class="main"><header class="topbar"><div class="breadcrumb">${icon('grid')}Crew planning workspace</div><div class="profile"><span class="badge">DEMO</span><span class="avatar">${esc(user.name.split(' ').map(x=>x[0]).join(''))}</span><span>${esc(user.name)}<small>${esc(user.role)}</small></span><button class="textbutton" data-action="logout">Sign out</button></div></header><div class="content">${content}</div></main></div>`;
}
function pagehead(title,subtitle,actions='',kicker='Roster review'){return `<div class="pagehead"><div><p class="kicker">${kicker}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="actions">${actions}</div></div>`}
function errHTML(error){return `<div class="error" role="alert">${esc(error.message)}${error.errors?`<ul>${error.errors.map(e=>`<li>${e.row?'Row '+e.row+': ':''}${esc(e.message)}</li>`).join('')}</ul>`:''}</div>`}
function metrics(items){return `<div class="metrics">${items.map(([label,value,hint,warn])=>`<div class="card metric ${warn?'attention':''}"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`).join('')}</div>`}
function loginScreen(error=''){
 $('#drawer-root').innerHTML='';
 $('#app').innerHTML=`<main class="login"><section class="loginintro"><div class="brand">${icon('shield')}CrewCheck</div><div class="line"></div><h1>A clearer view<br>of every duty.</h1><p>Review rosters, understand the flags, and keep the evidence behind each decision.</p><p class="note">A working MVP with synthetic data.<br>The scheduler remains in control.</p></section><section class="loginform"><div><span class="badge">LOCAL DEMO</span><h2>Welcome to CrewCheck</h2><p class="subtitle">Sign in to your crew planning workspace.</p><form id="login-form"><div class="field"><label for="email">Email address</label><input type="email" id="email" name="email" autocomplete="username" required placeholder="you@crewcheck.local"></div><div class="field"><label for="password">Password</label><input type="password" id="password" name="password" autocomplete="current-password" required></div><div id="login-error">${error?errHTML(error):''}</div><button class="btn primary" type="submit">Sign in ${icon('arrow')}</button></form><div class="demologin"><p>Try the two demo roles</p><div class="actions"><button class="btn" data-demo="scheduler">Scheduler</button><button class="btn" data-demo="manager">Manager</button></div><p>Demo buttons fill the local default credentials.<br><a href="/documentation" target="_blank" rel="noopener">View architecture and demo guide</a></p></div></div></section></main>`;
}
function nav(target){if(location.hash==='#'+target)go();else location.hash=target}
async function go(){
 if(!user)return;
 const g=++generation;route=location.hash.slice(1)||'checks';
 if(route!=='checks'&&route!=='upload'&&route!=='rules'&&!/^run\/[a-f0-9]{24}$/.test(route)){route='checks';window.history.replaceState(null,'','#checks')}
 
 // This incremental port enables workflows as their view implementations land.
 const included=route==='upload'?typeof renderUpload==='function':route==='rules'?typeof renderRules==='function':route==='samples'?typeof renderSamples==='function':route==='audit'?typeof renderAudit==='function':route.startsWith('run/')?typeof renderResult==='function':typeof renderHistory==='function';
 if(!included){shell(pagehead('Workflow pending integration','This view is not included in this implementation step.'));return;}
try{
  if(route==='upload'){rules=await api('/api/rules');if(g!==generation)return;renderUpload()}
  else if(route==='rules'){rules=await api('/api/rules');const revisions=user.role==='manager'?await api('/api/rules/history'):[];if(g!==generation)return;renderRules(revisions)}
  else if(route.startsWith('run/')){currentRun=await api('/api/runs/'+route.split('/')[1]);if(g!==generation)return;filter='all';query='';role='all';renderResult()}
  else{history=await api(`/api/runs?${new URLSearchParams({q:historyQ,from_date:historyFrom,to_date:historyTo,offset})}`);if(g!==generation)return;renderHistory()}
 }catch(error){if(user)shell(pagehead('Unable to open this view','Your saved data has not changed.')+errHTML(error)+`<button class="btn" data-action="reload">Try again</button>`)}
}

function policyCard(policy){return `<div class="card pad"><div class="actions"><h2>Rule set</h2><span class="pill blue">v${policy.version}</span></div><p class="subtitle">${esc(policy.name)}</p><div class="ruleline"><small>Maximum duty duration</small><strong>${policy.max_duty_hours} hours</strong></div><div class="ruleline"><small>Minimum rest</small><strong>${policy.min_rest_hours} hours</strong></div><div class="ruleline"><small>Certification validity</small><strong class="smallvalue">Through duty ${policy.certification_at}</strong></div><p class="note">Illustrative thresholds apply to both crew roles. These are not a complete FAA or EASA rule set.</p></div>`}
const importFields={crew_id:'Crew ID',crew_name:'Crew name',role:'Crew role',duty_id:'Duty ID',duty_start:'Duty start',duty_end:'Duty end',certification_expires_at:'Certification expiry (optional)'};
let pendingImport=null,importSettings={},importChoices={};
function importSetup(){
 if(!pendingImport||!Object.keys(importChoices).length)return '';
 const c=importChoices;
 return `<section class="importsetup"><h3>Confirm how to read this file</h3><p class="note">${esc(pendingImport.name)} · These choices apply to this upload.</p>
 ${c.worksheets?`<div class="field"><label for="import-sheet">Roster worksheet</label><select id="import-sheet"><option value="">Choose a worksheet</option>${c.worksheets.map(s=>`<option ${importSettings.worksheet===s?'selected':''} value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>`:''}
 ${c.needs_mapping?`<p class="note">Match the columns below. Other columns are ignored.</p>${Object.entries(importFields).map(([k,label])=>`<div class="field"><label for="map-${k}">${label}</label><select id="map-${k}" data-import-field="${k}"><option value="">${k==='certification_expires_at'?'Not supplied':'Choose a column'}</option>${c.headers.map(h=>`<option value="${esc(h)}" ${(importSettings.mapping?.[k]??c.mapping?.[k])===h?'selected':''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}`:''}
 ${c.needs_timezone?`<div class="field"><label for="import-timezone">Source time zone</label><input id="import-timezone" list="import-zones" value="${esc(importSettings.timezone||'')}" placeholder="e.g. America/New_York, UTC or +09:00"><datalist id="import-zones"><option value="UTC"><option value="America/New_York"><option value="Europe/London"><option value="Asia/Seoul"><option value="Asia/Kolkata"></datalist><small>Use the time zone of the dates in the file. Timestamps already containing an offset keep that offset. Clock-change ambiguities require an explicit offset in the affected cell.</small></div>`:''}
 <button class="btn primary" data-action="confirm-import">Continue with these settings</button></section>`;
}
function captureImportSettings(){
 if($('#import-sheet'))importSettings.worksheet=$('#import-sheet').value;
 if($('#import-timezone'))importSettings.timezone=$('#import-timezone').value.trim();
 const fields=[...document.querySelectorAll('[data-import-field]')];
 if(fields.length)importSettings.mapping=Object.fromEntries(fields.map(el=>[el.dataset.importField,el.value]));
}

function renderUpload(error){
 const selected=preview?.rules||rules;
 shell(pagehead('Load a roster','Preview your source records before running a check.',`<span class="pill blue">CSV / XLSX</span>`)+`<div class="uploadgrid"><section class="card pad"><h2>Roster file</h2><p class="subtitle">Choose a CSV or Excel roster. Select its worksheet and confirm date interpretation when prompted.</p><div class="droptarget" id="dropzone"><div>${icon('upload')}<h3>Drop your roster here</h3><p>CSV or Excel (.xlsx)</p><label class="btn" for="roster-file">Browse files</label><input id="roster-file" type="file" accept=".csv,.xlsx" aria-label="Select roster file"><button class="btn primary" data-action="sample">Use sample roster</button></div></div><div class="underupload"><span>Download a sample: <a href="/api/templates/csv">CSV</a> / <a href="/api/templates/xlsx">Excel</a></span><span>PDF, DOCX and .xls are excluded</span></div><div id="upload-error">${error?errHTML(error):''}</div>${importSetup()}${preview?`<div class="filelabel">${icon('file')}<div><strong>${esc(preview.filename)}</strong><small>${preview.row_count} duties / ${preview.crew_count} crew members / normalized to UTC${preview.import_settings?.worksheet?' / '+esc(preview.import_settings.worksheet):''}${preview.import_settings?.timezone?' / source zone: '+esc(preview.import_settings.timezone):''}</small></div></div><div class="previewtitle"><h3>Data preview</h3><small>${preview.preview.length} of ${preview.row_count} rows</small></div><div class="tablewrap"><table><thead><tr><th>Crew</th><th>Duty</th><th>Start · UTC</th><th>End · UTC</th></tr></thead><tbody>${preview.preview.map(r=>`<tr><td>${esc(r.crew_name)}<small>${esc(r.crew_id)} / ${esc(r.role)}</small></td><td>${esc(r.duty_id)}</td><td class="nowrap">${shortDate(r.duty_start)}</td><td class="nowrap">${shortDate(r.duty_end)}</td></tr>`).join('')}</tbody></table></div><div class="cardfoot"><span>Uses the rule version captured with this preview: v${selected.version}</span><button class="btn primary" data-action="run">Run roster check ${icon('arrow')}</button></div>`:`<p class="note">Map your columns to crew ID, name, role, duty ID, start and end. Certification expiry is optional; missing evidence is flagged.</p>`}</section>${policyCard(selected)}</div>`);
 const zone=$('#dropzone');zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag')});zone.addEventListener('dragleave',()=>zone.classList.remove('drag'));zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('drag');if(e.dataTransfer.files.length!==1){renderUpload(new Error('Choose one roster file at a time.'));return}uploadFile(e.dataTransfer.files[0])});
}
async function uploadFile(file,retry=false){
 if(!file)return;
 if(!retry){pendingImport=file;importSettings={};importChoices={}}
 const uploadRequest=++uploadGeneration;
 preview=null;$('#upload-error').innerHTML='<p class="note">Validating the file…</p>';
 const form=new FormData();form.append('file',file);form.append('options',JSON.stringify(importSettings));
 try{const uploaded=await api('/api/uploads',{method:'POST',body:form});if(uploadRequest!==uploadGeneration)return;preview=uploaded;pendingImport=null;importChoices={};if(route==='upload')renderUpload()}
 catch(error){if(uploadRequest===uploadGeneration&&user&&route==='upload'){if(error.import_options)importChoices={...importChoices,...error.import_options};renderUpload(error.import_options?null:error)}}
}






function closeDrawer(){$('#drawer-root').innerHTML='';lastFocus?.focus()}

document.addEventListener('click',async e=>{
 const button=e.target.closest('button,[data-action]');if(!button)return;
 if(button.dataset.nav){nav(button.dataset.nav);return}
 if(button.dataset.demo){$('#email').value=button.dataset.demo+'@crewcheck.local';$('#password').value=button.dataset.demo==='manager'?'ManagerDemo!2026':'SchedulerDemo!2026';$('#login-form button[type=submit]').focus();return}
 if(button.dataset.row){openDetails(button.dataset.row);return}
 if(button.dataset.filter){filter=button.dataset.filter;renderResult();return}
 const action=button.dataset.action;if(!action)return;
 if(action==='close-drawer'){closeDrawer();return}
 button.disabled=true;
 try{
  if(action==='logout'){pendingImport=null;importSettings={};importChoices={};await api('/api/auth/logout',{method:'POST'});user=null;preview=null;currentRun=null;historyQ='';historyFrom='';historyTo='';offset=0;loginScreen()}
  if(action==='confirm-import'){captureImportSettings();await uploadFile(pendingImport,true)}
  if(action==='sample'){const response=await fetch('/api/templates/csv');if(!response.ok)throw new Error('Unable to load sample. Sign in again.');await uploadFile(new File([await response.blob()],'sample_roster.csv',{type:'text/csv'}))}
  if(action==='run'){currentRun=await api('/api/uploads/'+preview.id+'/check',{method:'POST'});preview=null;nav('run/'+currentRun.id);toast('Check saved with its rule snapshot.')}
  if(action==='reload')await go();
  if(action==='clear-history'){historyQ='';historyFrom='';historyTo='';offset=0;await go()}
  if(action==='prev-page'){offset=Math.max(0,offset-25);await go()}
  if(action==='next-page'){offset+=25;await go()}
 }catch(error){toast(error.message)}finally{button.disabled=false}
});
document.addEventListener('submit',async e=>{
 const form=e.target;e.preventDefault();const values=Object.fromEntries(new FormData(form));const submit=$('button[type=submit]',form);if(submit)submit.disabled=true;
 try{
  if(form.id==='login-form'){user=await api('/api/auth/login',{method:'POST',body:JSON.stringify(values)});location.hash='checks';await go()}
  if(form.id==='history-filter'){historyQ=values.q;historyFrom=values.from;historyTo=values.to;offset=0;await go()}
  if(form.id==='rules-form'){await api('/api/rules',{method:'POST',body:JSON.stringify({...values,expected_version:rules.version,max_duty_hours:Number(values.max_duty_hours),min_rest_hours:Number(values.min_rest_hours)})});await go();toast('New rule version saved. Existing checks are unchanged.')}
 }catch(error){const target=form.id==='login-form'?$('#login-error'):$('#rules-error');if(target)target.innerHTML=errHTML(error);else toast(error.message)}finally{if(submit)submit.disabled=false}
});
document.addEventListener('change',e=>{if(e.target.id==='roster-file')uploadFile(e.target.files[0]);if(e.target.id==='role-filter'){role=e.target.value;refreshRows()}});
document.addEventListener('input',e=>{if(e.target.id==='crew-search'){query=e.target.value;refreshRows()}});
document.addEventListener('keydown',e=>{const drawer=$('.drawer');if(!drawer)return;if(e.key==='Escape')closeDrawer();if(e.key==='Tab'){const focusable=[...drawer.querySelectorAll('button,a,input,select,[tabindex="0"]')];if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
window.addEventListener('hashchange',go);
(async()=>{try{user=await api('/api/auth/me');await go()}catch{loginScreen()}})();
