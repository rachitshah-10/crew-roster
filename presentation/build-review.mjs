import {drawArchitecture} from './architecture.mjs';
import {drawWorkflow,drawHistory,drawThresholds} from './sequences.mjs';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const C={navy:'#142C43',blue:'#315F78',muted:'#536679',light:'#EDF3F6',white:'#FFFFFF',border:'#C3D0D9',amber:'#8A611D'};
function text(s,value,x,y,w,h,size=24,color=C.navy,bold=false){const t=s.shapes.add({geometry:'textbox',name:value.slice(0,48),position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});t.text=value;t.text.insets=0;t.text.style={fontFamily:'Arial',fontSize:size,color,bold};return t;}
function base(p,title,no,section){const s=p.slides.add({width:1280,height:720});s.background.fill=C.white;text(s,section,64,45,1100,25,18,C.blue,true);text(s,title,64,91,1152,66,40,C.navy,true);text(s,'CrewCheck  /  MVP design review',64,674,1000,23,15,C.muted);text(s,String(no).padStart(2,'0'),1168,674,48,23,15,C.muted);return s;}
function block(s,title,body,y,x=64,w=305){text(s,title,x,y,w,35,24,C.navy,true);text(s,body,x,y+44,w,100,23,C.muted);}
function note(s,v){s.speakerNotes.text=v;}
function node(s,label,x,y,w,h=100,dark=false){const n=s.shapes.add({geometry:'rect',position:{left:x,top:y,width:w,height:h},fill:dark?C.navy:C.light,line:{fill:C.border,width:1}});n.text=label;n.text.insets=14;n.text.style={fontFamily:'Arial',fontSize:23,color:dark?C.white:C.navy,bold:true,alignment:'center',verticalAlignment:'middle'};return n;}
function arrow(s,a,b,from='right',to='left'){s.shapes.connect(a,b,{kind:'straight',fromSide:from,toSide:to,line:{fill:C.blue,width:2},tail:{type:'triangle'}});}
async function shot(s,file,x=400,y=185,w=816,h=465){s.images.add({path:`${ROOT}/presentation/assets/${file}.png`,position:{left:x,top:y,width:w,height:h},fit:'contain',alt:`Actual CrewCheck public demo: ${file}`});}
export async function build({presentation:p,input}){
 if(input.batch===1){
  let s=p.slides.add({width:1280,height:720});
  drawArchitecture(s);
  s=p.slides.add({width:1280,height:720});drawWorkflow(s);
  s=base(p,'Roster upload and validation',4,'02  /  SCHEDULER UPLOAD');
  block(s,'Select a file','Download the fictional sample, then select it with Browse files.',193);
  block(s,'Confirm the preview','Review crew, duties, timestamps and the captured rule version.',354);
  block(s,'Run the check','Validation errors must be corrected before checking.',515);
  await shot(s,'upload');
  note(s,'Live demonstration: open https://crewcheck-roster-demo.swoonypopcorn.chatgpt.site/#upload and choose Scheduler. Download CSV or Excel, then use Browse files to upload the saved file. Do not use the direct sample shortcut when showing file upload. Confirm 6 duties and 4 crew in the preview, then Run roster check. CSV and .xlsx are supported. Select the roster worksheet, map source columns and confirm the source time zone when prompted. Excel date cells are supported. PDF, DOCX and legacy .xls are outside scope. All records are fictional. Screenshot captured from the public demo on 5 November 2026.');
 }
 if(input.batch===2){
  let s=base(p,'Violation display',5,'03  /  FINDINGS');
  block(s,'Roster summary','6 duties checked\n3 findings across 3 duties\n4 fictional crew members',193);
  block(s,'Review controls','Filter flagged duties, search crew or duty ID, and filter by crew role.',365);
  block(s,'Per-duty evidence','Open Details to inspect the calculation and source record.',535);
  await shot(s,'findings');
  note(s,'With initial illustrative rules (12 h maximum duty, 10 h minimum rest and certification valid through duty end), sample_roster.csv produces: D101 duty 14 h, D103 rest 7 h and D104 certification expiry at 12:00 before duty end at 16:00 UTC. Counts are actual demo results. Four first duties have no preceding rest evidence. No flags does not certify full compliance. Source: samples/sample_roster.csv and actual public demo result captured 5 November 2026.');
  s=base(p,'Evidence behind a flag',6,'03  /  FINDINGS');
  text(s,'Insufficient rest',64,192,620,54,34,C.navy,true);
  text(s,'7 hours',64,270,520,100,68,C.navy,true);
  text(s,'Observed rest between D102 and D103',68,378,600,50,25,C.muted);
  text(s,'10 hours',64,458,550,66,44,C.blue,true);
  text(s,'Configured minimum in rule version 1',68,530,600,50,25,C.muted);
  text(s,'Previous duty ends 23:00 UTC\nNext duty starts 06:00 UTC the following day',68,604,640,59,21,C.muted);
  s.images.add({path:`${ROOT}/presentation/assets/evidence-detail.png`,position:{left:777,top:174,width:410,height:478},fit:'contain',alt:'Actual evidence drawer with timestamps, rule identifier and rule snapshot'});
  note(s,'Jordan Sample, crew C002, duty D103, source row 4. Previous duty D102 ends 2026-11-09T23:00:00Z; D103 starts 2026-11-10T06:00:00Z. Difference is 7 hours, below the illustrative 10-hour minimum. The drawer provides rule identifier REST_MIN, captured rule version, engine version and source hash. The details include the check ID and source SHA-256. Human review determines the next action. This is not an automatic scheduling decision.');
  s=p.slides.add({width:1280,height:720});drawHistory(s);
 }
 if(input.batch===3){
  let s=p.slides.add({width:1280,height:720});drawThresholds(s);
  s=base(p,'Outstanding risks and decisions',9,'06  /  OPEN QUESTIONS');
  const values=[['Area','Decision required','Current MVP boundary'],['Applicable rules','Which approved rulebook, operation type and crew roles apply?','Illustrative thresholds only'],['Roster coverage','Are files complete rosters or revisions? What prior-duty context is available?','No cross-file rest or cumulative checks'],['Qualifications','Which certificates are required, and which source maintains their validity?','One expiry field per duty'],['Access','Which SSO provider, assigned roles and team boundaries should apply?','Selectable roles in isolated demo spaces'],['Internal operations','What user volume, retention, backup and recovery requirements apply?','PostgreSQL and production controls planned']];
  const t=s.tables.add({rows:6,columns:3,left:64,top:186,width:1152,height:427,columnWidths:[205,565,382],values});
  t.borders.assign({fill:C.border,width:1,style:'solid'});
  t.cells.block({row:0,column:0,rowCount:6,columnCount:3}).assign({textStyle:{fontFamily:'Arial',fontSize:21,color:C.navy},margins:{top:12,bottom:12,left:14,right:14}});
  for(let r=0;r<6;r++){t.rows[r].height=r===0?48:76;for(let c=0;c<3;c++){const cell=t.getCell(r,c);cell.fill=r===0?C.navy:(r%2===0?C.light:C.white);if(r===0)cell.text.style={fontFamily:'Arial',fontSize:21,color:C.white,bold:true};}}
  text(s,'Review objective: agree the workflow and confirm the inputs required for the internal pilot.',64,632,1152,34,23,C.blue,true);
  note(s,'Ask which jurisdiction, operation and approved rulebook/version apply before implementing a regulatory profile. Clarify what duty start/end include (standby, positioning and post-flight work), roster revision semantics, historical context and cumulative limits. Confirm qualification data ownership. Agree real authentication and manager provisioning, organization scope and expected load. Agree retention/deletion, backups and restore verification before internal rollout. Current public workspace access expires after seven days, but automatic data deletion is not implemented. Original source bytes are discarded. Audit actors are demo roles, not verified employees. PostgreSQL migration is planned, not delivered. Sources: hosted/public/project-docs/architecture.md and postgresql-plan.md, plus current engine boundaries.');
 }
 return {slideCount:p.slides.items.length};
}
