import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCSV,normalizeRows,checkRoster,DEFAULT_RULES,normalizeTimestamp} from '../lib/checker.mjs';
const fixtures=JSON.parse(readFileSync(new URL('../lib/demo-fixtures.json',import.meta.url)));
for(const f of fixtures)test(`Python parity: ${f.name}`,()=>{
 const rows=normalizeRows(parseCSV(f.csv));assert.deepEqual(rows,f.rows);
 const result=checkRoster(rows);result.engine_version='1.0.0';assert.deepEqual(result,f.expected);
});
test('invalid dates, missing offsets and reversed periods are rejected',()=>{
 for(const value of ['2026-02-30T06:00:00Z','2026-13-10T06:00:00Z','2026-01-01T24:00:00Z','2026-01-01T06:00:00','2026-01-01T06:00:00+25:00'])assert.throws(()=>normalizeTimestamp(value,'start'));
 assert.equal(normalizeTimestamp('2026-11-16T07:00:00+01:00','start'),'2026-11-16T06:00:00Z');
});
test('exact boundaries pass, nested overlap uses latest prior end',()=>{
 const row={...fixtures[0].rows[0],duty_start:'2026-11-16T00:00:00Z',duty_end:'2026-11-16T12:00:00Z',certification_expires_at:'2027-01-01T00:00:00Z'};
 const next={...row,row_number:3,duty_id:'NEXT',duty_start:'2026-11-16T22:00:00Z',duty_end:'2026-11-17T06:00:00Z'};
 assert.equal(checkRoster([row,next]).flags.length,0);
 const inner={...row,row_number:4,duty_id:'INNER',duty_start:'2026-11-16T02:00:00Z',duty_end:'2026-11-16T03:00:00Z'};
 const third={...row,row_number:5,duty_id:'THIRD',duty_start:'2026-11-16T05:00:00Z',duty_end:'2026-11-16T06:00:00Z'};
 assert.equal(checkRoster([third,inner,row]).flags.filter(f=>f.code==='DUTY_OVERLAP').length,2);
});
test('CSV quoting, unique identity, and limits',()=>{
 assert.deepEqual(parseCSV('a,b\n"x,y","q""z"\n'),[['a','b'],['x,y','q"z']]);
 assert.throws(()=>parseCSV('a\n"oops'));
 const matrix=parseCSV(fixtures[0].csv);matrix.push(matrix[1]);assert.throws(()=>normalizeRows(matrix));
});
