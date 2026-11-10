const $ = (s, root=document) => root.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {shield:'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z"/><path d="m8 12 3 3 5-6"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',rules:'<path d="M5 4v16M12 4v16M19 4v16M2 8h6m1 8h6m1-6h6"/>',file:'<path d="M5 3h9l5 5v13H5zM14 3v5h5M8 13h8M8 17h6"/>',arrow:'<path d="M4 12h16m-5-5 5 5-5 5"/>',book:'<path d="M12 5v16M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2z"/>',plus:'<path d="M12 4v16M4 12h16"/>'};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.file}</svg>`;
let user=null, rules=null, preview=null, currentRun=null, history=null, route='', offset=0, filter='all', query='', role='all', generation=0, lastFocus=null;
let uploadGeneration=0;
let historyQ='', historyFrom='', historyTo='';
let view='table', timeline=null, zoom='fit', laneSort='findings';
let imports=null, importStatus='all', importOffset=0;
const browserZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
const validZone=z=>{try{new Intl.DateTimeFormat('en',{timeZone:z});return true}catch{return false}};
let displayZone=(()=>{try{const z=localStorage.getItem('crewcheck.displayZone');if(z&&validZone(z))return z}catch{}return browserZone})();
const zoneChoices=[...new Set([browserZone,'UTC','America/Los_Angeles','America/New_York','Europe/London','Europe/Berlin','Asia/Kolkata','Asia/Seoul','Australia/Sydney'])];
const zoomLevels=[24,48,96,144,288,576];  // px per day; 'fit' fills the available width
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),4500)}
function validationText(e){
 const loc=(e.loc||[]).filter(x=>x!=='body'),i=loc.indexOf('rules');
 const fields={reason:'Reason for this change',name:'Rule set name',rules:'Rules'};
 const where=i>=0&&typeof loc[i+1]==='number'?`Rule ${loc[i+1]+1}${loc.length>i+2?' ('+loc.slice(i+2).join(' ')+')':''}: `:(fields[loc[0]]?fields[loc[0]]+': ':'');
 return where+String(e.msg).replace(/^Value error, /,'');
}
async function api(url, options={}){
  const headers={...(options.headers||{})};
  if(user?.csrf && options.method && options.method!=='GET') headers['X-CSRF-Token']=user.csrf;
  if(options.body && !(options.body instanceof FormData)) headers['Content-Type']='application/json';
  const response=await fetch(url,{...options,headers,credentials:'same-origin'});
  let data;try{data=await response.json()}catch{throw new Error('The server returned an unreadable response.')}
  if(!response.ok){
    if(response.status===401 && !url.endsWith('/login')){user=null;loginScreen()}
    let message=typeof data.detail==='string'?data.detail:(Array.isArray(data.detail)?data.detail.map(validationText).join('; '):'Request failed.');
    const error=new Error(message);error.errors=data.errors;error.import_options=data.import_options;error.import_id=data.import_id;throw error;
  }
  return data;
}
// All times are stored in UTC and shown in the selected display zone; the zone
// abbreviation is per value, so it switches (e.g. EST/EDT) across a DST change.
function zoneAbbr(value){return new Intl.DateTimeFormat('en-US',{timeZone:displayZone,timeZoneName:'short'}).formatToParts(new Date(value)).find(p=>p.type==='timeZoneName')?.value||displayZone}
function date(value){return new Date(value).toLocaleString('en-GB',{timeZone:displayZone,day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})+' '+zoneAbbr(value)}
function shortDate(value){return new Date(value).toLocaleString('en-GB',{timeZone:displayZone,day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})+' '+zoneAbbr(value)}
function zoneHead(){return esc(displayZone)}
function zonePicker(){return `<label class="zonepick" title="Times are stored in UTC and shown in this zone">${icon('clock')}<select id="display-zone" aria-label="Display time zone">${zoneChoices.map(z=>`<option value="${esc(z)}" ${z===displayZone?'selected':''}>${esc(z)}${z===browserZone?' (browser)':''}</option>`).join('')}</select></label>`}
function hours(row){return ((new Date(row.duty_end)-new Date(row.duty_start))/3600000).toFixed(2).replace(/\.?0+$/,'')}
function shell(content){
 const manager=user.role==='manager';
 $('#app').innerHTML=`<div class="layout"><aside class="sidebar"><div class="brand">${icon('shield')}CrewCheck</div><div class="navlabel">Workspace</div><nav><button data-nav="checks" class="${route==='checks'||route.startsWith('run/')?'active':''}">${icon('grid')}${manager?'Check history':'My roster checks'}</button><button data-nav="upload" class="${route==='upload'?'active':''}">${icon('upload')}Load roster</button><button data-nav="imports" class="${route==='imports'?'active':''}">${icon('file')}Import log</button><div class="navgap"></div><button data-nav="rules" class="${route==='rules'?'active':''}">${icon('rules')}${manager?'Rules & thresholds':'Active rule set'}</button><a class="navlink" href="/documentation" target="_blank" rel="noopener">${icon('book')}Architecture & guide</a></nav></aside><main class="main"><header class="topbar"><div class="breadcrumb">${icon('grid')}Crew planning workspace</div><div class="profile">${zonePicker()}<span class="badge">DEMO</span><span class="avatar">${esc(user.name.split(' ').map(x=>x[0]).join(''))}</span><span>${esc(user.name)}<small>${esc(user.role)}</small></span><button class="textbutton" data-action="logout">Sign out</button></div></header><div class="content">${content}</div></main></div>`;
}
function pagehead(title,subtitle,actions='',kicker='Roster review'){return `<div class="pagehead"><div><p class="kicker">${kicker}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="actions">${actions}</div></div>`}
function errHTML(error){return `<div class="error" role="alert">${esc(error.message)}${error.errors?`<ul>${error.errors.map(e=>`<li>${e.row?'Row '+e.row+': ':''}${esc(e.message)}</li>`).join('')}</ul>`:''}${error.import_id?`<p>This attempt and its original file are saved in the <a href="#imports">Import log</a>.</p>`:''}</div>`}
function metrics(items){return `<div class="metrics">${items.map(([label,value,hint,warn])=>`<div class="card metric ${warn?'attention':''}"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`).join('')}</div>`}
function loginScreen(error=''){
 $('#drawer-root').innerHTML='';
 $('#app').innerHTML=`<main class="login"><section class="loginintro"><div class="brand">${icon('shield')}CrewCheck</div><div class="line"></div><h1>A clearer view<br>of every duty.</h1><p>Review rosters, findings and saved checks.</p></section><section class="loginform"><div><span class="badge">LOCAL DEMO</span><h2>Welcome to CrewCheck</h2><p class="subtitle">Sign in to your crew planning workspace.</p><form id="login-form"><div class="field"><label for="email">Email address</label><input type="email" id="email" name="email" autocomplete="username" required placeholder="you@crewcheck.local"></div><div class="field"><label for="password">Password</label><input type="password" id="password" name="password" autocomplete="current-password" required></div><div id="login-error">${error?errHTML(error):''}</div><button class="btn primary" type="submit">Sign in ${icon('arrow')}</button></form><div class="demologin"><p>Try the two demo roles</p><div class="actions"><button class="btn" data-demo="scheduler">Scheduler</button><button class="btn" data-demo="manager">Manager</button></div><p>Choose a demo account, then sign in.<br><a href="/documentation" target="_blank" rel="noopener">View architecture and demo guide</a></p></div></div></section></main>`;
}
function nav(target){if(location.hash==='#'+target)go();else location.hash=target}
async function go(){
 if(!user)return;
 const g=++generation;route=location.hash.slice(1)||'checks';
 if(!['checks','upload','rules','imports'].includes(route)&&!/^run\/[a-f0-9]{24}$/.test(route)){route='checks';window.history.replaceState(null,'','#checks')}
 try{
  if(!catalog)catalog=await api('/api/rules/catalog');
  if(route==='upload'){rules=await api('/api/rules');if(g!==generation)return;renderUpload()}
  else if(route==='imports'){imports=await api(`/api/imports?${new URLSearchParams({status:importStatus,offset:importOffset})}`);if(g!==generation)return;renderImports()}
  else if(route==='rules'){rules=await api('/api/rules');if(user.role==='manager'){ruleRevisions=await api('/api/rules/history');previewRuns=(await api('/api/runs')).items}if(g!==generation)return;renderRules()}
  else if(route.startsWith('run/')){currentRun=await api('/api/runs/'+route.split('/')[1]);if(view==='timeline')await loadTimeline();if(g!==generation)return;filter='all';query='';role='all';renderResult()}
  else{history=await api(`/api/runs?${new URLSearchParams({q:historyQ,from_date:historyFrom,to_date:historyTo,offset})}`);if(g!==generation)return;renderHistory()}
 }catch(error){if(user)shell(pagehead('Unable to open this view','Your saved data has not changed.')+errHTML(error)+`<button class="btn" data-action="reload">Try again</button>`)}
}
function renderHistory(){
 const manager=user.role==='manager',items=history.items;
 shell(pagehead(manager?'Check history':'My roster checks',manager?'Saved checks and their applied rules.':'Your saved roster checks.',`<button class="btn primary" data-nav="upload">${icon('plus')}Load roster</button>`)+
 `<div class="card"><form id="history-filter" class="toolbar"><input type="search" name="q" aria-label="Search filenames" placeholder="Search by filename" value="${esc(historyQ)}"><label>From <input type="date" name="from" value="${esc(historyFrom)}"></label><label>To <input type="date" name="to" value="${esc(historyTo)}"></label><button class="btn" type="submit">Apply filters</button><button class="textbutton" type="button" data-action="clear-history">Clear</button></form>${items.length?`<div class="tablewrap"><table><thead><tr><th>Roster file</th><th>Checked at · ${zoneHead()}</th>${manager?'<th>Uploaded by</th>':''}<th>Duties</th><th>Findings</th><th>Rule version</th><th></th></tr></thead><tbody>${items.map(r=>`<tr><td><strong>${esc(r.filename)}</strong><small>${r.summary.crew} crew members</small></td><td class="nowrap">${date(r.created_at)}</td>${manager?`<td>${esc(r.owner)}</td>`:''}<td>${r.summary.duties}</td><td><span class="pill ${r.summary.findings?'warn':'green'}">${r.summary.findings?r.summary.findings+' findings':'No flags'}</span></td><td><strong>v${r.rules.version} · ${esc(r.rules.name)}</strong><small>${r.rules.rules.filter(x=>x.enabled).length} active rules</small></td><td><button class="btn small" data-nav="run/${r.id}">View check</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty">${icon('file')}<h2>${history.total?'No matching checks':'Your first check starts here'}</h2><p>${historyQ||historyFrom||historyTo?'Try a different filename or date range.':'Upload a roster to start your first check.'}</p><button class="btn primary" data-nav="upload">${icon('upload')}Load a roster</button></div>`}<div class="cardfoot"><span>${history.total} checks · showing ${items.length?offset+1:0}–${offset+items.length}</span><div class="actions"><button class="btn small" data-action="prev-page" ${offset===0?'disabled':''}>Previous</button><button class="btn small" data-action="next-page" ${offset+25>=history.total?'disabled':''}>Next</button></div></div></div>`);
}
function sizeText(n){return n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB'}
const importBadge={accepted:['green','Accepted'],rejected:['red','Rejected'],needs_setup:['warn','Needs setup']};
function importDetail(i){
 if(i.status==='accepted')return `${i.row_count} duties${i.run_id?'':' · not checked yet'}`;
 if(i.status==='needs_setup'){const o=i.import_options||{};return `Waiting for ${[o.worksheets&&'worksheet',o.needs_mapping&&'column mapping',o.needs_timezone&&'time zone'].filter(Boolean).join(', ')||'import'} choice`}
 return `<details class="importerrors"><summary>${i.errors.length} issue${i.errors.length===1?'':'s'}</summary><ul>${i.errors.map(e=>`<li>${e.row?'Row '+e.row+': ':''}${esc(e.message)}</li>`).join('')}</ul></details>`;
}
function renderImports(){
 const manager=user.role==='manager',items=imports.items;
 shell(pagehead('Import log',manager?'Every upload attempt, including rejected files, with the original file.':'Your upload attempts, including rejected files, with the original file.',`<button class="btn primary" data-nav="upload">${icon('plus')}Load roster</button>`)+
 `<div class="card"><div class="toolbar"><label>Status <select id="import-status" aria-label="Filter by import status">${[['all','All attempts'],['accepted','Accepted'],['rejected','Rejected'],['needs_setup','Needs setup']].map(([v,l])=>`<option value="${v}" ${importStatus===v?'selected':''}>${l}</option>`).join('')}</select></label></div>${items.length?`<div class="tablewrap"><table><thead><tr><th>File</th><th>Attempted at · ${zoneHead()}</th>${manager?'<th>Uploaded by</th>':''}<th>Status</th><th>Details</th><th></th></tr></thead><tbody>${items.map(i=>`<tr><td><strong>${esc(i.filename)}</strong><small>${sizeText(i.size)}${i.file_hash?` · SHA-256 <span class="mono">${esc(i.file_hash.slice(0,12))}…</span>`:''}</small></td><td class="nowrap">${date(i.created_at)}</td>${manager?`<td>${esc(i.owner)}</td>`:''}<td><span class="pill ${importBadge[i.status][0]}">${importBadge[i.status][1]}</span></td><td>${importDetail(i)}</td><td><div class="actions">${i.stored?`<a class="btn small" href="/api/imports/${esc(i.id)}/file" download>Original file</a>`:'<small>File not stored (over size limit)</small>'}${i.run_id?`<button class="btn small" data-nav="run/${esc(i.run_id)}">View check</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty">${icon('file')}<h2>No import attempts${importStatus==='all'?' yet':' with this status'}</h2><p>Every upload, accepted or rejected, is recorded here.</p></div>`}<div class="cardfoot"><span>${imports.total} attempts · showing ${items.length?importOffset+1:0}–${importOffset+items.length}</span><div class="actions"><button class="btn small" data-action="imports-prev" ${importOffset===0?'disabled':''}>Previous</button><button class="btn small" data-action="imports-next" ${importOffset+25>=imports.total?'disabled':''}>Next</button></div></div></div>`);
}
function policyCard(policy){return `<div class="card pad"><div class="actions"><h2>Rule set</h2><span class="pill blue">v${policy.version}</span></div><p class="subtitle">${esc(policy.name)}</p>${ruleList(policy)}</div>`}
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
 shell(pagehead('Load a roster','Preview your source records before running a check.',`<span class="pill blue">CSV / XLSX</span>`)+`<div class="uploadgrid"><section class="card pad"><h2>Roster file</h2><p class="subtitle">Select a CSV or Excel file.</p><div class="droptarget" id="dropzone"><div>${icon('upload')}<h3>Drop your roster here</h3><p>CSV or Excel (.xlsx)</p><label class="btn" for="roster-file">Browse files</label><input id="roster-file" type="file" accept=".csv,.xlsx" aria-label="Select roster file"><button class="btn primary" data-action="sample">Use sample roster</button></div></div><div class="underupload"><span>Download a sample: <a href="/api/templates/csv">CSV</a> / <a href="/api/templates/xlsx">Excel</a></span></div><div id="upload-error">${error?errHTML(error):''}</div>${importSetup()}${preview?`<div class="filelabel">${icon('file')}<div><strong>${esc(preview.filename)}</strong><small>${preview.row_count} duties / ${preview.crew_count} crew members / normalized to UTC${preview.import_settings?.worksheet?' / '+esc(preview.import_settings.worksheet):''}${preview.import_settings?.timezone?' / source zone: '+esc(preview.import_settings.timezone):''}</small></div></div>${preview.dst_adjusted_rows?`<div class="callout warn dstnote">${preview.dst_adjusted_rows} row${preview.dst_adjusted_rows>1?'s have times':' has a time'} inside a daylight-saving clock change. The stricter reading was used automatically (earliest start, latest end, earliest certification expiry). Open the row details after checking to see each adjustment.</div>`:''}<div class="previewtitle"><h3>Data preview</h3><small>${preview.preview.length} of ${preview.row_count} rows</small></div><div class="tablewrap"><table><thead><tr><th>Crew</th><th>Duty</th><th>Start · ${zoneHead()}</th><th>End · ${zoneHead()}</th></tr></thead><tbody>${preview.preview.map(r=>`<tr><td>${esc(r.crew_name)}<small>${esc(r.crew_id)} / ${esc(r.role)}</small></td><td>${esc(r.duty_id)}</td><td class="nowrap">${shortDate(r.duty_start)}</td><td class="nowrap">${shortDate(r.duty_end)}</td></tr>`).join('')}</tbody></table></div><div class="cardfoot"><span>Applied rule set: v${selected.version}</span><button class="btn primary" data-action="run">Run roster check ${icon('arrow')}</button></div>`:`<p class="note">Missing certification expiry is flagged.</p>`}</section>${policyCard(selected)}</div>`);
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
function resultRows(){const rows=matchingRows();return rows.map(r=>{const flags=currentRun.flags.filter(f=>f.row_number===r.row_number);return `<tr><td><strong>${esc(r.crew_name)}</strong><small>${esc(r.crew_id)} / ${esc(r.role)}</small></td><td>${esc(r.duty_id)}</td><td class="nowrap">${shortDate(r.duty_start)}<small>to ${shortDate(r.duty_end)}${r.dst_adjustments?' <span class="pill blue" title="Daylight-saving time resolved automatically">DST</span>':''}</small></td><td>${hours(r)} h</td><td>${flags.length?flags.map(f=>`<span class="pill ${f.severity==='incomplete'?'red':'warn'}">${esc(f.title)}</span>`).join(' '):'<span class="pill green">No flags</span>'}</td><td><button class="btn small" data-row="${r.row_number}">Details</button></td></tr>`}).join('')||'<tr><td colspan="6">No duties match these filters.</td></tr>'}
function countText(){return view==='timeline'?`${timelineLanes().length} of ${timeline.crew.length} crew members`:`${matchingRows().length} of ${currentRun.summary.duties} duties`}
function refreshRows(){
 if(view==='timeline'){const body=$('#timeline-body');if(!body)return;body.innerHTML=timelineHTML();placeTimeline()}
 else{const body=$('#result-body');if(!body)return;body.innerHTML=resultRows()}
 $('#rows-count').textContent=countText();
}
async function loadTimeline(){
 if(timeline?.run===currentRun.id&&timeline.zone===displayZone)return;
 const id=currentRun.id,zone=displayZone,data=await api(`/api/runs/${id}/timeline?${new URLSearchParams({tz:zone})}`);
 if(currentRun?.id===id&&displayZone===zone)timeline={...data,run:id};
}
function timelineLanes(){
 const q=query.toLowerCase();
 const lanes=timeline.crew.filter(l=>(filter==='all'||l.findings)&&(role==='all'||l.role===role)&&(!q||[l.crew_id,l.crew_name,...l.duties.map(d=>d.duty_id)].some(v=>v.toLowerCase().includes(q))));
 return laneSort==='crew'?[...lanes].sort((a,b)=>a.crew_id.localeCompare(b.crew_id)):lanes;
}
const statusLabel={ok:'No flags',review:'Needs review',incomplete:'Incomplete evidence'};
const gapLabel={short_rest:'Insufficient rest',overlap:'Duties overlap'};
function dayLabel(value){return new Date(value+'T00:00:00Z').toLocaleDateString('en-GB',{timeZone:'UTC',weekday:'short',day:'2-digit',month:'short'})}
function dayLength(d){return d.hours===24?'':` <span class="pill blue" title="Clock change in ${esc(displayZone)}: this day has ${d.hours} hours">${d.hours} h</span>`}
// Overlapping duties for one crew member get their own row so none is hidden.
function laneSlots(duties){const ends=[];return {slots:duties.map(d=>{let i=ends.findIndex(end=>end<=Date.parse(d.start));if(i<0)i=ends.push(0)-1;ends[i]=Date.parse(d.end);return i}),count:Math.max(ends.length,1)}}
function timelineHTML(){
 const lanes=timelineLanes();
 if(!timeline.crew.length)return '<p class="tlempty">This check has no duties.</p>';
 return `<div class="tlgrid" role="table" aria-label="Duty timeline by crew member, times in ${esc(displayZone)}"><div class="tllines" aria-hidden="true">${timeline.days.map(d=>`<span class="tlline" data-at="${d.start}"></span>`).join('')}</div><div class="tlhead" role="row"><div class="tlcorner" role="columnheader">Crew member</div><div class="tldays">${timeline.days.map(d=>`<div class="tlday ${d.findings?'hot':''}" role="columnheader" data-start="${d.start}" data-end="${d.end}"><span>${dayLabel(d.date)}${dayLength(d)}</span>${d.findings?`<span class="pill red" title="${d.findings} findings on duties starting this day">${d.findings}</span>`:''}</div>`).join('')}</div></div>${lanes.map(l=>`<div class="tllane ${l.findings?'hasissues':''}" role="row"><div class="tlcrew" role="rowheader"><div><strong>${esc(l.crew_name)}</strong><small>${esc(l.crew_id)} · ${esc(l.role)}</small></div>${l.findings?`<span class="tlcount" title="${l.findings} finding${l.findings>1?'s':''}">${l.findings}</span>`:''}</div><div class="tltrack" role="cell" data-slots="${(l.layout=laneSlots(l.duties)).count}">${l.gaps.map(g=>`<span class="tlgap ${g.kind}" data-start="${g.start}" data-end="${g.end}" title="${esc(gapLabel[g.kind])}: ${esc(g.observed)} between ${esc(g.previous_duty_id)} and ${esc(g.duty_id)}"></span>`).join('')}${l.duties.map((d,i)=>`<button class="tlduty ${d.status}" data-slot="${l.layout.slots[i]}" data-row="${d.row_number}" data-start="${d.start}" data-end="${d.end}" title="${esc(d.duty_id)} · ${shortDate(d.start)} – ${shortDate(d.end)} · ${d.hours} h${d.codes.length?' · '+esc(d.codes.join(', ')):''}" aria-label="${esc(l.crew_name)} ${esc(d.duty_id)}, ${shortDate(d.start)} to ${shortDate(d.end)}, ${statusLabel[d.status]}">${esc(d.duty_id)}</button>`).join('')}</div></div>`).join('')||'<p class="tlempty">No crew members match these filters.</p>'}</div>`;
}
function dayWidth(){
 // Pixels per 24 h. 'fit' spreads the whole date range across the visible width.
 const grid=$('.tlgrid');if(zoom!=='fit'||!grid)return zoom;
 const crew=$('.tlcorner',grid)?.offsetWidth||0,hours=(Date.parse(timeline.end)-Date.parse(timeline.start))/3600000;
 return Math.max((grid.parentElement.clientWidth-crew-1)/hours*24,24);
}
function placeTimeline(){
 // Positions are set through CSSOM because the CSP forbids inline style attributes.
 const grid=$('.tlgrid');if(!grid)return;
 const origin=Date.parse(timeline.start),perHour=dayWidth()/24;
 grid.style.setProperty('--width',(Date.parse(timeline.end)-origin)/3600000*perHour+'px');
 for(const line of grid.querySelectorAll('[data-at]'))line.style.left=(Date.parse(line.dataset.at)-origin)/3600000*perHour+'px';
 const bar=30,step=31,pad=6;
 for(const track of grid.querySelectorAll('.tltrack')){
  const rows=Number(track.dataset.slots);track.style.height=pad*2+(rows-1)*step+bar+'px';
  for(const duty of track.querySelectorAll('.tlduty'))duty.style.top=pad+Number(duty.dataset.slot)*step+'px';
 }
 for(const el of grid.querySelectorAll('[data-start]')){const from=Date.parse(el.dataset.start),to=Date.parse(el.dataset.end);el.style.left=(from-origin)/3600000*perHour+'px';el.style.width=Math.max((to-from)/3600000*perHour,3)+'px'}
}
function timelineTools(){return `<div class="tltools"><div class="tllegend"><span><i class="ok"></i>No flags</span><span><i class="review"></i>Needs review</span><span><i class="incomplete"></i>Incomplete evidence</span><span><i class="short_rest"></i>Insufficient rest</span><span><i class="overlap"></i>Overlap</span></div><span class="filtersgrow"></span><select id="lane-sort" aria-label="Sort crew members"><option value="findings" ${laneSort==='findings'?'selected':''}>Most findings first</option><option value="crew" ${laneSort==='crew'?'selected':''}>Crew ID</option></select><div class="segmented" role="group" aria-label="Timeline zoom"><button class="btn" data-action="zoom" data-zoom="-1" aria-label="Zoom out">−</button><button class="btn ${zoom==='fit'?'active':''}" data-action="zoom" data-zoom="fit" aria-pressed="${zoom==='fit'}">Fit</button><button class="btn" data-action="zoom" data-zoom="1" aria-label="Zoom in">+</button></div></div>`}
function appliedRuleCard(policy){return `<section class="card pad appliedrules" aria-labelledby="applied-rule-title"><div class="appliedruleshead"><div><p class="kicker">SAVED WITH THIS CHECK</p><h2 id="applied-rule-title">Applied rule set</h2><p class="subtitle">${esc(policy.name)}</p></div><span class="pill blue">Version ${policy.version}</span></div>${ruleList(policy)}<details class="appliedrulemeta"><summary>Rule version details</summary><p>Created ${date(policy.created_at)} · ${esc(policy.created_by)}</p><p><strong>Reason:</strong> ${esc(policy.reason)}</p></details></section>`}
function renderResult(){
 const r=currentRun,s=r.summary;
 shell(pagehead('Roster check',`${esc(r.filename)} · Checked ${date(r.created_at)}`, `${r.import_id?`<a class="btn" href="/api/imports/${esc(r.import_id)}/file" download>Original file</a>`:''}<button class="btn" data-nav="checks">Back to checks</button><button class="btn primary" data-nav="upload">New check</button>`)+
 appliedRuleCard(r.rules)+
 metrics([['Duties checked',s.duties,'in this roster'],['Duties flagged',s.flagged_duties,'need a human look',true],['Findings',s.findings,'with evidence',true],['Crew members',s.crew,'in this roster']])+
 `<div class="card"><div class="tabbar"><button class="tab ${filter==='all'?'active':''}" data-filter="all">All duties <span>${s.duties}</span></button><button class="tab ${filter==='flagged'?'active':''}" data-filter="flagged">Flagged <span>${s.flagged_duties}</span></button></div><div class="toolbar"><input type="search" id="crew-search" aria-label="Search crew or duty" placeholder="Search crew or duty ID" value="${esc(query)}"><select id="role-filter" aria-label="Filter crew role"><option value="all" ${role==='all'?'selected':''}>All roles</option><option value="pilot" ${role==='pilot'?'selected':''}>Pilots</option><option value="cabin" ${role==='cabin'?'selected':''}>Cabin crew</option></select><span class="filtersgrow"></span><div class="segmented" role="group" aria-label="Result view"><button class="btn ${view==='table'?'active':''}" data-action="view" data-view="table" aria-pressed="${view==='table'}">Table</button><button class="btn ${view==='timeline'?'active':''}" data-action="view" data-view="timeline" aria-pressed="${view==='timeline'}">Timeline</button></div><span class="pill blue">Rule snapshot v${r.rules.version}</span></div>${view==='timeline'?`${timelineTools()}<div class="tlscroll" id="timeline-body">${timelineHTML()}</div>`:`<div class="tablewrap"><table><thead><tr><th>Crew member</th><th>Duty</th><th>Schedule · ${zoneHead()}</th><th>Duration</th><th>Findings</th><th></th></tr></thead><tbody id="result-body">${resultRows()}</tbody></table></div>`}<div class="cardfoot"><span id="rows-count">${countText()}</span><span>Uploaded by ${esc(r.owner)}</span></div></div>`);
 if(view==='timeline')placeTimeline();
}
function isInstant(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)}
function when(v){return `${esc(date(v))}<small class="utc">${esc(v)}</small>`}
const fieldLabel={duty_start:'Duty start',duty_end:'Duty end',certification_expires_at:'Certification expiry'};
function dstText(n){return `${fieldLabel[n.field]||n.field} ${esc(n.local)} ${n.kind==='repeated'?'occurs twice':'does not exist'} in ${esc(n.zone)} because of a clock change. The ${n.choice} reading was used: ${esc(date(n.utc))}.`}
function openDetails(rowNumber){
 const row=currentRun.rows.find(r=>r.row_number===Number(rowNumber)),flags=currentRun.flags.filter(f=>f.row_number===Number(rowNumber));lastFocus=document.activeElement;
 const label=k=>({duty_start:'Duty starts',duty_end:'Duty ends',difference_hours:'Hours over limit',previous_duty_id:'Previous duty',previous_duty_end:'Previous duty ends',next_duty_start:'Next duty starts',assessment_time:'Validity assessed at',certification_expires_at:'Certification expires',remaining_hours:'Validity left (hours)',day:'Calendar day',zone:'Time zone',duties:'Duties counted',window_start:'Window starts',window_end:'Window ends',first_day:'First day in the run',last_day:'Last day in the run'}[k]||k);
 $('#drawer-root').innerHTML=`<div class="drawerbackdrop" data-action="close-drawer"></div><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabindex="-1"><button class="drawerclose" data-action="close-drawer" aria-label="Close details">×</button><p class="kicker">Finding details</p><h2 id="drawer-title">${esc(row.crew_name)}</h2><p class="subtitle">${esc(row.crew_id)} / ${esc(row.duty_id)} · Source row ${row.row_number}${row.source_sheet?' / '+esc(row.source_sheet):''}${row.source_timezone?' / source zone: '+esc(row.source_timezone):''}</p><span class="pill ${flags.length?'warn':'green'}">${flags.length?'Needs review':'No flags'}</span>${row.dst_adjustments?`<div class="callout warn dstnote"><strong>Daylight-saving adjustment</strong><ul>${row.dst_adjustments.map(n=>`<li>${dstText(n)}</li>`).join('')}</ul></div>`:''}${flags.length?flags.map(f=>`<section class="flagblock"><h3>${esc(f.title)}</h3><div class="readings"><div class="reading"><small>Observed</small><strong>${esc(f.observed)}</strong></div><div class="reading"><small>Expected</small><strong>${esc(f.expected)}</strong></div></div><div class="evidence"><dl>${Object.entries(f.evidence).map(([k,v])=>`<dt>${label(k)}</dt><dd>${isInstant(v)?when(v):esc(Array.isArray(v)?v.join(', '):v)}</dd>`).join('')}</dl></div><p class="note">${esc(f.code)} · Rule snapshot v${currentRun.rules.version}</p></section>`).join(''):`<div class="evidence"><dl><dt>Duty starts</dt><dd>${when(row.duty_start)}</dd><dt>Duty ends</dt><dd>${when(row.duty_end)}</dd><dt>Certification expires</dt><dd>${row.certification_expires_at?when(row.certification_expires_at):'Not supplied'}</dd></dl></div>`}<div class="drawerfoot">Check ${esc(currentRun.id)}<br>Engine ${esc(currentRun.engine_version)}<br>Source SHA-256<br><span class="mono">${esc(currentRun.file_hash)}</span></div></section>`;
 $('.drawerclose').focus();
}
function closeDrawer(){$('#drawer-root').innerHTML='';lastFocus?.focus()}
// ---- Rule builder: managers assemble rules from fixed parts; the server validates and the engine evaluates them.
const opSymbol={'<=':'≤','<':'<','>=':'≥','>':'>'};
const dayNames=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const conditionDefaults={start_time:['22:00','05:00'],end_time:['22:00','05:00'],overlaps_time:['02:00','05:59'],weekday:[5,6],crew_id:[]};
function condText(c){
 if(c.field==='weekday')return `start on ${c.value.map(d=>dayNames[d]).join(', ')||'(no days)'}`;
 if(c.field==='crew_id')return `belong to ${c.value.join(', ')||'(no crew IDs)'}`;
 const [a,b]=c.value;return {start_time:`start ${a}–${b}`,end_time:`end ${a}–${b}`,overlaps_time:`touch ${a}–${b}`}[c.field];
}
function ruleSentence(r){
 const m=catalog.measures[r.measure],limit=`${opSymbol[r.compare]} ${r.limit} ${m.unit}`;
 const which=r.when.length?`, duties that ${r.when.map(condText).join(' and ')}`:'';
 let what;
 if(r.measure==='certification_remaining_hours')what=r.limit===0&&r.compare==='>='?`certification valid through duty ${r.at}`:`certification validity left after duty ${r.at} ${limit}`;
 else if(r.measure==='overlap_hours'&&r.limit===0&&r.compare==='<=')what='no overlap with the next duty';
 else what=`${m.label.toLowerCase()} ${r.per==='rolling_days'?`in any ${r.window_days} days`:catalog.periods[r.per]} ${limit}`;
 const local=r.when.some(c=>c.field!=='crew_id')||['day','streak'].includes(r.per);
 return `${catalog.roles[r.role]}${which}: ${what}${local?` (${r.zone} time)`:''}`;
}
function ruleList(policy){const on=policy.rules.filter(r=>r.enabled),off=policy.rules.length-on.length;return `<ul class="rulelist">${on.map(r=>`<li><strong>${esc(r.name)}</strong><span>${esc(ruleSentence(r))}</span></li>`).join('')}</ul>${off?`<p class="note">${off} rule${off>1?'s':''} switched off.</p>`:''}`}
let catalog=null,ruleDraft=null,ruleRevisions=[],previewRuns=[],impact=null;
function uniqueCode(base){const codes=new Set(ruleDraft.rules.map(r=>r.code));base=base.slice(0,36);let code=base,n=2;while(codes.has(code))code=`${base}_${n++}`;return code}
function ruleEditor(r,i){
 const m=catalog.measures[r.measure],id=k=>`r${i}-${k}`,attrs=k=>`id="${id(k)}" data-r="${i}" data-k="${k}"`;
 const sel=(k,opts,val,label)=>`<label class="rf"><span>${label}</span><select ${attrs(k)}>${Object.entries(opts).map(([v,l])=>`<option value="${esc(v)}" ${String(val)===String(v)?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
 const measures=Object.fromEntries(Object.entries(catalog.measures).map(([k,v])=>[k,v.label]));
 const periods=Object.fromEntries(m.per.map(p=>[p,catalog.periods[p]]));
 const zones=Object.fromEntries([...new Set([r.zone,...zoneChoices])].map(z=>[z,z]));
 return `<section class="rulecard ${r.enabled?'':'off'}" aria-label="Rule ${i+1}"><div class="rulecardhead"><label class="switch"><input type="checkbox" ${attrs('enabled')} ${r.enabled?'checked':''}>On</label><input class="rulename" ${attrs('name')} value="${esc(r.name)}" maxlength="80" aria-label="Rule name"><span class="pill" title="Finding code">${esc(r.code)}</span><button type="button" class="textbutton" data-action="rule-remove" data-r="${i}">Remove</button></div>
 <div class="rulefields">${sel('role',catalog.roles,r.role,'Who')}${sel('measure',measures,r.measure,'Measure')}${sel('per',periods,r.per,'Checked')}${sel('compare',catalog.compare,r.compare,'Must be')}<label class="rf"><span>Limit (${esc(m.unit)})</span><input type="number" ${attrs('limit')} min="${m.min}" max="${m.max}" step="any" value="${r.limit}"></label>${sel('zone',zones,r.zone,'Local time zone')}${r.per==='rolling_days'?`<label class="rf"><span>Window (days)</span><input type="number" ${attrs('window_days')} min="1" max="90" step="1" value="${r.window_days??''}"></label>`:''}${r.measure==='certification_remaining_hours'?sel('at',{end:'Duty end',start:'Duty start'},r.at,'Measured from'):''}</div>
 <div class="conditions"><span class="rflabel">Only duties that…</span>${r.when.map((c,j)=>conditionEditor(c,i,j)).join('')}<div class="conditionfoot">${r.when.length?'':'<span class="note">All duties</span>'}<button type="button" class="btn small" data-action="cond-add" data-r="${i}" ${r.when.length>=5?'disabled':''}>+ Condition</button></div></div>
 <p class="rulesentence" id="${id('sentence')}">${esc(ruleSentence(r))}</p></section>`;
}
function conditionEditor(c,i,j){
 const base=`data-r="${i}" data-c="${j}"`,kind=catalog.conditions[c.field].kind;
 let value;
 if(kind==='time_range')value=`<input type="time" id="r${i}-c${j}-0" ${base} data-v="0" value="${esc(c.value[0])}" aria-label="From"><span>–</span><input type="time" id="r${i}-c${j}-1" ${base} data-v="1" value="${esc(c.value[1])}" aria-label="To">`;
 else if(kind==='weekdays')value=dayNames.map((d,n)=>`<label class="day"><input type="checkbox" id="r${i}-c${j}-d${n}" ${base} data-day="${n}" ${c.value.includes(n)?'checked':''}>${d}</label>`).join('');
 else value=`<input id="r${i}-c${j}-list" ${base} data-list value="${esc(c.value.join(', '))}" placeholder="Crew IDs, comma separated" aria-label="Crew IDs">`;
 return `<div class="condition"><select id="r${i}-c${j}-field" ${base} data-cf aria-label="Condition">${Object.entries(catalog.conditions).map(([k,v])=>`<option value="${k}" ${k===c.field?'selected':''}>${esc(v.label)}</option>`).join('')}</select>${value}<button type="button" class="textbutton" data-action="cond-remove" ${base} aria-label="Remove condition">×</button></div>`;
}
function impactHTML(){
 if(!impact)return '';const d=impact;
 return `<div class="impactbox"><div class="impactnums"><div><small>Saved check</small><strong>${d.saved.findings}</strong></div><div><small>With draft rules</small><strong>${d.proposed.findings}</strong></div><div><small>Newly flagged</small><strong class="up">+${d.added}</strong></div><div><small>No longer flagged</small><strong class="down">−${d.removed}</strong></div></div><table><thead><tr><th>Rule</th><th>Findings</th></tr></thead><tbody>${d.by_rule.map(r=>`<tr><td>${esc(r.name)}${r.enabled?'':' <small>(off)</small>'}</td><td>${r.findings}</td></tr>`).join('')}${d.evidence_missing?`<tr><td>Certification evidence missing</td><td>${d.evidence_missing}</td></tr>`:''}</tbody></table>${d.examples.length?`<h4>Examples of new findings</h4><ul>${d.examples.map(f=>`<li><strong>${esc(f.crew_id)} / ${esc(f.duty_id)}</strong> · ${esc(f.title)}: ${esc(f.observed)} (expected ${esc(f.expected)})</li>`).join('')}</ul>`:''}</div>`;
}
function renderRules(){
 if(user.role!=='manager'){shell(pagehead('Active rule set','The rules currently used for new uploads.',`<span class="pill blue">Version ${rules.version}</span>`,'Rule management')+`<div class="card pad"><h2>${esc(rules.name)}</h2>${ruleList(rules)}</div>`);return}
 if(!ruleDraft)ruleDraft={name:rules.name,reason:'',rules:structuredClone(rules.rules)};
 shell(pagehead('Rules & thresholds','Build rules from plain-language parts. Saving creates a new version for future uploads; completed checks keep their original rules.',`<span class="pill blue">Version ${rules.version}</span>`,'Rule management')+
 `<div class="rulesgrid"><div class="card pad"><form id="rules-form" novalidate><div class="field"><label for="ruleset-name">Rule set name</label><input id="ruleset-name" data-set="name" minlength="3" maxlength="80" value="${esc(ruleDraft.name)}"></div><div id="rule-editors">${ruleDraft.rules.map(ruleEditor).join('')||'<p class="note">Add at least one rule.</p>'}</div>
 <div class="addrule"><select id="preset" aria-label="Rule template">${catalog.presets.map((p,n)=>`<option value="${n}">${esc(p.name)}</option>`).join('')}</select><button type="button" class="btn" data-action="rule-add" ${ruleDraft.rules.length>=30?'disabled':''}>${icon('plus')}Add rule</button></div>
 <section class="impact"><h3>Preview impact</h3><p class="note">Apply the draft rules to a saved check. Nothing is saved.</p><div class="actions"><select id="impact-run" aria-label="Saved check">${previewRuns.length?previewRuns.map(r=>`<option value="${esc(r.id)}">${esc(r.filename)} · ${date(r.created_at)}</option>`).join(''):'<option value="">No saved checks yet</option>'}</select><button type="button" class="btn" data-action="rule-preview" ${previewRuns.length?'':'disabled'}>Preview</button></div><div id="impact-result">${impactHTML()}</div></section>
 <div class="field"><label for="reason">Reason for this change</label><input id="reason" data-set="reason" maxlength="400" value="${esc(ruleDraft.reason)}" placeholder="Record why the rules are changing"></div><div id="rules-error"></div><div class="actions"><button type="submit" class="btn primary">Save new version ${icon('arrow')}</button><button type="button" class="textbutton" data-action="rule-reset">Discard changes</button></div></form></div>
 <div class="card pad"><h2>Version history</h2>${ruleRevisions.map(v=>`<div class="logentry"><strong>v${v.version} · ${esc(v.name)}</strong><small>${date(v.created_at)} · ${esc(v.created_by)}</small><p>${esc(v.reason)}</p><details><summary>${v.rules.filter(r=>r.enabled).length} active rules</summary>${ruleList(v)}</details></div>`).join('')}</div></div>`);
}
function rerenderRules(){const focus=document.activeElement?.id;renderRules();if(focus)document.getElementById(focus)?.focus()}
// Returns true when the edit changes which controls are shown.
function editRule(el){
 if(el.dataset.set){ruleDraft[el.dataset.set]=el.value;return false}
 const r=ruleDraft.rules[Number(el.dataset.r)];
 if(el.dataset.c!==undefined){
  const c=r.when[Number(el.dataset.c)];
  if('cf' in el.dataset){c.field=el.value;c.value=structuredClone(conditionDefaults[el.value]);return true}
  if(el.dataset.v!==undefined)c.value[Number(el.dataset.v)]=el.value;
  else if(el.dataset.day!==undefined){const n=Number(el.dataset.day);c.value=el.checked?[...new Set([...c.value,n])].sort((a,b)=>a-b):c.value.filter(x=>x!==n)}
  else c.value=el.value.split(',').map(x=>x.trim()).filter(Boolean);
  return false;
 }
 const k=el.dataset.k;
 if(k==='enabled'){r.enabled=el.checked;return true}
 if(k==='limit'||k==='window_days'){r[k]=el.value===''?null:Number(el.value);return false}
 r[k]=el.value;
 if(k==='measure'){const m=catalog.measures[r.measure];if(!m.per.includes(r.per))r.per=m.per[0];r.limit=Math.min(Math.max(r.limit??0,m.min),m.max)}
 if(r.per==='rolling_days'&&!r.window_days)r.window_days=7;
 return k==='measure'||k==='per';
}
function onRuleEdit(el){
 if(!ruleDraft||!el.closest('#rules-form')||!(el.dataset.r!==undefined||el.dataset.set))return false;
 const structural=editRule(el);impact=null;
 if(structural){rerenderRules();return true}
 const sentence=el.dataset.r!==undefined&&$(`#r${el.dataset.r}-sentence`);const r=ruleDraft.rules[Number(el.dataset.r)];
 if(sentence&&r)try{sentence.textContent=ruleSentence(r)}catch{sentence.textContent='Complete this rule.'}
 const result=$('#impact-result');if(result)result.innerHTML='';
 return true;
}
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
  if(action==='logout'){pendingImport=null;ruleDraft=null;impact=null;imports=null;importStatus='all';importOffset=0;timeline=null;importSettings={};importChoices={};await api('/api/auth/logout',{method:'POST'});user=null;preview=null;currentRun=null;historyQ='';historyFrom='';historyTo='';offset=0;loginScreen()}
  if(action==='confirm-import'){captureImportSettings();await uploadFile(pendingImport,true)}
  if(action==='sample'){const response=await fetch('/api/templates/csv');if(!response.ok)throw new Error('Unable to load sample. Sign in again.');await uploadFile(new File([await response.blob()],'sample_roster.csv',{type:'text/csv'}))}
  if(action==='run'){currentRun=await api('/api/uploads/'+preview.id+'/check',{method:'POST'});preview=null;nav('run/'+currentRun.id);toast('Check saved with its rule snapshot.')}
  if(action==='view'){const next=button.dataset.view;if(next==='timeline')await loadTimeline();view=next;renderResult();$(`[data-view="${view}"]`)?.focus();return}
  if(action==='zoom'){
   const step=button.dataset.zoom,current=dayWidth();
   if(step==='fit')zoom='fit';
   else zoom=Number(step)>0?zoomLevels.find(z=>z>current+1)??zoomLevels.at(-1):[...zoomLevels].reverse().find(z=>z<current-1)??zoomLevels[0];
   renderResult();$(`[data-zoom="${step}"]`)?.focus();return}
  if(action==='rule-add'){const rule=structuredClone(catalog.presets[Number($('#preset').value)]);rule.code=uniqueCode(rule.code);rule.zone=displayZone;ruleDraft.rules.push(rule);impact=null;rerenderRules();$(`#r${ruleDraft.rules.length-1}-name`)?.focus();return}
  if(action==='rule-remove'){ruleDraft.rules.splice(Number(button.dataset.r),1);impact=null;rerenderRules();return}
  if(action==='cond-add'){ruleDraft.rules[Number(button.dataset.r)].when.push({field:'overlaps_time',value:[...conditionDefaults.overlaps_time]});impact=null;rerenderRules();return}
  if(action==='cond-remove'){ruleDraft.rules[Number(button.dataset.r)].when.splice(Number(button.dataset.c),1);impact=null;rerenderRules();return}
  if(action==='rule-reset'){ruleDraft=null;impact=null;rerenderRules();return}
  if(action==='rule-preview'){impact=await api('/api/rules/preview',{method:'POST',body:JSON.stringify({run_id:$('#impact-run').value,rules:ruleDraft.rules})});$('#impact-result').innerHTML=impactHTML();return}
  if(action==='reload')await go();
  if(action==='clear-history'){historyQ='';historyFrom='';historyTo='';offset=0;await go()}
  if(action==='imports-prev'){importOffset=Math.max(0,importOffset-25);await go()}
  if(action==='imports-next'){importOffset+=25;await go()}
  if(action==='prev-page'){offset=Math.max(0,offset-25);await go()}
  if(action==='next-page'){offset+=25;await go()}
 }catch(error){toast(error.message)}finally{button.disabled=false}
});
document.addEventListener('submit',async e=>{
 const form=e.target;e.preventDefault();const values=Object.fromEntries(new FormData(form));const submit=$('button[type=submit]',form);if(submit)submit.disabled=true;
 try{
  if(form.id==='login-form'){user=await api('/api/auth/login',{method:'POST',body:JSON.stringify(values)});location.hash='checks';await go()}
  if(form.id==='history-filter'){historyQ=values.q;historyFrom=values.from;historyTo=values.to;offset=0;await go()}
  if(form.id==='rules-form'){await api('/api/rules',{method:'POST',body:JSON.stringify({expected_version:rules.version,name:ruleDraft.name,reason:ruleDraft.reason,rules:ruleDraft.rules})});ruleDraft=null;impact=null;await go();toast('New rule version saved. Existing checks are unchanged.')}
 }catch(error){const target=form.id==='login-form'?$('#login-error'):$('#rules-error');if(target)target.innerHTML=errHTML(error);else toast(error.message)}finally{if(submit)submit.disabled=false}
});
document.addEventListener('change',e=>{if(onRuleEdit(e.target))return;if(e.target.id==='roster-file')uploadFile(e.target.files[0]);if(e.target.id==='role-filter'){role=e.target.value;refreshRows()}if(e.target.id==='lane-sort'){laneSort=e.target.value;refreshRows()}if(e.target.id==='import-status'){importStatus=e.target.value;importOffset=0;go()}if(e.target.id==='display-zone'){displayZone=e.target.value;try{localStorage.setItem('crewcheck.displayZone',displayZone)}catch{}timeline=null;go()}});
document.addEventListener('input',e=>{if(e.target.type!=='checkbox'&&!e.target.matches('select')&&onRuleEdit(e.target))return;if(e.target.id==='crew-search'){query=e.target.value;refreshRows()}});
document.addEventListener('keydown',e=>{const drawer=$('.drawer');if(!drawer)return;if(e.key==='Escape')closeDrawer();if(e.key==='Tab'){const focusable=[...drawer.querySelectorAll('button,a,input,select,[tabindex="0"]')];if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
window.addEventListener('hashchange',go);
window.addEventListener('resize',()=>{if(view==='timeline'&&zoom==='fit'&&$('.tlgrid')){clearTimeout(placeTimeline.timer);placeTimeline.timer=setTimeout(placeTimeline,80)}});
(async()=>{try{user=await api('/api/auth/me');await go()}catch{loginScreen()}})();
