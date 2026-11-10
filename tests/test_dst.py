"""Daylight-saving handling: named zones convert automatically, and clock-change
hours resolve to the stricter reading instead of being rejected."""
import csv
import io

import pytest
from fastapi.testclient import TestClient

from app.engine import DEFAULT_RULES, check_roster
from app.main import create_app
from app.parsing import COLUMNS, normalize_timestamp, parse_roster

NY = 'America/New_York'


def csv_bytes(rows):
    output = io.StringIO()
    csv.writer(output).writerows([COLUMNS, *rows])
    return output.getvalue().encode()


def duty(start, end, cert='2027-01-01T00:00:00Z', duty_id='D1', crew='C1'):
    return [crew, 'Synthetic Test', 'pilot', duty_id, start, end, cert]


@pytest.mark.parametrize('local,expected', [
    ('2026-01-15 06:00', '2026-01-15T11:00:00Z'),  # EST, UTC-5
    ('2026-07-15 06:00', '2026-07-15T10:00:00Z'),  # EDT, UTC-4
    ('2026-03-08 01:59', '2026-03-08T06:59:00Z'),  # last minute before spring forward
    ('2026-03-08 03:00', '2026-03-08T07:00:00Z'),  # first minute after
    ('2026-11-01 00:59', '2026-11-01T04:59:00Z'),
    ('2026-11-01 02:00', '2026-11-01T07:00:00Z'),
])
def test_named_zone_applies_the_right_offset_automatically(local, expected):
    notes = []
    assert normalize_timestamp(local, 'duty_start', NY, notes) == expected
    assert notes == []


@pytest.mark.parametrize('key,expected,choice', [
    ('duty_start', '2026-11-01T05:30:00Z', 'earliest'),               # 01:30 EDT
    ('duty_end', '2026-11-01T06:30:00Z', 'latest'),                   # 01:30 EST
    ('certification_expires_at', '2026-11-01T05:30:00Z', 'earliest'),
])
def test_repeated_hour_uses_stricter_reading(key, expected, choice):
    notes = []
    assert normalize_timestamp('2026-11-01 01:30', key, NY, notes) == expected
    assert notes == [{'field': key, 'local': '2026-11-01 01:30', 'zone': NY, 'kind': 'repeated', 'choice': choice, 'utc': expected}]


@pytest.mark.parametrize('key,expected', [('duty_start', '2026-03-08T06:30:00Z'), ('duty_end', '2026-03-08T07:30:00Z')])
def test_skipped_hour_uses_stricter_reading(key, expected):
    notes = []
    assert normalize_timestamp('2026-03-08 02:30', key, NY, notes) == expected
    assert notes[0]['kind'] == 'skipped' and notes[0]['utc'] == expected


def test_other_hemisphere_and_notes_are_optional():
    # Sydney falls back on 2026-04-05 at 03:00 local; 02:30 repeats.
    assert normalize_timestamp('2026-04-05 02:30', 'duty_start', 'Australia/Sydney') == '2026-04-04T15:30:00Z'
    assert normalize_timestamp('2026-04-05 02:30', 'unknown_field', 'Australia/Sydney') == '2026-04-04T15:30:00Z'


def test_explicit_offset_is_never_adjusted():
    rows = parse_roster('r.csv', csv_bytes([duty('2026-11-01T01:30:00-05:00', '2026-11-01T09:00:00-05:00')]), {'timezone': NY})
    assert rows[0]['duty_start'] == '2026-11-01T06:30:00Z' and 'dst_adjustments' not in rows[0]


def test_rows_record_each_adjustment():
    rows = parse_roster('r.csv', csv_bytes([duty('2026-11-01 01:30', '2026-11-01 01:45', cert='2026-11-01 01:50')]), {'timezone': NY})
    assert [n['field'] for n in rows[0]['dst_adjustments']] == ['duty_start', 'duty_end', 'certification_expires_at']
    # Earliest start and latest end make the duty 1 h 15 min, the longest possible reading.
    assert (rows[0]['duty_start'], rows[0]['duty_end']) == ('2026-11-01T05:30:00Z', '2026-11-01T06:45:00Z')


def test_duty_length_counts_real_elapsed_hours_across_clock_changes():
    rows = parse_roster('r.csv', csv_bytes([
        duty('2026-11-01 00:00', '2026-11-01 12:00', duty_id='AUTUMN'),          # 13 real hours
        duty('2026-03-08 00:00', '2026-03-08 12:30', duty_id='SPRING', crew='C2'),  # 11.5 real hours
    ]), {'timezone': NY})
    result = check_roster(rows, DEFAULT_RULES)
    assert [(f['duty_id'], f['code'], f['observed']) for f in result['flags']] == [('AUTUMN', 'DUTY_LIMIT', '13 h')]


def test_rest_counts_real_elapsed_hours_across_clock_changes():
    # 20:00 to 06:00 local looks like 10 h but is 11 h when clocks fall back overnight.
    rows = parse_roster('r.csv', csv_bytes([
        duty('2026-10-31 12:00', '2026-10-31 20:00', duty_id='A1'),
        duty('2026-11-01 06:00', '2026-11-01 10:00', duty_id='A2'),
        duty('2026-03-07 12:00', '2026-03-07 20:00', duty_id='S1', crew='C2'),
        duty('2026-03-08 06:00', '2026-03-08 10:00', duty_id='S2', crew='C2'),  # only 9 real hours of rest
    ]), {'timezone': NY})
    flags = check_roster(rows, DEFAULT_RULES)['flags']
    assert [(f['duty_id'], f['code'], f['observed']) for f in flags] == [('S2', 'REST_MIN', '9 h')]


def test_upload_reports_adjusted_rows(tmp_path):
    with TestClient(create_app(tmp_path / 'test.db')) as c:
        response = c.post('/api/auth/login', json={'email': 'scheduler@crewcheck.local', 'password': 'SchedulerDemo!2026'})
        c.headers['X-CSRF-Token'] = response.json()['csrf']
        content = csv_bytes([duty('2026-11-01 01:30', '2026-11-01 09:00'), duty('2026-11-02 08:00', '2026-11-02 12:00', duty_id='D2')])
        upload = c.post('/api/uploads', files={'file': ('dst.csv', content)}, data={'options': '{"timezone": "America/New_York"}'})
        assert upload.status_code == 201 and upload.json()['dst_adjusted_rows'] == 1
        assert upload.json()['preview'][0]['dst_adjustments'][0]['kind'] == 'repeated'
