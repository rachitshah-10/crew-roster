from pathlib import Path

import pytest

from fastapi.testclient import TestClient

from app.engine import DEFAULT_RULES, check_roster
from app.main import create_app
from app.parsing import parse_roster
from app.timeline import build_timeline

SAMPLES = Path(__file__).resolve().parents[1] / 'samples'


def duty(row_number, crew, duty_id, start, end, cert='2027-01-01T00:00:00Z', name=None, role='pilot'):
    return {'row_number': row_number, 'crew_id': crew, 'crew_name': name or crew, 'role': role, 'duty_id': duty_id,
            'duty_start': start, 'duty_end': end, 'certification_expires_at': cert}


def timeline_for(rows, zone='UTC'):
    return build_timeline(check_roster(rows, DEFAULT_RULES), zone)


def test_empty_roster_has_no_range():
    assert build_timeline({'rows': [], 'flags': []}) == {'zone': 'UTC', 'start': None, 'end': None, 'days': [], 'crew': []}


def test_range_covers_whole_utc_days_and_counts_findings_by_start_day():
    result = timeline_for([
        duty(2, 'C1', 'D1', '2026-11-09T06:00:00Z', '2026-11-09T20:00:00Z'),   # 14 h > 12 h
        duty(3, 'C1', 'D2', '2026-11-10T22:00:00+09:00', '2026-11-11T01:00:00Z'),  # exactly 12 h
    ])
    assert result['start'] == '2026-11-09T00:00:00Z'
    assert result['end'] == '2026-11-12T00:00:00Z'
    assert [(d['date'], d['findings'], d['hours']) for d in result['days']] == [
        ('2026-11-09', 1, 24), ('2026-11-10', 0, 24), ('2026-11-11', 0, 24)]
    assert result['days'][1]['start'] == '2026-11-10T00:00:00Z' and result['days'][1]['end'] == '2026-11-11T00:00:00Z'
    # Offsets are normalized to UTC in the timeline.
    assert result['crew'][0]['duties'][1]['start'] == '2026-11-10T13:00:00Z'


def test_range_end_on_midnight_is_not_extended():
    result = timeline_for([duty(2, 'C1', 'D1', '2026-11-09T14:00:00Z', '2026-11-10T00:00:00Z')])
    assert result['end'] == '2026-11-10T00:00:00Z' and len(result['days']) == 1


def test_days_follow_display_zone():
    # 23:00 UTC on the 9th is already the 10th in Seoul (UTC+9).
    result = timeline_for([duty(2, 'C1', 'D1', '2026-11-09T23:00:00Z', '2026-11-10T16:00:00Z')], 'Asia/Seoul')
    assert result['zone'] == 'Asia/Seoul'
    assert [(d['date'], d['start'], d['findings']) for d in result['days']] == [
        ('2026-11-10', '2026-11-09T15:00:00Z', 1), ('2026-11-11', '2026-11-10T15:00:00Z', 0)]
    assert result['crew'][0]['duties'][0]['start'] == '2026-11-09T23:00:00Z'  # instants stay in UTC


def test_daylight_saving_days_are_23_and_25_hours():
    spring = timeline_for([duty(2, 'C1', 'D1', '2026-03-08T12:00:00Z', '2026-03-08T20:00:00Z')], 'America/New_York')
    assert spring['days'] == [{'date': '2026-03-08', 'start': '2026-03-08T05:00:00Z', 'end': '2026-03-09T04:00:00Z',
                               'hours': 23.0, 'findings': 0}]
    autumn = timeline_for([duty(2, 'C1', 'D1', '2026-11-01T12:00:00Z', '2026-11-01T20:00:00Z')], 'America/New_York')
    assert autumn['days'][0]['hours'] == 25.0 and autumn['days'][0]['end'] == '2026-11-02T05:00:00Z'


def test_midnight_inside_a_dst_gap_moves_forward():
    # Chile springs forward at local midnight; 2026-09-06 00:00 does not exist in Santiago.
    result = timeline_for([duty(2, 'C1', 'D1', '2026-09-06T12:00:00Z', '2026-09-06T14:00:00Z')], 'America/Santiago')
    day = result['days'][0]
    assert day['date'] == '2026-09-06' and day['start'] == '2026-09-06T04:00:00Z' and day['hours'] == 23.0


@pytest.mark.parametrize('zone', ['Mars/Olympus', '../etc', ''])
def test_unknown_display_zone(zone):
    with pytest.raises(ValueError, match='Unknown time zone'):
        build_timeline({'rows': [], 'flags': []}, zone)


def test_utc_aliases():
    assert build_timeline({'rows': [], 'flags': []}, 'Z')['zone'] == 'Z'


