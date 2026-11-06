import {unzipSync} from 'fflate';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {RosterError,ImportSetupError,parseCSV,normalizeRows,MAX_BYTES} from './checker.mjs';
const fail=message=>{throw new RosterError([{row:0,message}])};
const decoder=new TextDecoder('utf-8',{fatal:true});
const list=value=>value==null?[]:Array.isArray(value)?value:[value];
function xml(bytes){
 const source=decoder.decode(bytes);
 if(/<!DOCTYPE|<!ENTITY/i.test(source))fail('XML declarations and entities are not supported.');
 if(XMLValidator.validate(source)!==true)fail('Malformed workbook XML.');
 return new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@',removeNSPrefix:true,parseTagValue:false,parseAttributeValue:false,trimValues:false,processEntities:true}).parse(source);
}
function text(value){
 if(value==null)return '';
 if(typeof value==='string'||typeof value==='number')return String(value);
 if(value.t!=null)return text(value.t);
 if(value['#text']!=null)return text(value['#text']);
 return list(value.r).map(text).join('');
}
function zipPreflight(bytes){
 const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(data.getUint32(p,true)===0x06054b50){end=p;break}
 if(end<0)fail('The file is not a readable XLSX workbook.');
 const count=data.getUint16(end+10,true),offset=data.getUint32(end+16,true);
 if(count>1000||count===65535||offset>=end||data.getUint16(end+4,true)!==0||data.getUint16(end+6,true)!==0)fail('Unsupported or oversized workbook archive.');
 let cursor=offset,total=0;const names=new Set();
 for(let n=0;n<count;n++){
  if(cursor+46>end||data.getUint32(cursor,true)!==0x02014b50)fail('Invalid workbook archive directory.');
  const flags=data.getUint16(cursor+8,true),size=data.getUint32(cursor+24,true),length=data.getUint16(cursor+28,true),extra=data.getUint16(cursor+30,true),comment=data.getUint16(cursor+32,true);
  const next=cursor+46+length+extra+comment;
  if(next>end||size===0xffffffff||flags&1)fail('Encrypted or ZIP64 workbooks are not supported.');
  const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+length));
  if(names.has(name)||name.includes('..')||/vbaproject|externallinks/i.test(name))fail('Duplicate paths, macros and external links are not supported.');
  names.add(name);total+=size;if(total>30*1024*1024)fail('Workbook is too large after decompression.');cursor=next;
 }
 return names;
}
export function parseXLSX(bytes,options={}){
 zipPreflight(bytes);
 const files=unzipSync(bytes,{filter:f=>f.name.endsWith('.xml')||f.name.endsWith('.rels')});
 const read=name=>{if(!files[name])fail('Missing workbook component: '+name);return xml(files[name])};
 const workbook=read('xl/workbook.xml').workbook;
 const sheets=list(workbook?.sheets?.sheet);
 if(!sheets.length)fail('No worksheets found.');
 const sheetNames=sheets.map(s=>s['@name']);
 if(!options.worksheet&&sheets.length>1)throw new ImportSetupError('Choose the worksheet containing the roster.',{worksheets:sheetNames});
 const selected=options.worksheet?sheets.find(s=>s['@name']===options.worksheet):sheets[0];
 if(!selected)throw new ImportSetupError('Choose a worksheet from this workbook.',{worksheets:sheetNames});
 const relationships=list(read('xl/_rels/workbook.xml.rels').Relationships?.Relationship);
 const relationship=relationships.find(r=>r['@Id']===selected['@id']);
 if(!relationship||relationship['@TargetMode']==='External')fail('Invalid worksheet relationship.');
 const target=relationship['@Target'];
 if(!target||target.includes('..'))fail('Invalid worksheet path.');
 const path=target.startsWith('/')?target.slice(1):'xl/'+target;
 const shared=files['xl/sharedStrings.xml']?list(read('xl/sharedStrings.xml').sst?.si).map(text):[];
 const date1904=['1','true'].includes(workbook?.workbookPr?.['@date1904']);
 const styles=files['xl/styles.xml']?read('xl/styles.xml').styleSheet:{};
 const formats=new Map(list(styles?.numFmts?.numFmt).map(f=>[Number(f['@numFmtId']),f['@formatCode']||'']));
 const dateStyles=list(styles?.cellXfs?.xf).map(f=>{
  const id=Number(f['@numFmtId']);
  const code=(formats.get(id)||'').replace(/"[^"]*"|\\.|\[[^\]]*\]/g,'');
  return (id>=14&&id<=22)||(id>=45&&id<=47)||/[ymdhs]/i.test(code);
 });
 const sheet=read(path).worksheet;
 const matrix=[];let previous=0;
 for(const r of list(sheet?.sheetData?.row)){
  const n=Number(r['@r']);if(!Number.isInteger(n)||n<=previous||n>1048576)fail('Invalid worksheet row reference.');previous=n;
  const values=[],seen=new Set();values.sourceRow=n;
  for(const c of list(r.c)){
   if(Object.hasOwn(c,'f'))fail('Formulas are not supported. Paste values before uploading.');
   const match=/^([A-Z]+)(\d+)$/.exec(c['@r']||'');if(!match||Number(match[2])!==n)fail('Invalid cell reference.');
   let col=0;for(const char of match[1])col=col*26+char.charCodeAt(0)-64;
   if(col>32||seen.has(col))fail('Too many columns or duplicate cells.');seen.add(col);
   let value='';
   if(c['@t']==='s'){const i=Number(text(c.v));if(!Number.isInteger(i)||i<0||i>=shared.length)fail('Invalid shared string reference.');value=shared[i]}
   else if(c['@t']==='inlineStr')value=text(c.is);
   else if(c['@t']==='e')fail('Spreadsheet error cells are not supported.');
   else {value=text(c.v);if(value!==''&&(!c['@t']||c['@t']==='n')&&dateStyles[Number(c['@s']||0)])value={excelSerial:Number(value),date1904};}
   while(values.length<col)values.push('');values[col-1]=value;
  }
  while(values.length&&values.at(-1)==='')values.pop();
  if(values.length)matrix.push(values);
 }
 return matrix;
}
export function parseUpload(filename,bytes,options={},maxBytes=MAX_BYTES){
 if(bytes.length>maxBytes)fail('This file exceeds the current server upload budget. Contact the administrator to adjust deployment capacity.');
 try{
  if(filename.toLowerCase().endsWith('.csv'))return normalizeRows(parseCSV(decoder.decode(bytes)),options);
  if(filename.toLowerCase().endsWith('.xlsx'))return normalizeRows(parseXLSX(bytes,options),options);
  fail('Only CSV and Excel (.xlsx) are supported. PDF, DOCX and .xls are excluded.');
 }catch(e){if(e instanceof RosterError)throw e;fail('The file is not a readable CSV or XLSX workbook.')}
}
