import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {parseUpload} from '../lib/parse-upload.mjs';
import {COLUMNS,normalizeTimestamp,checkRoster} from '../lib/checker.mjs';
const row=['C1','Test Crew','pilot','D1','2026-11-09T06:00:00Z','2026-11-09T14:00:00Z','2027-01-01T00:00:00Z'];
const csv=(rows,headers=COLUMNS)=>new TextEncoder().encode([headers.join(','),...rows.map(r=>r.join(','))].join('\n'));
function book({extra=true,epoch=false,serial=46335.25,formula=false,sparse=false}={}){
 const files={
 'xl/workbook.xml':`<workbook xmlns:r="urn:r"><workbookPr date1904="${epoch?1:0}"/><sheets><sheet name="Roster" r:id="r1"/>${extra?'<sheet name="Notes" r:id="r2"/>':''}</sheets></workbook>`,
 'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>',
 'xl/styles.xml':'<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="22"/></cellXfs></styleSheet>',
 'xl/worksheets/sheet2.xml':'<worksheet><sheetData><row r="1"><c r="A1"><f>NOW()</f></c></row></sheetData></worksheet>'
 };
 const n=sparse?100000:2;
 const cell=(v,i,r)=>`<c r="${String.fromCharCode(65+i)}${r}" t="inlineStr"><is><t>${v}</t></is></c>`;
 files['xl/worksheets/sheet1.xml']=`<worksheet><sheetData><row r="1">${COLUMNS.map((v,i)=>cell(v,i,1)).join('')}</row><row r="${n}">${row.map((v,i)=>i===4||i===5?`<c r="${String.fromCharCode(65+i)}${n}" s="1">${formula?'<f>NOW()</f>':''}<v>${serial+(i===5?8/24:0)}</v></c>`:cell(v,i,n)).join('')}</row></sheetData></worksheet>`;
 return zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)])));
}
test('no 500-row ceiling; blank physical rows do not restrict valid duties',()=>{
 const rows=Array.from({length:6001},(_,i)=>[...row.slice(0,3),'D'+i,...row.slice(4)]);
 assert.equal(parseUpload('large.csv',csv(rows)).length,6001);
 const blank=new TextEncoder().encode(COLUMNS.join(',')+'\n'+'\n'.repeat(6000)+row.join(','));
 assert.equal(parseUpload('blank.csv',blank)[0].row_number,6002);
});
test('select worksheet, read Excel dates, ignore unrelated sheets and preserve source row',()=>{
 assert.throws(()=>parseUpload('roster.xlsx',book()),e=>e.import_options.worksheets.join(',')==='Roster,Notes');
 const rows=parseUpload('roster.xlsx',book({sparse:true}),{worksheet:'Roster',timezone:'UTC'});
 assert.equal(rows[0].row_number,100000);assert.equal(rows[0].source_sheet,'Roster');assert.equal(rows[0].duty_start,'2026-11-09T06:00:00Z');assert.equal(rows[0].duty_end,'2026-11-09T14:00:00Z');
 assert.throws(()=>parseUpload('roster.xlsx',book(),{worksheet:'Roster'}),e=>e.import_options.needs_timezone);
 assert.throws(()=>parseUpload('roster.xlsx',book({formula:true}),{worksheet:'Roster',timezone:'UTC'}),/corrections/);
 assert.equal(parseUpload('epoch.xlsx',book({epoch:true,serial:46335.25-1462}),{worksheet:'Roster',timezone:'UTC'})[0].duty_start,rows[0].duty_start);
});
test('custom column mapping, extra columns, human readable headings, optional expiry',()=>{
 const headers=['Employee','Name','Role','Duty','Start','End','Comment'];
 const mapping=Object.fromEntries(COLUMNS.slice(0,6).map((k,i)=>[k,headers[i]]));
 assert.throws(()=>parseUpload('r.csv',csv([[...row.slice(0,6),'note']],headers)),e=>e.import_options.needs_mapping);
 const result=parseUpload('r.csv',csv([[...row.slice(0,6),'note']],headers),{mapping});
 assert.equal(checkRoster(result).flags[0].code,'CERT_MISSING');
 assert.equal(parseUpload('r.csv',csv([row],COLUMNS.map(k=>k.replaceAll('_',' '))))[0].crew_id,'C1');
 assert.throws(()=>parseUpload('r.csv',csv([row]),{mapping:{duty_end:'duty_start'}}));
});
test('local wall times require explicit source timezone; DST folds and gaps are rejected',()=>{
 assert.throws(()=>normalizeTimestamp('2026-11-09 06:00','start'));
 assert.equal(normalizeTimestamp('2026-11-09 06:00','start','America/New_York'),'2026-11-09T11:00:00Z');
 assert.equal(normalizeTimestamp('2026-07-09 06:00','start','America/New_York'),'2026-07-09T10:00:00Z');
 assert.throws(()=>normalizeTimestamp('2026-11-01 01:30','start','America/New_York'),/ambiguous/);
 assert.throws(()=>normalizeTimestamp('2026-03-08 02:30','start','America/New_York'),/nonexistent/);
 assert.equal(normalizeTimestamp('2026-11-01T01:30:00-04:00','start','America/New_York'),'2026-11-01T05:30:00Z');
 assert.equal(normalizeTimestamp('2026-11-09T06:00Z','start'),'2026-11-09T06:00:00Z');
 assert.throws(()=>normalizeTimestamp('2026-02-30 06:00','start','UTC'));
});
