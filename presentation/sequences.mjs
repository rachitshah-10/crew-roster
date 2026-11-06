const ROOT='/Users/jpark/Documents/09_coforge/projects/compliance_checker';
const C={navy:'#142C43',blue:'#315F78',muted:'#536679',light:'#EDF3F6',white:'#FFFFFF',border:'#C3D0D9',amber:'#8A611D'};
function text(s,v,x,y,w,h,size=20,color=C.navy,bold=false,align='left'){const t=s.shapes.add({geometry:'textbox',name:v.slice(0,60),position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});t.text=v;t.text.insets=0;t.text.style={fontFamily:'Arial',fontSize:size,color,bold,alignment:align};return t;}
function rect(s,x,y,w,h,fill=C.white,stroke=C.border){return s.shapes.add({geometry:'rect',position:{left:x,top:y,width:w,height:h},fill,line:{fill:stroke,width:1}});}
function line(s,x1,y1,x2,y2,{dashed=false,arrow=false,color=C.blue}={}){return s.shapes.add({geometry:'connector',kind:'straight',position:{left:Math.min(x1,x2),top:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1)},line:{fill:color,width:1.5,style:dashed?'dashed':'solid'},...(arrow?{[x2<x1?'head':'tail']:{type:'triangle',width:'sm',length:'sm'}}:{})});}
function msg(s,a,b,y,label,reply=false,size=18){line(s,a,y,b,y,{arrow:true,dashed:reply});text(s,label,Math.min(a,b)+6,y-25,Math.abs(b-a)-12,23,size,C.navy,false,'center');}
function self(s,x,y,label,width=55,size=18){line(s,x,y,x+width,y);line(s,x+width,y,x+width,y+16);line(s,x+width,y+16,x,y+16,{arrow:true});text(s,label,x-260,y-12,245,28,size,C.navy,false,'right');}
function base(s,title,n,section){s.background.fill=C.white;text(s,section,64,45,1100,25,18,C.blue,true);text(s,title,64,91,1152,66,40,C.navy,true);text(s,'CrewCheck  /  MVP design review',64,674,1000,23,15,C.muted);text(s,String(n).padStart(2,'0'),1168,674,48,23,15,C.muted);}
function participants(s,names,xs,y=183,bottom=632,w=170){names.forEach((n,i)=>{if(i===0){const aw=184;rect(s,xs[i]-aw/2,y-14,aw,54,C.navy,C.navy);text(s,'User',xs[i]-aw/2+4,y-10,aw-8,25,22,C.white,true,'center');text(s,'('+n+')',xs[i]-aw/2+4,y+15,aw-8,22,16,C.white,false,'center');}else{rect(s,xs[i]-w/2,y,w,40,C.light);text(s,n,xs[i]-w/2+4,y+8,w-8,28,21,C.navy,true,'center');}line(s,xs[i],y+40,xs[i],bottom,{dashed:true,color:C.border});});}
function callout(s,title,body,x,y,w){text(s,title,x,y,w,29,23,C.navy,true);text(s,body,x,y+36,w,76,21,C.muted);}
export function drawWorkflow(s){
 base(s,'Proposed user workflow',3,'01  /  USER WORKFLOW');
 const [u,w,b,d]=[150,475,800,1120];
 participants(s,['Crew Scheduler','Web app','Backend','Database'],[u,w,b,d]);
 msg(s,u,w,255,'Upload CSV / Excel');msg(s,w,b,291,'Validate file and rows');
 rect(s,76,303,1140,61,'none');rect(s,76,303,193,23,C.light);text(s,'break [invalid file]',84,306,185,21,16,C.amber,true);
 msg(s,b,w,351,'Validation errors',true);msg(s,w,u,351,'Correct and re-upload',true);
 msg(s,b,d,390,'Save preview + rule version');
 msg(s,b,w,430,'Validated preview',true);msg(s,w,u,430,'Review roster + rules',true);
 msg(s,u,w,470,'Run check');msg(s,w,b,470,'Check saved preview');
 msg(s,b,d,510,'Load roster + captured rules');
 self(s,b,535,'Apply captured rules');
 msg(s,b,d,584,'Save result + audit event');
 msg(s,b,w,625,'Saved findings',true);msg(s,w,u,625,'Review flags + evidence',true);
 text(s,'Invalid files stop the request. Correct the source file and upload again.',64,643,1152,23,17,C.muted);
 s.speakerNotes.text='Sequence diagram, read top to bottom. Solid arrows represent actions and requests; dashed arrows represent returned data or displayed responses. Entry assumes Scheduler has selected a demo role. The break fragment terminates an invalid upload request: no upload or check is saved, and correction starts a new upload. On success, the backend obtains the active policy and saves normalized rows, a source hash and captured rule version with the upload audit event. Run is an explicit later action. The backend loads the stored roster and captured rules, computes deterministic findings, and saves one result with its audit event. Repeat Run returns the existing result. This does not change the roster or certify complete aviation compliance.';
}
function mini(s){participants(s,['Planning Manager','Application','Database'],[138,350,562],190,610,154);text(s,'Application = web app + backend',64,628,540,25,17,C.muted);}
function screenshot(s,name){const existing=s.images.items[0];if(existing){existing.position={left:656,top:190,width:560,height:322};}else{s.images.add({path:`${ROOT}/presentation/assets/${name}.png`,position:{left:656,top:190,width:560,height:322},fit:'contain',alt:`Actual CrewCheck ${name} screen`});}}
export function drawHistory(s){
 base(s,'Historical flags and audit evidence',7,'04  /  MANAGER REVIEW');mini(s);
 msg(s,138,350,274,'Request history');msg(s,350,562,316,'Find saved checks');
 msg(s,562,350,358,'Check summaries',true);msg(s,350,138,400,'Browse results',true);
 msg(s,138,350,452,'Open saved check');msg(s,350,562,494,'Load original result');
 msg(s,562,350,536,'Rules + findings',true);msg(s,350,138,578,'Review evidence',true);
 screenshot(s,'history');
 callout(s,'Reopen the original evidence','Search by filename or date. Saved checks retain the rules and findings from that run.',656,526,560);
 text(s,'Audit trail separately records uploads, checks and rule changes.',656,633,560,32,18,C.muted);
 s.speakerNotes.text='Manager review is an independent sequence, not a required continuation of each upload. The manager sees saved checks in the same isolated browser workspace. History queries return filtered summaries; opening a check retrieves its immutable result, captured rules and evidence. Current settings are not reapplied. There is no acknowledgement or resolution workflow. The audit trail is a separate view of uploads, checks, threshold changes and demo-role events. It is not an exhaustive access log or tamper-proof store.';
}
export function drawThresholds(s){
 base(s,'Threshold configuration',8,'05  /  RULE MANAGEMENT');mini(s);
 msg(s,138,350,274,'Values + reason');
 line(s,350,316,392,316);line(s,392,316,392,334);line(s,392,334,350,334,{arrow:true});
 text(s,'Validate role, values\nand current version',92,305,238,52,18,C.navy,false,'right');
 msg(s,350,562,386,'Save version + audit');msg(s,562,350,436,'New rule version',true);msg(s,350,138,486,'Confirm saved version',true);
 rect(s,78,535,535,70,C.light);text(s,'Invalid values or a version conflict:\nreturn an error; no new version is saved.',94,548,503,50,18,C.muted);
 screenshot(s,'rules-form');
 callout(s,'Changes apply to future uploads','Existing previews and completed checks keep their captured rule version.',656,526,560);
 text(s,'Changes record the manager, timestamp and reason.',656,633,560,30,18,C.muted);
 s.speakerNotes.text='Manager submits allowed threshold values, a name, a reason and the expected current version. The backend checks the manager role, validates input, and guards against concurrent changes. On success, a database batch inserts a new policy version, records an audit event, and updates the active version. Invalid input or a version conflict returns an error without publishing a new policy. The public demo uses role labels, not verified employee identities. New uploads capture the new version. Already uploaded previews and completed runs retain their previous policy. Initial values are illustrative, not approved aviation limits.';
}
export async function update({presentation}){for(const [i,fn] of [[2,drawWorkflow],[6,drawHistory],[7,drawThresholds]]){const s=presentation.slides.getItem(i);s.shapes.deleteAll();fn(s);}await presentation.render({slide:[2,6,7]});return {slides:presentation.slides.items.length};}