def test_duty_status_and_short_rest_gap():
    result = timeline_for([
        duty(2, 'C1', 'D1', '2026-11-09T06:00:00Z', '2026-11-09T14:00:00Z'),
        duty(3, 'C1', 'D2', '2026-11-09T20:00:00Z', '2026-11-09T23:00:00Z'),  # 6 h rest
        duty(4, 'C1', 'D3', '2026-11-11T06:00:00Z', '2026-11-11T10:00:00Z', cert=''),
    ])
    lane = result['crew'][0]
    assert [d['status'] for d in lane['duties']] == ['ok', 'review', 'incomplete']
    assert lane['duties'][1]['codes'] == ['REST_MIN'] and lane['duties'][2]['codes'] == ['CERT_MISSING']
    assert lane['findings'] == 2
    assert lane['gaps'] == [{'kind': 'short_rest', 'code': 'REST_MIN', 'title': 'Insufficient rest', 'row_number': 3, 'previous_duty_id': 'D1', 'duty_id': 'D2',
                             'start': '2026-11-09T14:00:00Z', 'end': '2026-11-09T20:00:00Z', 'observed': '6 h'}]


def test_mixed_review_and_incomplete_flags_show_as_review():
    lane = timeline_for([duty(2, 'C1', 'D1', '2026-11-09T00:00:00Z', '2026-11-09T14:00:00Z', cert='')])['crew'][0]
    assert sorted(lane['duties'][0]['codes']) == ['CERT_MISSING', 'DUTY_LIMIT']
    assert lane['duties'][0]['status'] == 'review'


def test_overlap_gap_spans_the_overlapping_interval():
    lane = timeline_for([
        duty(2, 'C1', 'D1', '2026-11-09T06:00:00Z', '2026-11-09T14:00:00Z'),
        duty(3, 'C1', 'D2', '2026-11-09T12:00:00Z', '2026-11-09T16:00:00Z'),
    ])['crew'][0]
    assert lane['gaps'] == [{'kind': 'overlap', 'code': 'DUTY_OVERLAP', 'title': 'Duties overlap', 'row_number': 3, 'previous_duty_id': 'D1', 'duty_id': 'D2',
                             'start': '2026-11-09T12:00:00Z', 'end': '2026-11-09T14:00:00Z', 'observed': '2 h overlap'}]


def test_lanes_sorted_by_findings_then_crew_and_duties_by_time():
    result = timeline_for([
        duty(2, 'B', 'B2', '2026-11-10T06:00:00Z', '2026-11-10T08:00:00Z'),
        duty(3, 'B', 'B1', '2026-11-09T06:00:00Z', '2026-11-09T08:00:00Z'),
        duty(4, 'C', 'C1', '2026-11-09T06:00:00Z', '2026-11-09T20:00:00Z'),
        duty(5, 'A', 'A1', '2026-11-09T06:00:00Z', '2026-11-09T08:00:00Z', role='cabin', name='Alex'),
    ])
    assert [lane['crew_id'] for lane in result['crew']] == ['C', 'A', 'B']
    assert [d['duty_id'] for d in result['crew'][2]['duties']] == ['B1', 'B2']
    assert result['crew'][1]['crew_name'] == 'Alex' and result['crew'][1]['role'] == 'cabin'


def test_sample_roster_findings_all_appear_on_the_timeline():
    rows = parse_roster('review_roster.csv', (SAMPLES / 'review_roster.csv').read_bytes())
    checked = check_roster(rows, DEFAULT_RULES)
    result = build_timeline(checked)
    assert sum(lane['findings'] for lane in result['crew']) == checked['summary']['findings']
    assert sum(day['findings'] for day in result['days']) == checked['summary']['findings']
    assert sum(len(lane['duties']) for lane in result['crew']) == checked['summary']['duties']
    assert len(result['crew']) == checked['summary']['crew']


def login(client, role):
    password = 'ManagerDemo!2026' if role == 'manager' else 'SchedulerDemo!2026'
    response = client.post('/api/auth/login', json={'email': role + '@crewcheck.local', 'password': password})
    client.headers['X-CSRF-Token'] = response.json()['csrf']


def test_timeline_endpoint_matches_saved_run_and_enforces_access(tmp_path):
    app = create_app(tmp_path / 'test.db')
    with TestClient(app) as scheduler, TestClient(app) as manager, TestClient(app) as anonymous:
        login(scheduler, 'scheduler'); login(manager, 'manager')
        upload = manager.post('/api/uploads', files={'file': ('s.csv', (SAMPLES / 'sample_roster.csv').read_bytes(), 'text/csv')}).json()
        run = manager.post(f"/api/uploads/{upload['id']}/check").json()
        response = manager.get(f"/api/runs/{run['id']}/timeline")
        assert response.status_code == 200
        assert response.json() == build_timeline(run)
        seoul = manager.get(f"/api/runs/{run['id']}/timeline?tz=Asia/Seoul")
        assert seoul.status_code == 200 and seoul.json() == build_timeline(run, 'Asia/Seoul')
        assert manager.get(f"/api/runs/{run['id']}/timeline?tz=Nowhere/City").status_code == 422
        assert scheduler.get(f"/api/runs/{run['id']}/timeline").status_code == 404
        assert manager.get('/api/runs/' + 'f' * 24 + '/timeline').status_code == 404
        assert anonymous.get(f"/api/runs/{run['id']}/timeline").status_code == 401
