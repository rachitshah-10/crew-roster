"""Manager-built rules: every building block, its validation, and the API around it."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.engine import check_roster
from app.main import create_app
from app.schema import rule_versions
from sqlalchemy import insert
from app.ruleset import PRESETS, RulePreview, RuleSetChange, RuleSpec, builtin_rules, catalog, normalize_ruleset

SAMPLES = Path(__file__).resolve().parents[1] / 'samples'


def rule(**overrides):
    base = {'code': 'CUSTOM', 'name': 'Custom rule', 'enabled': True, 'role': 'all', 'when': [], 'measure': 'duty_hours',
            'per': 'duty', 'window_days': None, 'compare': '<=', 'limit': 10.0, 'zone': 'UTC', 'at': 'end'}
    return RuleSpec(**{**base, **overrides}).model_dump()


def duty(n, start, end, crew='C1', role='pilot', cert='2030-01-01T00:00:00Z', duty_id=None):
    return {'row_number': n, 'crew_id': crew, 'crew_name': crew, 'role': role, 'duty_id': duty_id or f'D{n}',
            'duty_start': start, 'duty_end': end, 'certification_expires_at': cert}


def flags(rows, *rules):
    return [(f['duty_id'], f['code'], f['observed']) for f in check_roster(rows, {'rules': list(rules)})['flags']]


# ---------------------------------------------------------------- validation

def test_presets_and_builtins_are_valid():
    RuleSetChange(expected_version=1, name='All presets', reason='Validate presets', rules=PRESETS)
    assert [r['code'] for r in builtin_rules()] == ['DUTY_LIMIT', 'CERT_EXPIRED', 'DUTY_OVERLAP', 'REST_MIN']
    assert set(catalog()) == {'measures', 'periods', 'conditions', 'roles', 'compare', 'presets'}


@pytest.mark.parametrize('overrides,message', [
    ({'measure': 'rest_hours', 'per': 'duty'}, 'can be checked after each duty'),
    ({'measure': 'duty_count', 'per': 'duty'}, 'on any calendar day or in any rolling window'),
    ({'per': 'rolling_days'}, 'how many days'),
    ({'limit': 1001}, 'between 0 and 1000 h'),
    ({'limit': -1}, 'between 0 and 1000 h'),
    ({'zone': 'Nowhere/City'}, 'valid time zone'),
    ({'name': '   x   '}, 'at least 3 characters'),
    ({'code': 'lower'}, 'pattern'),
    ({'when': [{'field': 'start_time', 'value': ['22:00']}]}, 'two times'),
    ({'when': [{'field': 'start_time', 'value': ['25:00', '01:00']}]}, 'two times'),
    ({'when': [{'field': 'start_time', 'value': ['05:00', '05:00']}]}, 'must differ'),
    ({'when': [{'field': 'weekday', 'value': [7]}]}, 'weekdays'),
    ({'when': [{'field': 'weekday', 'value': [1, 1]}]}, 'weekdays'),
    ({'when': [{'field': 'crew_id', 'value': ['  ']}]}, 'crew IDs'),
    ({'when': [{'field': 'crew_id', 'value': ['x' * 41]}]}, 'crew IDs'),
    ({'when': [{'field': 'colour', 'value': ['red']}]}, 'field'),
    ({'limit': float('inf')}, 'finite'),
])
def test_invalid_rules_are_rejected_with_plain_messages(overrides, message):
    with pytest.raises(ValidationError, match=message):
        rule(**overrides)


def test_validation_tidies_values():
    cleaned = rule(name='  Night cap  ', per='duty', window_days=5, when=[{'field': 'crew_id', 'value': [' C1 ', 'C2']}])
    assert cleaned['name'] == 'Night cap' and cleaned['window_days'] is None
    assert cleaned['when'][0]['value'] == ['C1', 'C2']


def test_rule_codes_must_be_unique():
    for model, extra in ((RuleSetChange, {'expected_version': 1, 'name': 'Set', 'reason': 'Because'}), (RulePreview, {'run_id': 'a' * 24})):
        with pytest.raises(ValidationError, match='different code'):
            model(**extra, rules=[rule(), rule()])


def test_legacy_rule_versions_are_converted():
    legacy = {'name': 'Old', 'max_duty_hours': 9, 'min_rest_hours': 11, 'certification_at': 'start'}
    converted = normalize_ruleset(legacy)
    assert converted['name'] == 'Old' and converted['rules'][0]['limit'] == 9 and converted['rules'][1]['at'] == 'start'
    assert normalize_ruleset({'rules': []}) == {'name': 'Illustrative MVP rules', 'rules': []}


# ---------------------------------------------------------------- building blocks

def test_role_filter_and_disabled_rules():
    rows = [duty(2, '2026-11-09T00:00:00Z', '2026-11-09T11:00:00Z'), duty(3, '2026-11-09T00:00:00Z', '2026-11-09T11:00:00Z', crew='C2', role='cabin')]
    assert flags(rows, rule(role='cabin')) == [('D3', 'CUSTOM', '11 h')]
    assert flags(rows, rule(enabled=False)) == []


@pytest.mark.parametrize('compare,limit,flagged', [('<=', 11, False), ('<', 11, True), ('>=', 12, True), ('>', 11, True), ('>', 10, False)])
def test_compare_operators(compare, limit, flagged):
    rows = [duty(2, '2026-11-09T00:00:00Z', '2026-11-09T11:00:00Z')]
    assert bool(flags(rows, rule(compare=compare, limit=limit))) is flagged


@pytest.mark.parametrize('condition,zone,expected', [
    ({'field': 'start_time', 'value': ['22:00', '05:00']}, 'UTC', ['NIGHT', 'LATE']),          # wraps midnight
    ({'field': 'start_time', 'value': ['06:00', '18:00']}, 'UTC', ['DAY']),
    ({'field': 'start_time', 'value': ['06:00', '18:00']}, 'Asia/Seoul', ['DAY', 'NIGHT', 'LATE']),  # 17:00/08:00/11:00 KST
    ({'field': 'start_time', 'value': ['10:00', '18:00']}, 'Asia/Seoul', ['DAY', 'LATE']),
    ({'field': 'end_time', 'value': ['18:00', '23:59']}, 'UTC', ['DAY']),
    ({'field': 'overlaps_time', 'value': ['02:00', '05:59']}, 'UTC', ['NIGHT', 'LATE']),
    ({'field': 'overlaps_time', 'value': ['23:30', '00:30']}, 'UTC', ['NIGHT']),              # window across midnight
    ({'field': 'weekday', 'value': [0]}, 'UTC', ['DAY', 'NIGHT']),                             # 2026-11-09 is a Monday
    ({'field': 'weekday', 'value': [1]}, 'UTC', ['LATE']),
    ({'field': 'weekday', 'value': [0]}, 'Asia/Seoul', ['DAY']),                               # NIGHT starts Tuesday in Seoul
    ({'field': 'crew_id', 'value': ['C2']}, 'UTC', ['LATE']),
])
def test_conditions_select_duties_in_the_rule_zone(condition, zone, expected):
    rows = [duty(2, '2026-11-09T08:00:00Z', '2026-11-09T19:00:00Z', duty_id='DAY'),
            duty(3, '2026-11-09T23:00:00Z', '2026-11-10T10:00:00Z', duty_id='NIGHT'),
            duty(4, '2026-11-10T02:00:00Z', '2026-11-10T13:00:00Z', crew='C2', duty_id='LATE')]
    assert [f[0] for f in flags(rows, rule(when=[condition], zone=zone))] == expected


def test_conditions_combine_with_and():
    rows = [duty(2, '2026-11-09T23:00:00Z', '2026-11-10T10:00:00Z'), duty(3, '2026-11-10T23:00:00Z', '2026-11-11T10:00:00Z', crew='C2')]
    both = [{'field': 'start_time', 'value': ['22:00', '05:00']}, {'field': 'crew_id', 'value': ['C2']}]
    assert [f[0] for f in flags(rows, rule(when=both))] == ['D3']


def test_hours_per_calendar_day_are_clipped_at_local_midnight():
    rows = [duty(2, '2026-11-09T06:00:00Z', '2026-11-09T12:00:00Z'), duty(3, '2026-11-09T18:00:00Z', '2026-11-10T04:00:00Z')]
    assert flags(rows, rule(per='day', limit=11)) == [('D3', 'CUSTOM', '12 h')]   # 6 h + 6 h before midnight
    result = check_roster(rows, {'rules': [rule(per='day', limit=11)]})['flags'][0]
    assert result['evidence'] == {'day': '2026-11-09', 'zone': 'UTC', 'duties': ['D2', 'D3']}
    # In Seoul (UTC+9) the same duties fall on different local days.
    assert flags(rows, rule(per='day', limit=11, zone='Asia/Seoul')) == []


def test_duty_count_per_day():
    rows = [duty(n, f'2026-11-09T0{n}:00:00Z', f'2026-11-09T0{n}:30:00Z') for n in (2, 3, 4)]
    assert flags(rows, rule(measure='duty_count', per='day', limit=2)) == [('D4', 'CUSTOM', '3 duties')]


def test_rolling_window_hours_and_count():
    rows = [duty(n, f'2026-11-{n:02d}T06:00:00Z', f'2026-11-{n:02d}T16:00:00Z') for n in range(2, 10)]   # 8 days x 10 h
    hours = check_roster(rows, {'rules': [rule(per='rolling_days', window_days=7, limit=60)]})['flags']
    assert [(f['duty_id'], f['observed'], f['expected']) for f in hours] == [('D8', '70 h', '≤ 60 h in any 7 days'), ('D9', '70 h', '≤ 60 h in any 7 days')]
    assert hours[0]['evidence']['window_start'] == '2026-11-01T16:00:00Z' and len(hours[0]['evidence']['duties']) == 7
    counted = flags(rows, rule(measure='duty_count', per='rolling_days', window_days=3, limit=2))
    assert [f[0] for f in counted][:2] == ['D4', 'D5']


def test_rolling_window_clips_partial_duties():
    rows = [duty(2, '2026-11-01T08:00:00Z', '2026-11-01T14:00:00Z'), duty(3, '2026-11-02T06:00:00Z', '2026-11-02T12:00:00Z')]
    # Window for D3 is 2026-11-01T12:00 to 2026-11-02T12:00: 2 h of D2 plus 6 h of D3.
    assert flags(rows, rule(per='rolling_days', window_days=1, limit=7)) == [('D3', 'CUSTOM', '8 h')]


def test_consecutive_duty_days_and_breaks():
    days = [9, 10, 11, 13, 14, 15, 16]
    rows = [duty(n, f'2026-11-{d:02d}T08:00:00Z', f'2026-11-{d:02d}T12:00:00Z') for n, d in enumerate(days, 2)]
    found = check_roster(rows, {'rules': [rule(measure='consecutive_days', per='streak', limit=3)]})['flags']
    assert [(f['duty_id'], f['observed']) for f in found] == [('D8', '4 days')]
    assert found[0]['evidence'] == {'first_day': '2026-11-13', 'last_day': '2026-11-16', 'zone': 'UTC'}


def test_one_finding_per_duty_per_rule():
    # One overnight duty touches two days that both exceed a 1-day streak limit.
    rows = [duty(2, '2026-11-09T08:00:00Z', '2026-11-09T12:00:00Z'), duty(3, '2026-11-10T20:00:00Z', '2026-11-11T04:00:00Z')]
    assert flags(rows, rule(measure='consecutive_days', per='streak', limit=1)) == [('D3', 'CUSTOM', '2 days')]


def test_rest_after_matching_duty_only():
    rows = [duty(2, '2026-11-09T22:00:00Z', '2026-11-10T06:00:00Z'), duty(3, '2026-11-10T18:00:00Z', '2026-11-10T20:00:00Z'),
            duty(4, '2026-11-11T08:00:00Z', '2026-11-11T12:00:00Z')]
    night_rest = rule(measure='rest_hours', per='between_duties', compare='>=', limit=14, when=[{'field': 'overlaps_time', 'value': ['02:00', '05:59']}])
    # Only the rest after the night duty D2 (12 h) counts; rest after D3 (12 h) is not after a night duty.
    assert flags(rows, night_rest) == [('D3', 'CUSTOM', '12 h')]


def test_overlap_with_tolerance():
    rows = [duty(2, '2026-11-09T06:00:00Z', '2026-11-09T14:00:00Z'), duty(3, '2026-11-09T13:30:00Z', '2026-11-09T18:00:00Z'),
            duty(4, '2026-11-09T17:00:00Z', '2026-11-09T20:00:00Z')]
    found = check_roster(rows, {'rules': [rule(measure='overlap_hours', per='between_duties', limit=0.5)]})['flags']
    assert [(f['duty_id'], f['observed'], f['expected']) for f in found] == [('D4', '1 h overlap', '≤ 0.5 h')]


def test_certification_margin():
    rows = [duty(2, '2026-11-09T06:00:00Z', '2026-11-09T14:00:00Z', cert='2026-11-30T00:00:00Z'),
            duty(3, '2026-11-10T06:00:00Z', '2026-11-10T14:00:00Z', crew='C2', cert='2027-01-01T00:00:00Z'),
            duty(4, '2026-11-10T06:00:00Z', '2026-11-10T14:00:00Z', crew='C3', cert='')]
    margin = rule(code='CERT_MARGIN', measure='certification_remaining_hours', compare='>=', limit=720)
    found = check_roster(rows, {'rules': [margin]})['flags']
    assert [(f['duty_id'], f['code'], f['severity']) for f in found] == [('D2', 'CERT_MARGIN', 'review'), ('D4', 'CERT_MISSING', 'incomplete')]
    assert found[0]['expected'] == 'Valid ≥ 720 h after duty end' and found[0]['evidence']['remaining_hours'] == 490
    start = rule(code='CERT_START', measure='certification_remaining_hours', compare='>=', limit=500, at='start')
    assert check_roster(rows[:1], {'rules': [start]})['flags'][0]['evidence']['assessment_time'] == '2026-11-09T06:00:00Z'


def test_builtin_and_custom_rules_together():
    rows = [duty(2, '2026-11-09T22:00:00Z', '2026-11-10T09:30:00Z')]   # 11.5 h night duty
    night = next(p for p in PRESETS if p['code'] == 'NIGHT_DUTY_LIMIT')
    result = check_roster(rows, {'rules': builtin_rules() + [night]})
    assert [f['code'] for f in result['flags']] == ['NIGHT_DUTY_LIMIT']
    assert result['engine_version'] == '2.0.0'


# ---------------------------------------------------------------- API

def login(client, role):
    password = 'ManagerDemo!2026' if role == 'manager' else 'SchedulerDemo!2026'
    response = client.post('/api/auth/login', json={'email': role + '@crewcheck.local', 'password': password})
    client.headers['X-CSRF-Token'] = response.json()['csrf']


@pytest.fixture
def clients(tmp_path):
    app = create_app(tmp_path / 'test.db')
    with TestClient(app) as scheduler, TestClient(app) as manager:
        login(scheduler, 'scheduler'); login(manager, 'manager')
        yield scheduler, manager, app


def checked(client, name='sample_roster.csv'):
    upload = client.post('/api/uploads', files={'file': (name, (SAMPLES / name).read_bytes())}).json()
    return client.post(f"/api/uploads/{upload['id']}/check").json()


def test_catalog_requires_sign_in(clients):
    scheduler, _, _ = clients
    assert scheduler.get('/api/rules/catalog').json()['measures']['duty_hours']['unit'] == 'h'
    with TestClient(clients[2]) as anonymous:
        assert anonymous.get('/api/rules/catalog').status_code == 401


def test_preview_compares_draft_rules_with_saved_check(clients):
    scheduler, manager, _ = clients
    run = checked(manager, 'review_roster.csv')
    stricter = builtin_rules(max_duty_hours=6) + [next(p for p in PRESETS if p['code'] == 'DAILY_DUTIES')]
    preview = manager.post('/api/rules/preview', json={'run_id': run['id'], 'rules': stricter}).json()
    assert preview['saved'] == run['summary'] and preview['added'] > 0 and preview['removed'] == 0
    assert [r['code'] for r in preview['by_rule']] == [r['code'] for r in stricter]
    assert preview['proposed']['findings'] == sum(r['findings'] for r in preview['by_rule']) + preview['evidence_missing']
    assert 0 < len(preview['examples']) <= 10
    lenient = [dict(r, enabled=False) for r in builtin_rules()]
    off = manager.post('/api/rules/preview', json={'run_id': run['id'], 'rules': lenient}).json()
    assert off['proposed']['findings'] == 0 and off['removed'] == run['summary']['findings']
    assert manager.get('/api/rules').json()['version'] == 1   # nothing saved
    assert scheduler.post('/api/rules/preview', json={'run_id': run['id'], 'rules': stricter}).status_code == 403
    assert manager.post('/api/rules/preview', json={'run_id': '0' * 24, 'rules': stricter}).status_code == 404


def test_saved_custom_rules_apply_to_new_uploads(clients):
    scheduler, manager, _ = clients
    custom = builtin_rules() + [{**rule(code='SHORT_DUTY', name='Short duty', compare='>=', limit=13)}]
    saved = manager.post('/api/rules', json={'expected_version': 1, 'name': 'With short duties', 'reason': 'Flag tiny duties', 'rules': custom})
    assert saved.status_code == 200 and saved.json()['rules'][-1]['code'] == 'SHORT_DUTY'
    run = checked(scheduler)
    assert run['rules']['version'] == 2 and 'SHORT_DUTY' in {f['code'] for f in run['flags']}


def test_rule_validation_errors_point_to_the_rule(clients):
    _, manager, _ = clients
    bad = builtin_rules() + [rule(code='WEEKLY')]
    bad[-1]['per'] = 'rolling_days'
    response = manager.post('/api/rules', json={'expected_version': 1, 'name': 'Broken', 'reason': 'Testing errors', 'rules': bad})
    assert response.status_code == 422
    assert response.json()['detail'][0]['loc'][:3] == ['body', 'rules', 4]


def test_historical_legacy_rule_versions_still_work(clients):
    scheduler, manager, app = clients
    legacy = {'name': 'Legacy', 'max_duty_hours': 15, 'min_rest_hours': 8, 'certification_at': 'start'}
    with app.state.repo.engine.begin() as db:
        db.execute(insert(rule_versions).values(id=2, created_at='2026-01-01T00:00:00Z', created_by='manager',
                                                reason='Legacy format', rules_json=json.dumps(legacy)))
    active = scheduler.get('/api/rules').json()
    assert active['name'] == 'Legacy' and active['rules'][0]['limit'] == 15
    assert checked(scheduler)['summary']['findings'] == 1   # only the 7 h rest remains below 8 h
    assert [v['version'] for v in manager.get('/api/rules/history').json()] == [2, 1]
