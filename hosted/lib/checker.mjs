export const DEFAULT_RULES={name:'Illustrative MVP rules',max_duty_hours:12,min_rest_hours:10,certification_at:'end'};
export const COLUMNS=['crew_id','crew_name','role','duty_id','duty_start','duty_end','certification_expires_at'];
// Deployment resource budget, not a roster/business rule.
export const MAX_BYTES=5*1024*1024;
export class RosterError extends Error {constructor(errors){super('The roster needs corrections before it can be checked.');this.errors=errors.slice(0,50)}}
const fail=(message,row=0)=>{throw new RosterError([{row,message}])};
export function parseCSV(text){
 const rows=[];let row=[],cell='',quoted=false,closed=false,sourceRow=1;
 const finishRow=()=>{if(row.some(v=>v.trim())){Object.defineProperty(row,'sourceRow',{value:sourceRow});rows.push(row)}row=[];sourceRow++;};
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=c}
  else if(c==='"'&&!cell&&!closed)quoted=true;
  else if(c===','||c==='\n'||c==='\r'){
   row.push(cell);cell='';closed=false;
   if(row.length>32)fail('Too many columns. Use the provided template.');
   if(c!==','){finishRow();if(c==='\r'&&text[i+1]==='\n')i++;}
  }else{if(closed||c==='"')fail('Malformed CSV quoting.');cell+=c}
  if(cell.length>2000)fail('Cell text is too long.');
 }
 if(quoted)fail('Unclosed CSV quote.');
 if(cell||row.length||closed){row.push(cell);finishRow()}
 return rows;
}
export function normalizeTimestamp(value,key,zone=''){
 value=String(value).trim().replace(' ','T');
 if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(value))value=value.slice(0,16)+':00'+value.slice(16);
 if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(value)){
  if(!zone)throw Error(`${key} has no time zone. Select the source time zone to continue.`);
  return localToUTC(value,key,zone);
 }
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(?:(\d{2})(\.\d{1,3})?)(Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!m)throw Error(`${key} needs an ISO timestamp with an explicit UTC offset, e.g. 2026-11-16T06:00:00Z.`);
 const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number);
 const days=new Date(Date.UTC(year,month,0)).getUTCDate();
 if(year<1900||year>9999||month<1||month>12||day<1||day>days||hour>23||minute>59||second>59)throw Error(`${key} is not a valid calendar timestamp.`);
 if(m[8]!=='Z'&&(Number(m[8].slice(1,3))>23||Number(m[8].slice(4,6))>59))throw Error(`${key} has an invalid UTC offset.`);
 const n=Date.parse(value);if(!Number.isFinite(n))throw Error(`${key} is not a valid timestamp.`);
 return new Date(n).toISOString().replace('.000Z','Z');
}
export class ImportSetupError extends RosterError {
 constructor(message,options){super([{row:0,message}]);this.import_options=options;this.message=message;}
}
export const normalizeHeader=v=>String(v??'').trim().toLowerCase().replace(/[\s-]+/g,'_');
function localToUTC(value,key,zone){
 const local=value.length===16?value+':00':value;
 // Validate the calendar before resolving its zone.
 const nominal=Date.parse(normalizeTimestamp(local+'Z',key));
 if(zone==='UTC'||zone==='Z')return normalizeTimestamp(local+'Z',key);
 if(/^[+-]\d{2}:\d{2}$/.test(zone))return normalizeTimestamp(local+zone,key);
 let fmt;try{fmt=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})}catch{throw Error('Select a valid source time zone, such as America/New_York, UTC or +09:00.')}
 const wall=n=>{const p=Object.fromEntries(fmt.formatToParts(new Date(n)).map(p=>[p.type,p.value]));return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)};
 const offsets=new Set([-36,-12,0,12,36].map(h=>{const n=Math.floor((nominal+h*3600000)/1000)*1000;return wall(n)-n}));
 const matches=[...offsets].map(o=>nominal-o).filter(n=>wall(n)===Math.floor(nominal/1000)*1000);
 if(matches.length!==1)throw Error(`${key} is ${matches.length?'ambiguous':'nonexistent'} in ${zone} because of a clock change. Supply an explicit UTC offset in that cell.`);
 return new Date(matches[0]).toISOString().replace('.000Z','Z');
}
export function normalizeRows(matrix,options={}){
 if(!matrix.length)fail('The file is empty.',1);
 const headers=matrix[0].map(v=>String(v??'').trim());
 const required=COLUMNS.slice(0,-1), mapping=options.mapping||{};
 if(new Set(headers).size!==headers.length)fail('Column names must be unique so they can be mapped unambiguously.',1);
 const indices=Object.fromEntries(COLUMNS.map(k=>{
  if(Object.hasOwn(mapping,k))return [k,mapping[k]===''?-1:headers.indexOf(mapping[k])];
  const hits=headers.map((h,i)=>normalizeHeader(h)===k?i:-1).filter(i=>i>=0);
  return [k,hits.length===1?hits[0]:-1];
 }));
 if(required.some(k=>indices[k]<0))throw new ImportSetupError('Match your roster columns to the fields needed for checking.',{headers,needs_mapping:true,mapping:Object.fromEntries(COLUMNS.map(k=>[k,indices[k]>=0?headers[indices[k]]:'']))});
 const mapped=Object.values(indices).filter(i=>i>=0);
 if(new Set(mapped).size!==mapped.length)fail('Use a different source column for each roster field.',1);
 const rows=[],errors=[],seen=new Set(),people=new Map();let needsZone=false;
 matrix.slice(1).forEach((values,index)=>{
  const rowNumber=values.sourceRow||index+2;
  if(!values.some(v=>String(v??'').trim()))return;
  try{
   if(values.length>headers.length)throw Error('Unexpected extra cells without column headers.');
   const row=Object.fromEntries(COLUMNS.map(h=>[h,indices[h]<0?'':values[indices[h]]??'']));
   for(const key of COLUMNS){
    let value=row[key];
    if(value&&typeof value==='object'&&Object.hasOwn(value,'excelSerial')){
     const serial=value.excelSerial;
     if(!Number.isFinite(serial)||serial<0||(!value.date1904&&serial<61))throw Error(`${key} has an invalid or unsupported Excel calendar date.`);
     value=new Date((value.date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30))+Math.round(serial*86400000)).toISOString().replace(/Z$/,'').replace('.000','');
    }
    row[key]=String(value).trim();
   }
   for(const key of required)if(!row[key])throw Error(`${key} is required.`);
   if(Object.values(row).some(v=>v.length>160))throw Error('Cell text must not exceed 160 characters.');
   row.role=row.role.toLowerCase();
   if(!['pilot','cabin'].includes(row.role))throw Error('role must be pilot or cabin.');
   for(const key of ['duty_start','duty_end','certification_expires_at'])if(row[key]||key!=='certification_expires_at')row[key]=normalizeTimestamp(row[key],key,options.timezone||'');
   if(Date.parse(row.duty_end)<=Date.parse(row.duty_start))throw Error('duty_end must be after duty_start.');
   const key=JSON.stringify([row.crew_id,row.duty_id]),identity=JSON.stringify([row.crew_name,row.role]);
   if(seen.has(key))throw Error('Duplicate crew_id and duty_id in this file.');
   if(people.has(row.crew_id)&&people.get(row.crew_id)!==identity)throw Error('Crew name and role must be consistent for a crew_id.');
   seen.add(key);people.set(row.crew_id,identity);row.row_number=rowNumber;
   if(options.worksheet)row.source_sheet=options.worksheet;
   if(options.timezone)row.source_timezone=options.timezone;
   rows.push(row);
  }catch(e){if(e.message.includes('has no time zone'))needsZone=true;errors.push({row:rowNumber,message:e.message})}
 });
 if(needsZone)throw new ImportSetupError('Select the source time zone for dates that do not include an offset.',{needs_timezone:true});
 if(!rows.length&&!errors.length)errors.push({row:2,message:'Add at least one duty row.'});
 if(errors.length)throw new RosterError(errors);
 return rows;
}
const number=n=>Number(n.toFixed(4));
export function checkRoster(rows,rules=DEFAULT_RULES){
 const flags=[],byCrew=new Map();
 const flag=(r,code,title,observed,expected,evidence,severity='review')=>flags.push({id:`${r.row_number}-${code}`,row_number:r.row_number,crew_id:r.crew_id,duty_id:r.duty_id,code,title,observed,expected,evidence,severity});
 for(const r of rows){
  const duration=(Date.parse(r.duty_end)-Date.parse(r.duty_start))/3600000;
  if(!byCrew.has(r.crew_id))byCrew.set(r.crew_id,[]);byCrew.get(r.crew_id).push(r);
  if(duration>rules.max_duty_hours)flag(r,'DUTY_LIMIT','Duty exceeds limit',`${number(duration)} h`,`≤ ${rules.max_duty_hours} h`,{duty_start:r.duty_start,duty_end:r.duty_end,difference_hours:number(duration-rules.max_duty_hours)});
  const point=rules.certification_at==='end'?r.duty_end:r.duty_start;
  if(!r.certification_expires_at)flag(r,'CERT_MISSING','Certification evidence missing','No expiry supplied','Expiry timestamp required',{assessment_time:point},'incomplete');
  else if(Date.parse(r.certification_expires_at)<Date.parse(point))flag(r,'CERT_EXPIRED','Certification expires too early',r.certification_expires_at,`Valid through duty ${rules.certification_at}`,{certification_expires_at:r.certification_expires_at,assessment_time:point});
 }
 const unassessed=[];
 for(const crew of byCrew.values()){
  const ordered=[...crew].sort((a,b)=>Date.parse(a.duty_start)-Date.parse(b.duty_start)||Date.parse(a.duty_end)-Date.parse(b.duty_end));let prior=null;
  for(const row of ordered){
   if(!prior)unassessed.push(row.duty_id);
   else{
    const gap=(Date.parse(row.duty_start)-Date.parse(prior.duty_end))/3600000;
    const evidence={previous_duty_id:prior.duty_id,previous_duty_end:prior.duty_end,next_duty_start:row.duty_start};
    if(gap<0)flag(row,'DUTY_OVERLAP','Duties overlap',`${number(-gap)} h overlap`,'No overlap',evidence);
    else if(gap<rules.min_rest_hours)flag(row,'REST_MIN','Insufficient rest',`${number(gap)} h`,`≥ ${rules.min_rest_hours} h`,evidence);
   }
   if(!prior||Date.parse(row.duty_end)>Date.parse(prior.duty_end))prior=row;
  }
 }
 const flagged=new Set(flags.map(f=>f.row_number));
 return {rows,flags,summary:{duties:rows.length,crew:byCrew.size,flagged_duties:flagged.size,findings:flags.length,no_flags:rows.length-flagged.size},coverage:{first_duties_without_prior_rest:unassessed,note:'Rest before each crew member’s first duty is not assessed. Include preceding duties in this file. Historical uploads are not merged.'},engine_version:'1.0.0-web'};
}
