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
 $('#app').innerHTML=`<div class="layout"><aside class="sidebar"><div class="brand">${icon('shield')}CrewCheck</div><div class="navlabel">Workspace</div><nav><button data-nav="checks" class="${route==='checks'||route.startsWith('run/')?'active':''}">${icon('grid')}${manager?'Check history':'My roster checks'}</button><button data-nav="upload" class="${route==='upload'?'active':''}">${icon('upload')}Load roster</button><div class="navgap"></div><button data-nav="rules" class="${route==='rules'?'active':''}">${icon('rules')}${manager?'Rules & thresholds':'Active rule set'}</button><button data-nav="samples" class="${route==='samples'?'active':''}">${icon('file')}Sample library</button>${manager?`<button data-nav="audit" class="${route==='audit'?'active':''}">${icon('clock')}Audit trail</button>`:''}<a class="navlink" href="/documentation" target="_blank" rel="noopener">${icon('book')}Architecture & guide</a></nav></aside><main class="main"><header class="topbar"><div class="breadcrumb">${icon('grid')}Crew planning workspace</div><div class="profile"><span class="badge">DEMO</span><span class="avatar">${esc(user.name.split(' ').slice(0,2).map(x=>x[0]).join(''))}</span><span>${esc(user.name)}<small>${esc(user.role)}</small></span><button class="textbutton" data-action="logout">Switch role</button></div></header><div class="content">${content}</div></main></div>`;
}
function pagehead(title,subtitle,actions='',kicker='Roster review'){return `<div class="pagehead"><div><p class="kicker">${kicker}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="actions">${actions}</div></div>`}
function errHTML(error){return `<div class="error" role="alert">${esc(error.message)}${error.errors?`<ul>${error.errors.map(e=>`<li>${e.row?'Row '+e.row+': ':''}${esc(e.message)}</li>`).join('')}</ul>`:''}</div>`}
function metrics(items){return `<div class="metrics">${items.map(([label,value,hint,warn])=>`<div class="card metric ${warn?'attention':''}"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`).join('')}</div>`}
function loginScreen(error=''){
 $('#drawer-root').innerHTML='';
 $('#app').innerHTML=`<main class="login"><section class="loginintro"><div class="brand">${icon('shield')}CrewCheck</div><div class="line"></div><span class="demokicker">CREW ROSTER REVIEW</span><h1>See the roster.<br>Understand the flags.</h1><p>Upload a roster, review findings, and revisit saved checks.</p><div class="introsteps"><span>01 · Load a roster</span><span>02 · Review evidence</span><span>03 · Revisit history</span></div></section><section class="loginform"><div><span class="badge">INTERACTIVE DEMO</span><h2>Take a look around.</h2><p class="subtitle">Choose a role to begin.</p><div id="login-error">${error?errHTML(error):''}</div><button class="rolechoice" data-demo="scheduler"><span class="roleicon">${icon('upload')}</span><span><strong>Explore as Scheduler</strong><small>Upload rosters and review findings</small></span>${icon('arrow')}</button><button class="rolechoice" data-demo="manager"><span class="roleicon">${icon('rules')}</span><span><strong>Explore as Manager</strong><small>Review history and manage thresholds</small></span>${icon('arrow')}</button><div class="demolinks"><a href="/documentation" target="_blank" rel="noopener">Architecture & user flow ↗</a><a href="/samples/README.html" target="_blank" rel="noopener">Download sample files ↗</a></div></div></section></main>`;
}
function nav(target){if(location.hash==='#'+target)go();else location.hash=target}
async function go(){
 if(!user)return;
 const g=++generation;route=location.hash.slice(1)||(user.role==='scheduler'?'upload':'checks');
 if(route!=='checks'&&route!=='upload'&&route!=='rules'&&route!=='samples'&&route!=='audit'&&!/^run\/[a-f0-9]{24}$/.test(route)){route='checks';window.history.replaceState(null,'','#checks')}
 try{
  if(route==='samples'){renderSamples()}
  else if(route==='audit'){const events=await api('/api/audit');if(g!==generation)return;renderAudit(events.items)}
  else if(route==='upload'){rules=await api('/api/rules');if(g!==generation)return;renderUpload()}
  else if(route==='rules'){rules=await api('/api/rules');const revisions=user.role==='manager'?await api('/api/rules/history'):[];if(g!==generation)return;renderRules(revisions)}
  else if(route.startsWith('run/')){currentRun=await api('/api/runs/'+route.split('/')[1]);if(g!==generation)return;filter='all';query='';role='all';renderResult()}
  else{history=await api(`/api/runs?${new URLSearchParams({q:historyQ,from_date:historyFrom,to_date:historyTo,offset})}`);if(g!==generation)return;renderHistory()}
 }catch(error){if(user)shell(pagehead('Unable to open this view','Your saved data has not changed.')+errHTML(error)+`<button class="btn" data-action="reload">Try again</button>`)}
}
function renderHistory(){
 const manager=user.role==='manager',items=history.items;
 shell(pagehead(manager?'Check history':'My roster checks',manager?'Saved checks in this browser workspace.':'Your saved roster checks.',`<button class="btn primary" data-nav="upload">${icon('plus')}Load roster</button>`)+
 `<div class="card"><form id="history-filter" class="toolbar"><input type="search" name="q" aria-label="Search filenames" placeholder="Search by filename" value="${esc(historyQ)}"><label>From <input type="date" name="from" value="${esc(historyFrom)}"></label><label>To <input type="date" name="to" value="${esc(historyTo)}"></label><button class="btn small" type="submit">Apply filters</button><button class="textbutton" type="button" data-action="clear-history">Clear</button></form>${items.length?`<div class="tablewrap"><table><thead><tr><th>Roster file</th><th>Checked at · UTC</th>${manager?'<th>Uploaded by</th>':''}<th>Duties</th><th>Findings</th><th>Rule version</th><th></th></tr></thead><tbody>${items.map(r=>`<tr><td><strong>${esc(r.filename)}</strong><small>${r.summary.crew} crew members</small></td><td class="nowrap">${date(r.created_at)}</td>${manager?`<td>${esc(r.owner)}</td>`:''}<td>${r.summary.duties}</td><td><span class="pill ${r.summary.findings?'warn':'green'}">${r.summary.findings?r.summary.findings+' findings':'No flags'}</span></td><td><strong>v${r.rules.version} · ${esc(r.rules.name)}</strong><small>Duty ≤ ${r.rules.max_duty_hours} h · Rest ≥ ${r.rules.min_rest_hours} h</small></td><td><button class="btn small" data-nav="run/${r.id}">View check</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty">${icon('file')}<h2>${history.total?'No matching checks':'Your first check starts here'}</h2><p>${historyQ||historyFrom||historyTo?'Try a different filename or date range.':'Upload a roster to start your first check.'}</p><button class="btn primary" data-nav="upload">${icon('upload')}Load a roster</button></div>`}<div class="cardfoot"><span>${history.total} checks · showing ${items.length?offset+1:0}–${offset+items.length}</span><div class="actions"><button class="btn small" data-action="prev-page" ${offset===0?'disabled':''}>Previous</button><button class="btn small" data-action="next-page" ${offset+25>=history.total?'disabled':''}>Next</button></div></div></div>`);
}
function policyCard(policy){return `<div class="card pad"><div class="actions"><h2>Rule set</h2><span class="pill blue">v${policy.version}</span></div><p class="subtitle">${esc(policy.name)}</p><div class="ruleline"><small>Maximum duty duration</small><strong>${policy.max_duty_hours} hours</strong></div><div class="ruleline"><small>Minimum rest</small><strong>${policy.min_rest_hours} hours</strong></div><div class="ruleline"><small>Certification validity</small><strong class="smallvalue">Through duty ${policy.certification_at}</strong></div></div>`}
const importFields={crew_id:'Crew ID',crew_name:'Crew name',role:'Crew role',duty_id:'Duty ID',duty_start:'Duty start',duty_end:'Duty end',certification_expires_at:'Certification expiry (optional)'};
let pendingImport=null,importSettings={},importChoices={};
function importSetup(){
 if(!pendingImport||!Object.keys(importChoices).length)return '';
 const c=importChoices;
 return `<section class="importsetup"><h3>Confirm how to read this file</h3><p class="note">${esc(pendingImport.name)}</p>
 ${c.worksheets?`<div class="field"><label for="import-sheet">Roster worksheet</label><select id="import-sheet"><option value="">Choose a worksheet</option>${c.worksheets.map(s=>`<option ${importSettings.worksheet===s?'selected':''} value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>`:''}
 ${c.needs_mapping?`<p class="note">Match your file’s columns.</p>${Object.entries(importFields).map(([k,label])=>`<div class="field"><label for="map-${k}">${label}</label><select id="map-${k}" data-import-field="${k}"><option value="">${k==='certification_expires_at'?'Not supplied':'Choose a column'}</option>${c.headers.map(h=>`<option value="${esc(h)}" ${(importSettings.mapping?.[k]??c.mapping?.[k])===h?'selected':''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}`:''}
 ${c.needs_timezone?`<div class="field"><label for="import-timezone">Source time zone</label><input id="import-timezone" list="import-zones" value="${esc(importSettings.timezone||'')}" placeholder="e.g. America/New_York, UTC or +09:00"><datalist id="import-zones"><option value="UTC"><option value="America/New_York"><option value="Europe/London"><option value="Asia/Seoul"><option value="Asia/Kolkata"></datalist><small>For dates without an offset, choose the time zone used in the file.</small></div>`:''}
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
 shell(pagehead('Load a roster','Upload, preview and check.',`<span class="pill blue">CSV / XLSX</span>`)+`
 <ol class="uploadsteps" aria-label="Roster review steps"><li class="${preview?'complete':'current'}"><span>01</span><div><strong>Upload a file</strong><small>Choose CSV or Excel</small></div></li><li class="${preview?'current':''}"><span>02</span><div><strong>Preview & check</strong><small>Confirm rows and rules</small></div></li><li><span>03</span><div><strong>Review findings</strong><small>Inspect the evidence</small></div></li></ol>
 <div class="uploadgrid"><section class="card pad"><h2>${preview?'Ready to check':'Upload your roster'}</h2><p class="subtitle">${preview?'Review the preview, then run the check.':'Choose a file or try a sample roster.'}</p>
 ${!preview?`<div class="starterfile"><div class="starterdescription">${icon('file')}<div><strong>Sample roster</strong><p>6 duties · 4 fictional crew</p></div></div><div class="actions"><a class="btn small" href="/samples/sample_roster.csv" download="sample_roster.csv" aria-label="Download CSV">CSV ↓</a><a class="btn small" href="/samples/sample_roster.xlsx" download="sample_roster.xlsx" aria-label="Download Excel">Excel ↓</a></div></div>`:''}
 <div class="droptarget ${preview?'compact':''}" id="dropzone"><div>${icon('upload')}<h3>${preview?'Choose a different file':'Drop your roster here'}</h3>${!preview?'<p>CSV or Excel (.xlsx)</p>':''}<label class="btn ${preview?'':'primary'}" for="roster-file">${preview?'Replace file':'Browse files'}</label><input id="roster-file" type="file" accept=".csv,.xlsx" aria-label="Select roster file">${!preview?'<button class="textbutton" data-action="sample">Or load sample directly</button>':''}</div></div>
 <div id="upload-error">${error?errHTML(error):''}</div>${importSetup()}${preview?`<div class="filelabel">${icon('file')}<div><strong>${esc(preview.filename)}</strong><small>${preview.row_count} duties / ${preview.crew_count} crew members / normalized to UTC${preview.import_settings?.worksheet?' / '+esc(preview.import_settings.worksheet):''}${preview.import_settings?.timezone?' / source zone: '+esc(preview.import_settings.timezone):''}</small></div></div><div class="previewtitle"><div><h3>Data preview</h3><small>${preview.preview.length} of ${preview.row_count} rows · rule snapshot v${selected.version}</small></div><button class="btn primary" data-action="run">Run roster check ${icon('arrow')}</button></div><div class="tablewrap"><table><thead><tr><th>Crew</th><th>Duty</th><th>Start · UTC</th><th>End · UTC</th></tr></thead><tbody>${preview.preview.map(r=>`<tr><td>${esc(r.crew_name)}<small>${esc(r.crew_id)} / ${esc(r.role)}</small></td><td>${esc(r.duty_id)}</td><td class="nowrap">${shortDate(r.duty_start)}</td><td class="nowrap">${shortDate(r.duty_end)}</td></tr>`).join('')}</tbody></table></div>`:`<p class="note">Missing certification expiry is flagged.</p>`}</section>${policyCard(selected)}</div>`);
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
function matchingRows(){return currentRun.rows.filter(r=>(filter==='all'||currentRun.flags.some(f=>f.row_number===r.row_number))&&(role==='all'||r.role===role)&&[r.crew_id,r.crew_name,r.duty_id].some(v=>v.toLowerCase().includes(query.toLowerCase())))}
function resultRows(){const rows=matchingRows();return rows.map(r=>{const flags=currentRun.flags.filter(f=>f.row_number===r.row_number);return `<tr><td><strong>${esc(r.crew_name)}</strong><small>${esc(r.crew_id)} / ${esc(r.role)}</small></td><td>${esc(r.duty_id)}</td><td class="nowrap">${shortDate(r.duty_start)}<small>to ${shortDate(r.duty_end)}</small></td><td>${hours(r)} h</td><td>${flags.length?flags.map(f=>`<span class="pill ${f.severity==='incomplete'?'red':'warn'}">${esc(f.title)}</span>`).join(' '):'<span class="pill green">No flags</span>'}</td><td><button class="btn small" data-row="${r.row_number}">Details</button></td></tr>`}).join('')||'<tr><td colspan="6">No duties match these filters.</td></tr>'}
function refreshRows(){const body=$('#result-body');if(body){body.innerHTML=resultRows();$('#rows-count').textContent=`${matchingRows().length} of ${currentRun.summary.duties} duties`}}
function appliedRuleCard(policy){return `<section class="card pad appliedrules" aria-labelledby="applied-rule-title"><div class="appliedruleshead"><div><p class="kicker">SAVED WITH THIS CHECK</p><h2 id="applied-rule-title">Applied rule set</h2><p class="subtitle">${esc(policy.name)}</p></div><span class="pill blue">Version ${policy.version}</span></div><dl class="appliedrulevalues"><div><dt>Maximum duty duration</dt><dd>${policy.max_duty_hours} hours</dd></div><div><dt>Minimum rest</dt><dd>${policy.min_rest_hours} hours</dd></div><div><dt>Certification valid through</dt><dd>Duty ${esc(policy.certification_at)}</dd></div></dl><details class="appliedrulemeta"><summary>Rule version details</summary><p>Created ${date(policy.created_at)} UTC · ${esc(policy.created_by)}</p><p><strong>Reason:</strong> ${esc(policy.reason)}</p></details></section>`}
function renderResult(){
 const r=currentRun,s=r.summary;
 shell(pagehead('Roster check',`${esc(r.filename)} · Checked ${date(r.created_at)} UTC`, `<button class="btn" data-nav="checks">Back to checks</button><button class="btn primary" data-nav="upload">New check</button>`)+
 appliedRuleCard(r.rules)+
 metrics([['Duties checked',s.duties,'in this roster'],['Duties flagged',s.flagged_duties,'need a human look',true],['Findings',s.findings,'with evidence',true],['Crew members',s.crew,'in this roster']])+
 `<div class="card"><div class="tabbar"><button class="tab ${filter==='all'?'active':''}" data-filter="all">All duties <span>${s.duties}</span></button><button class="tab ${filter==='flagged'?'active':''}" data-filter="flagged">Flagged <span>${s.flagged_duties}</span></button></div><div class="toolbar"><input type="search" id="crew-search" aria-label="Search crew or duty" placeholder="Search crew or duty ID" value="${esc(query)}"><select id="role-filter" aria-label="Filter crew role"><option value="all" ${role==='all'?'selected':''}>All roles</option><option value="pilot" ${role==='pilot'?'selected':''}>Pilots</option><option value="cabin" ${role==='cabin'?'selected':''}>Cabin crew</option></select><span class="filtersgrow"></span><span class="pill blue">Rule snapshot v${r.rules.version}</span></div><div class="tablewrap"><table><thead><tr><th>Crew member</th><th>Duty</th><th>Schedule · UTC</th><th>Duration</th><th>Findings</th><th></th></tr></thead><tbody id="result-body">${resultRows()}</tbody></table></div><div class="cardfoot"><span id="rows-count">${matchingRows().length} of ${s.duties} duties</span><span>Uploaded by ${esc(r.owner)}</span></div></div>`);
}
function openDetails(rowNumber){
 const row=currentRun.rows.find(r=>r.row_number===Number(rowNumber)),flags=currentRun.flags.filter(f=>f.row_number===Number(rowNumber));lastFocus=document.activeElement;
 const label=k=>({duty_start:'Duty starts',duty_end:'Duty ends',difference_hours:'Hours over limit',previous_duty_id:'Previous duty',previous_duty_end:'Previous duty ends',next_duty_start:'Next duty starts',assessment_time:'Validity assessed at',certification_expires_at:'Certification expires'}[k]||k);
 $('#drawer-root').innerHTML=`<div class="drawerbackdrop" data-action="close-drawer"></div><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabindex="-1"><button class="drawerclose" data-action="close-drawer" aria-label="Close details">×</button><p class="kicker">Finding details</p><h2 id="drawer-title">${esc(row.crew_name)}</h2><p class="subtitle">${esc(row.crew_id)} / ${esc(row.duty_id)} · Source row ${row.row_number}${row.source_sheet?' / '+esc(row.source_sheet):''}${row.source_timezone?' / source zone: '+esc(row.source_timezone):''}</p><span class="pill ${flags.length?'warn':'green'}">${flags.length?'Needs review':'No flags'}</span>${flags.length?flags.map(f=>`<section class="flagblock"><h3>${esc(f.title)}</h3><div class="readings"><div class="reading"><small>Observed</small><strong>${esc(f.observed)}</strong></div><div class="reading"><small>Expected</small><strong>${esc(f.expected)}</strong></div></div><div class="evidence"><dl>${Object.entries(f.evidence).map(([k,v])=>`<dt>${label(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div><p class="note">${esc(f.code)} · Rule snapshot v${currentRun.rules.version}</p></section>`).join(''):`<div class="evidence"><dl><dt>Duty starts · UTC</dt><dd>${esc(row.duty_start)}</dd><dt>Duty ends · UTC</dt><dd>${esc(row.duty_end)}</dd><dt>Certification expires</dt><dd>${esc(row.certification_expires_at||'Not supplied')}</dd></dl></div>`}<div class="drawerfoot">Check ${esc(currentRun.id)}<br>Engine ${esc(currentRun.engine_version)}<br>Source SHA-256<br><span class="mono">${esc(currentRun.file_hash)}</span></div></section>`;
 $('.drawerclose').focus();
}
function closeDrawer(){$('#drawer-root').innerHTML='';lastFocus?.focus()}
function renderRules(revisions){
 const edit=user.role==='manager';
 shell(pagehead(edit?'Rules & thresholds':'Active rule set',edit?'Create a new version for future uploads. Completed checks keep their original rules.':'The rule set currently used for new uploads.',`<span class="pill blue">Version ${rules.version}</span>`,'Rule management')+
 `<div class="settingsgrid"><div class="card pad"><h2>${edit?'Configure thresholds':'Current thresholds'}</h2>${edit?`<form id="rules-form"><div class="field"><label for="rule-name">Rule set name</label><input id="rule-name" name="name" minlength="3" maxlength="80" value="${esc(rules.name)}" required></div><div class="fields2"><div class="field"><label for="max-duty">Maximum duty hours</label><input id="max-duty" name="max_duty_hours" type="number" min="1" max="24" step="0.25" value="${rules.max_duty_hours}" required></div><div class="field"><label for="min-rest">Minimum rest hours</label><input id="min-rest" name="min_rest_hours" type="number" min="1" max="48" step="0.25" value="${rules.min_rest_hours}" required></div></div><div class="field"><label for="cert-at">Certification must remain valid through</label><select id="cert-at" name="certification_at"><option value="end" ${rules.certification_at==='end'?'selected':''}>Duty end</option><option value="start" ${rules.certification_at==='start'?'selected':''}>Duty start</option></select></div><div class="field"><label for="reason">Reason for this change</label><input name="reason" id="reason" minlength="5" maxlength="400" required placeholder="Record why the threshold is changing"></div><div id="rules-error"></div><button type="submit" class="btn primary">Save new version ${icon('arrow')}</button></form>`:`<div class="ruleline"><small>Maximum duty</small><strong>${rules.max_duty_hours} hours</strong></div><div class="ruleline"><small>Minimum rest</small><strong>${rules.min_rest_hours} hours</strong></div><div class="ruleline"><small>Certification valid through</small><strong>Duty ${rules.certification_at}</strong></div>`}</div><div class="card pad"><h2>${edit?'Version history':'Checks included'}</h2>${edit?revisions.map(v=>`<div class="logentry"><strong>v${v.version} · ${esc(v.name)}</strong><small>${date(v.created_at)} UTC · ${esc(v.created_by)}</small><p>${esc(v.reason)}</p><p>Duty ≤ ${v.max_duty_hours} h / Rest ≥ ${v.min_rest_hours} h / Valid through ${v.certification_at}</p></div>`).join(''):'<div class="ruleline">Duty duration</div><div class="ruleline">Rest between duties</div><div class="ruleline">Overlapping duties</div><div class="ruleline">Certification validity and missing evidence</div>'}</div></div>`);
}
document.addEventListener('click',async e=>{
 const button=e.target.closest('button,[data-action]');if(!button)return;
 if(button.dataset.nav){nav(button.dataset.nav);return}
 if(button.dataset.demo){button.disabled=true;try{user=await api('/api/auth/login',{method:'POST',body:JSON.stringify({role:button.dataset.demo})});preview=null;historyQ='';historyFrom='';historyTo='';offset=0;location.hash=user.role==='scheduler'?'upload':'checks';await go()}catch(error){loginScreen(error)}finally{button.disabled=false}return}
 if(button.dataset.row){openDetails(button.dataset.row);return}
 if(button.dataset.filter){filter=button.dataset.filter;renderResult();return}
 const action=button.dataset.action;if(!action)return;
 if(action==='close-drawer'){closeDrawer();return}
 button.disabled=true;
 try{
  if(action==='logout'){pendingImport=null;importSettings={};importChoices={};await api('/api/auth/logout',{method:'POST'});generation++;uploadGeneration++;user=null;preview=null;currentRun=null;historyQ='';historyFrom='';historyTo='';offset=0;loginScreen()}
  if(action==='confirm-import'){captureImportSettings();await uploadFile(pendingImport,true)}
  if(action==='sample'){const response=await fetch('/api/templates/csv');if(!response.ok)throw new Error('Unable to load sample. Sign in again.');await uploadFile(new File([await response.blob()],'sample_roster.csv',{type:'text/csv'}))}
  if(action==='load-sample'){const name=button.dataset.sample;const response=await fetch('/samples/'+name+'.csv');if(!response.ok)throw new Error('Sample unavailable.');preview=null;route='upload';rules=await api('/api/rules');window.history.replaceState(null,'','#upload');renderUpload();await uploadFile(new File([await response.blob()],name+'.csv',{type:'text/csv'}))}
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

const sampleCases=[
 {id:'sample_roster',title:'Quick walkthrough',count:'6 duties · 4 crew',result:'3 findings',description:'A compact introduction to duty limits, rest and certification expiry.',tone:'warn'},
 {id:'review_roster',title:'A roster worth reviewing',count:'25 duties · 8 crew',result:'6 findings',description:'Three days of fictional duties with overtime, short rest, overlap and missing or expired certification.',tone:'warn'},
 {id:'clean_roster',title:'No configured flags',count:'24 duties · 8 crew',result:'0 findings',description:'A comparison roster that meets the initial demo thresholds. First-duty rest still lacks earlier context.',tone:'green'},
 {id:'input_errors',title:'Catch input mistakes',count:'2 duties · 2 crew',result:'Validation errors',description:'A timestamp without a timezone and a duty that ends when it starts. The file is rejected before checking.',tone:'red'}
];
function renderSamples(){shell(pagehead('Sample library','Fictional rosters in CSV and Excel.','','Demo resources')+`<div class="samplegrid">${sampleCases.map(c=>`<article class="card samplecard"><div class="sampletop">${icon('file')}<span class="pill ${c.tone}">${c.result}</span></div><h2>${c.title}</h2><small>${c.count}</small><p>${c.description}</p><div class="sampleactions"><button class="btn primary" data-action="load-sample" data-sample="${c.id}">Try this roster</button><a href="/samples/${c.id}.csv" download>CSV ↓</a><a href="/samples/${c.id}.xlsx" download>Excel ↓</a></div></article>`).join('')}</div>`)}
function auditValue(value){
 if(value===null||value===undefined)return 'Not supplied';
 if(Array.isArray(value))return value.map(auditValue).join(', ');
 if(typeof value==='object')return Object.entries(value).map(([key,item])=>`${key.replaceAll('_',' ')}: ${auditValue(item)}`).join('; ')||'Default settings';
 return String(value);
}
function renderAudit(items){shell(pagehead('Audit trail','Uploads, checks and rule changes.','','Manager workspace')+`<div class="card"><div class="tablewrap"><table><thead><tr><th>When · UTC</th><th>Demo role</th><th>Action</th><th>Evidence</th></tr></thead><tbody>${items.map(e=>{let details;try{details=JSON.parse(e.details)}catch{details={}}return `<tr><td class="nowrap">${date(e.created_at)}</td><td>${esc(e.actor_role)}</td><td><strong>${esc(e.action.replaceAll('.',' / ').replaceAll('_',' '))}</strong><small>${esc(e.target_id)}</small></td><td>${Object.entries(details).map(([k,v])=>`<small>${esc(k.replaceAll('_',' '))}: ${esc(auditValue(v))}</small>`).join('')}</td></tr>`}).join('')}</tbody></table></div><div class="cardfoot">Latest ${items.length} events</div></div>`)}
