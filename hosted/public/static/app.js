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
 $('#app').innerHTML=`<div class="layout"><aside class="sidebar"><div class="brand">${icon('shield')}CrewCheck</div><div class="navlabel">Workspace</div><nav><button data-nav="checks" class="${route==='checks'||route.startsWith('run/')?'active':''}">${icon('grid')}${manager?'Check history':'My roster checks'}</button><button data-nav="upload" class="${route==='upload'?'active':''}">${icon('upload')}Load roster</button><div class="navgap"></div><button data-nav="rules" class="${route==='rules'?'active':''}">${icon('rules')}${manager?'Rules & thresholds':'Active rule set'}</button><button data-nav="samples" class="${route==='samples'?'active':''}">${icon('file')}Sample library</button>${manager?`<button data-nav="audit" class="${route==='audit'?'active':''}">${icon('clock')}Audit trail</button>`:''}<a class="navlink" href="/documentation" target="_blank" rel="noopener">${icon('book')}Architecture & guide</a></nav><div class="sidefoot"><strong><span class="statusdot"></span>Your demo workspace</strong>Fictional crew and duties.<br>Private to this browser.</div></aside><main class="main"><header class="topbar"><div class="breadcrumb">${icon('grid')}Crew planning workspace</div><div class="profile"><span class="badge">DEMO</span><span class="avatar">${esc(user.name.split(' ').slice(0,2).map(x=>x[0]).join(''))}</span><span>${esc(user.name)}<small>${esc(user.role)}</small></span><button class="textbutton" data-action="logout">Switch role</button></div></header><div class="content">${content}</div></main></div>`;
}
function pagehead(title,subtitle,actions='',kicker='Roster review'){return `<div class="pagehead"><div><p class="kicker">${kicker}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="actions">${actions}</div></div>`}
function errHTML(error){return `<div class="error" role="alert">${esc(error.message)}${error.errors?`<ul>${error.errors.map(e=>`<li>${e.row?'Row '+e.row+': ':''}${esc(e.message)}</li>`).join('')}</ul>`:''}</div>`}
function metrics(items){return `<div class="metrics">${items.map(([label,value,hint,warn])=>`<div class="card metric ${warn?'attention':''}"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`).join('')}</div>`}
function loginScreen(error=''){
 $('#drawer-root').innerHTML='';
 $('#app').innerHTML=`<main class="login"><section class="loginintro"><div class="brand">${icon('shield')}CrewCheck</div><div class="line"></div><span class="demokicker">CREW ROSTER REVIEW</span><h1>See the roster.<br>Understand the flags.</h1><p>Explore a working review workflow before we meet. Upload a fictional roster, inspect the evidence, and see how rule changes preserve earlier decisions.</p><div class="introsteps"><span>01 · Load a roster</span><span>02 · Review evidence</span><span>03 · Revisit history</span></div><p class="note">All starter data is fictional.<br>Your demo workspace is separate from other visitors.</p></section><section class="loginform"><div><span class="badge">INTERACTIVE DEMO</span><h2>Take a look around.</h2><p class="subtitle">Choose a role. Start with a file upload or explore the saved checks.</p><div id="login-error">${error?errHTML(error):''}</div><button class="rolechoice" data-demo="scheduler"><span class="roleicon">${icon('upload')}</span><span><strong>Explore as Scheduler</strong><small>Start with file upload, then review the findings</small></span>${icon('arrow')}</button><button class="rolechoice" data-demo="manager"><span class="roleicon">${icon('rules')}</span><span><strong>Explore as Manager</strong><small>View team history, audit events and thresholds</small></span>${icon('arrow')}</button><div class="demoboundary"><strong>A sample-data sandbox</strong><p>Role selection is for demonstration, not production authentication. Use fictional data only. This browser keeps your workspace for up to 7 days; another device starts a separate demo.</p></div><div class="demolinks"><a href="/documentation" target="_blank" rel="noopener">Architecture & user flow ↗</a><a href="/samples/README.html" target="_blank" rel="noopener">Download sample files ↗</a></div></div></section></main>`;
}
function nav(target){if(location.hash==='#'+target)go();else location.hash=target}
async function go(){
 if(!user)return;
 const g=++generation;route=location.hash.slice(1)||(user.role==='scheduler'?'upload':'checks');
 if(route!=='checks'&&route!=='upload'&&route!=='rules'&&route!=='samples'&&route!=='audit'&&!/^run\/[a-f0-9]{24}$/.test(route)){route='checks';window.history.replaceState(null,'','#checks')}
 
 // This incremental port enables workflows as their view implementations land.
 const included=route==='upload'?typeof renderUpload==='function':route==='rules'?typeof renderRules==='function':route==='samples'?typeof renderSamples==='function':route==='audit'?typeof renderAudit==='function':route.startsWith('run/')?typeof renderResult==='function':typeof renderHistory==='function';
 if(!included){shell(pagehead('Workflow pending integration','This view is not included in this implementation step.'));return;}
try{
  if(route==='samples'){renderSamples()}
  else if(route==='audit'){const events=await api('/api/audit');if(g!==generation)return;renderAudit(events.items)}
  else if(route==='upload'){rules=await api('/api/rules');if(g!==generation)return;renderUpload()}
  else if(route==='rules'){rules=await api('/api/rules');const revisions=user.role==='manager'?await api('/api/rules/history'):[];if(g!==generation)return;renderRules(revisions)}
  else if(route.startsWith('run/')){currentRun=await api('/api/runs/'+route.split('/')[1]);if(g!==generation)return;filter='all';query='';role='all';renderResult()}
  else{history=await api(`/api/runs?${new URLSearchParams({q:historyQ,from_date:historyFrom,to_date:historyTo,offset})}`);if(g!==generation)return;renderHistory()}
 }catch(error){if(user)shell(pagehead('Unable to open this view','Your saved data has not changed.')+errHTML(error)+`<button class="btn" data-action="reload">Try again</button>`)}
}


const importFields={crew_id:'Crew ID',crew_name:'Crew name',role:'Crew role',duty_id:'Duty ID',duty_start:'Duty start',duty_end:'Duty end',certification_expires_at:'Certification expiry (optional)'};
let pendingImport=null,importSettings={},importChoices={};











function closeDrawer(){$('#drawer-root').innerHTML='';lastFocus?.focus()}

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


