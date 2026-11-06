const C={navy:'#142C43',blue:'#315F78',muted:'#536679',light:'#EDF3F6',white:'#FFFFFF',border:'#A9BBC8'};
function text(s,value,x,y,w,h,size=22,color=C.navy,bold=false){const t=s.shapes.add({geometry:'textbox',name:value.slice(0,60),position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});t.text=value;t.text.insets=0;t.text.style={fontFamily:'Arial',fontSize:size,color,bold};return t;}
function box(s,title,detail,file,x,y,w,h=116,dark=false){
 const b=s.shapes.add({geometry:'rect',name:title,position:{left:x,top:y,width:w,height:h},fill:dark?C.navy:C.light,line:{fill:C.border,width:1}});
 text(s,title,x+14,y+14,w-28,29,22,dark?C.white:C.navy,true);
 text(s,detail,x+14,y+48,w-28,56,19,dark?'#E3ECF2':C.muted);
 if(file)text(s,file,x,y+h+8,w,25,16,C.muted);
 return b;
}
function segment(s,x1,y1,x2,y2,tip=false){
 const n=s.shapes.add({geometry:'connector',kind:'straight',position:{left:Math.min(x1,x2),top:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1)},line:{fill:C.blue,width:2},...(tip?{tail:{type:'triangle'}}:{})});return n;
}
export function drawArchitecture(s){
 s.background.fill=C.white;
 text(s,'IMPLEMENTATION CONTEXT',64,45,1100,25,18,C.blue,true);
 text(s,'System architecture',64,91,1152,66,40,C.navy,true);
 const boundary=s.shapes.add({geometry:'rect',name:'Backend boundary',position:{left:280,top:180,width:742,height:420},fill:'none',line:{style:'dashed',fill:C.blue,width:2}});
 text(s,'BACKEND',307,196,180,27,19,C.blue,true);
 text(s,'One Cloudflare Worker',625,196,365,27,19,C.muted);
 box(s,'Browser UI','Scheduler\nManager','public/static/',50,263,176,116);
 text(s,'HTTPS',233,284,90,22,14,C.muted);
 segment(s,226,321,311,321,true);
 box(s,'Access control','Workspace + role\nCSRF + origin','lib/api.mjs',311,263,204,116);
 segment(s,515,321,564,321,true);
 box(s,'API handlers','Upload / checks / history / rules / audit','',564,263,426,116,true);
 box(s,'File validation','CSV / XLSX schema\nUTC normalization','lib/parse-upload.mjs',311,463,204,104);
 box(s,'Rule engine','Duty / rest / overlap\nExpiry checks','lib/checker.mjs',551,463,204,104);
 box(s,'Persistence','Results + rules\nAudit events','lib/api.mjs',791,463,199,104);
 // Orthogonal module calls. This is a dependency view, not a single request pipeline.
 segment(s,595,379,595,429);segment(s,413,429,595,429);segment(s,413,429,413,463,true);
 segment(s,777,379,777,441);segment(s,653,441,777,441);segment(s,653,441,653,463,true);
 segment(s,950,379,950,429);segment(s,890,429,950,429);segment(s,890,429,890,463,true);
 text(s,'Calls as required',635,405,240,23,16,C.muted);
 box(s,'D1 database','SQLite-based\nSaved records','External storage',1063,463,171,104);
 segment(s,990,515,1063,515,true);
 text(s,'Logical components in one Worker. Access and storage helpers share lib/api.mjs.',64,622,1152,30,19,C.muted);
 text(s,'Internal deployment planned: PostgreSQL + company authentication',64,653,1080,28,20,C.blue,true);
 text(s,'02',1170,675,48,23,15,C.muted);
 s.speakerNotes.text='Public implementation, verified against hosted/app/api/[...path]/route.ts, lib/api.mjs, lib/parse-upload.mjs and lib/checker.mjs. The dashed boundary is one Cloudflare Worker, not a set of independently deployed microservices. Access control and persistence are logical responsibilities within api.mjs. The route adapter passes the request and DB binding to handleApi. Access helpers enforce workspace scope, demo role, origin and CSRF. Upload handlers call parseUpload (which delegates normalization to checker.mjs), then save normalized rows, file hash and captured rules. Check handlers load that preview and policy, call checkRoster, and save the result plus audit event. History and settings do not pass through the parser or checker. D1 is external persistent storage. Original file bytes are discarded. PostgreSQL and company authentication are planned. The local FastAPI implementation is a separate reference, not a dependency of this Worker.';
}
export async function update({presentation}){
 const s=presentation.slides.getItem(1);
 s.shapes.deleteAll();
 drawArchitecture(s);
 await presentation.render({slide:1});
 return {slideCount:presentation.slides.items.length};
}
