import csv
import io
from pathlib import Path
from openpyxl import Workbook
import pytest
from app.engine import DEFAULT_RULES, check_roster
from app.parsing import COLUMNS, RosterError, parse_roster

SAMPLE = Path(__file__).resolve().parents[1] / 'samples'

def csv_bytes(rows):
    output=io.StringIO();csv.writer(output).writerows([COLUMNS,*rows]);return output.getvalue().encode()

def row(start='2026-11-09T06:00:00Z', finish='2026-11-09T18:00:00Z', cert='2027-01-01T00:00:00Z', duty='D1'):
    return ['C1','Synthetic Test','pilot',duty,start,finish,cert]

def test_csv_excel_equivalence_and_sample_findings():
    csv_rows=parse_roster('sample.csv',(SAMPLE/'sample_roster.csv').read_bytes())
    xlsx_rows=parse_roster('sample.xlsx',(SAMPLE/'sample_roster.xlsx').read_bytes())
    assert csv_rows==xlsx_rows
    result=check_roster(csv_rows,DEFAULT_RULES)
    assert result['summary']==dict(duties=6,crew=4,flagged_duties=3,findings=3,no_flags=3)
    assert {f['code'] for f in result['flags']}=={'DUTY_LIMIT','REST_MIN','CERT_EXPIRED'}
    assert len(result['coverage']['first_duties_without_prior_rest'])==4

def test_exact_limits_and_offsets_are_not_false_positive():
    records=parse_roster('x.csv',csv_bytes([row('2026-11-09T01:00:00-05:00','2026-11-09T19:00:00+01:00','2026-11-09T18:00:00Z'),row('2026-11-10T04:00:00Z','2026-11-10T06:00:00Z',duty='D2')]))
    assert check_roster(records,DEFAULT_RULES)['flags']==[]
    assert records[0]['duty_start']=='2026-11-09T06:00:00Z'

def test_missing_certification_is_incomplete_evidence():
    result=check_roster(parse_roster('x.csv',csv_bytes([row(cert='')])),DEFAULT_RULES)
    assert result['flags'][0]['code']=='CERT_MISSING'
    assert result['flags'][0]['severity']=='incomplete'

def test_cert_start_vs_end_config():
    records=parse_roster('x.csv',csv_bytes([row(cert='2026-11-09T12:00:00Z')]))
    assert check_roster(records,DEFAULT_RULES)['flags'][0]['code']=='CERT_EXPIRED'
    assert check_roster(records,{**DEFAULT_RULES,'certification_at':'start'})['flags']==[]

def test_nested_overlaps_use_latest_prior_end_not_previous_row():
    records=parse_roster('x.csv',csv_bytes([row('2026-11-09T06:00:00Z','2026-11-09T20:00:00Z'),row('2026-11-09T08:00:00Z','2026-11-09T09:00:00Z',duty='D2'),row('2026-11-09T10:00:00Z','2026-11-09T11:00:00Z',duty='D3')]))
    flags=check_roster(records,DEFAULT_RULES)['flags']
    overlaps=[f for f in flags if f['code']=='DUTY_OVERLAP']
    assert len(overlaps)==2
    assert all(f['evidence']['previous_duty_id']=='D1' for f in overlaps)

def test_order_does_not_change_rest_results():
    records=parse_roster('x.csv',(SAMPLE/'sample_roster.csv').read_bytes())
    a=check_roster(records,DEFAULT_RULES);b=check_roster(list(reversed(records)),DEFAULT_RULES)
    assert sorted(a['flags'],key=lambda f:f['id'])==sorted(b['flags'],key=lambda f:f['id'])

@pytest.mark.parametrize('values',[row(start='2026-11-09T06:00:00'),row(finish='2026-11-09T05:00:00Z'),row(finish='2026-11-09T06:00:00Z'),row(cert='not-a-date')])
def test_bad_times_rejected(values):
    with pytest.raises(RosterError):parse_roster('x.csv',csv_bytes([values]))

def test_duplicate_headers_rows_and_inconsistent_identity():
    with pytest.raises(RosterError):parse_roster('x.csv',b'crew_id,crew_id\na,b')
    with pytest.raises(RosterError):parse_roster('x.csv',csv_bytes([row(),row()]))
    changed=row(duty='D2');changed[1]='Different Person'
    with pytest.raises(RosterError):parse_roster('x.csv',csv_bytes([row(),changed]))

@pytest.mark.parametrize('suffix',['pdf','docx','xls','exe'])
def test_unsupported_files(suffix):
    with pytest.raises(RosterError):parse_roster('x.'+suffix,b'%PDF-1')

def test_formulas_rejected_and_multiple_sheets_require_selection():
    wb=Workbook();ws=wb.active;ws.append(COLUMNS);values=row();values[4]='=NOW()';ws.append(values)
    data=io.BytesIO();wb.save(data)
    with pytest.raises(RosterError,match='corrections'):parse_roster('x.xlsx',data.getvalue())
    wb=Workbook();wb.create_sheet('extra');data=io.BytesIO();wb.save(data)
    with pytest.raises(RosterError):parse_roster('x.xlsx',data.getvalue())

def test_limits_and_invalid_archive():
    with pytest.raises(RosterError):parse_roster('x.csv',b'x'*(5*1024*1024+1))
    with pytest.raises(RosterError):parse_roster('x.xlsx',b'not a zip')
    assert len(parse_roster('x.csv',csv_bytes([row(duty=f'D{i}') for i in range(6001)]))) == 6001

def test_fractional_second_order():
    with pytest.raises(RosterError):parse_roster('x.csv',csv_bytes([row('2026-11-09T06:00:00.9Z','2026-11-09T06:00:00.1Z')]))


def test_excel_dates_sheet_selection_mapping_and_timezone():
    from datetime import datetime
    wb=Workbook(); wb.active.title='Instructions'; wb.active.append(['Instructions'])
    ws=wb.create_sheet('Crew duties')
    headers=['Employee','Name','Role','Duty','Start','End','Notes']
    ws.append(headers)
    ws.append(['C1','Synthetic Test','pilot','D1',datetime(2026,11,9,6),datetime(2026,11,9,14),'extra'])
    data=io.BytesIO(); wb.save(data)
    with pytest.raises(RosterError) as e: parse_roster('r.xlsx',data.getvalue())
    assert e.value.import_options['worksheets']==['Instructions','Crew duties']
    mapping=dict(zip(COLUMNS[:-1],headers[:-1]))
    options={'worksheet':'Crew duties','mapping':mapping,'timezone':'America/New_York'}
    records=parse_roster('r.xlsx',data.getvalue(),options)
    assert records[0]['duty_start']=='2026-11-09T11:00:00Z'
    assert records[0]['source_sheet']=='Crew duties'
    assert check_roster(records,DEFAULT_RULES)['flags'][0]['code']=='CERT_MISSING'


def test_timezone_ambiguity_and_nonexistent_times():
    from app.parsing import normalize_timestamp
    assert normalize_timestamp('2026-07-09 06:00','start','America/New_York')=='2026-07-09T10:00:00Z'
    # Clock-change times are resolved automatically (see tests/test_dst.py for the full rules).
    assert normalize_timestamp('2026-11-01 01:30','duty_start','America/New_York')=='2026-11-01T05:30:00Z'
    assert normalize_timestamp('2026-03-08 02:30','duty_start','America/New_York')=='2026-03-08T06:30:00Z'
    assert normalize_timestamp('2026-11-01T01:30:00-04:00','start','America/New_York')=='2026-11-01T05:30:00Z'
