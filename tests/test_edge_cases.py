"""Edge-case samples match their documented outcomes, and certification expiry
exactly at the assessment point is treated as still valid."""
import csv
import io
import json
from collections import Counter
from pathlib import Path

import pytest

from app.engine import DEFAULT_RULES, check_roster
from app.parsing import COLUMNS, RosterError, parse_roster

EDGE = Path(__file__).resolve().parents[1] / 'samples/edge-cases'
EXPECTED = json.loads((EDGE / 'expected-results.json').read_text())
CASES = [(case, suffix) for case in EXPECTED['cases'] for suffix in ('.csv', '.xlsx')]


@pytest.mark.parametrize('case,suffix', CASES, ids=[f"{c['name']}{s}" for c, s in CASES])
def test_edge_case_samples_match_expected_results(case, suffix):
    expected = case['expected']
    path = EDGE / (case['name'] + suffix)
    if expected.get('rejected'):
        with pytest.raises(RosterError) as error:
            parse_roster(path.name, path.read_bytes())
        assert error.value.errors == expected['errors']
        return
    result = check_roster(parse_roster(path.name, path.read_bytes()), {**DEFAULT_RULES, **EXPECTED['rules']})
    summary = result['summary']
    assert (summary['duties'], summary['flagged_duties'], summary['findings']) == (expected['duties'], expected['flagged_duties'], expected['findings'])
    assert Counter(f['code'] for f in result['flags']) == Counter(expected['codes'])
    flagged = {f['duty_id'] for f in result['flags']}
    if 'duty' in expected:
        assert flagged == {expected['duty']}
    if 'duty_ids' in expected:
        assert flagged == set(expected['duty_ids'])
    if 'severity' in expected:
        assert {f['severity'] for f in result['flags']} == {expected['severity']}


def roster(cert, start='2026-11-10T08:00:00Z', end='2026-11-10T16:00:00Z'):
    output = io.StringIO()
    csv.writer(output).writerows([COLUMNS, ['C1', 'Synthetic Test', 'pilot', 'D1', start, end, cert]])
    return parse_roster('r.csv', output.getvalue().encode())


def cert_codes(rows, at='end'):
    return [f['code'] for f in check_roster(rows, {**DEFAULT_RULES, 'certification_at': at})['flags']]


@pytest.mark.parametrize('cert,at,codes', [
    ('2026-11-10T16:00:00Z', 'end', []),                         # expiry == duty end
    ('2026-11-10T15:59:59.999Z', 'end', ['CERT_EXPIRED']),       # 1 ms before duty end
    ('2026-11-10T16:00:00.001Z', 'end', []),                     # 1 ms after duty end
    ('2026-11-11T01:00:00+09:00', 'end', []),                    # same instant as duty end, other offset
    ('2026-11-10T11:00:00-05:00', 'end', []),
    ('2026-11-10T08:00:00Z', 'end', ['CERT_EXPIRED']),           # expiry == duty start, assessed at end
    ('2026-11-10T08:00:00Z', 'start', []),                       # expiry == duty start, assessed at start
    ('2026-11-10T07:59:59.999Z', 'start', ['CERT_EXPIRED']),
    ('2026-11-10T16:00:00Z', 'start', []),                       # expiry == end is fine when assessed at start
])
def test_certification_expiry_boundaries(cert, at, codes):
    assert cert_codes(roster(cert), at) == codes


def test_expiry_equal_to_overnight_duty_end():
    rows = roster('2026-11-11T04:00:00Z', start='2026-11-10T20:00:00Z', end='2026-11-11T04:00:00Z')
    assert cert_codes(rows) == []


def test_expiry_equal_to_duty_end_in_local_zone_input():
    # Naive local times, converted with a selected zone, still compare as instants.
    output = io.StringIO()
    csv.writer(output).writerows([COLUMNS, ['C1', 'Synthetic Test', 'pilot', 'D1', '2026-11-10 08:00', '2026-11-10 16:00', '2026-11-10 16:00']])
    rows = parse_roster('r.csv', output.getvalue().encode(), {'timezone': 'Asia/Seoul'})
    assert rows[0]['duty_end'] == rows[0]['certification_expires_at'] == '2026-11-10T07:00:00Z'
    assert cert_codes(rows) == []


def test_expired_evidence_records_assessment_point():
    flag = check_roster(roster('2026-11-10T15:59:59.999Z'), DEFAULT_RULES)['flags'][0]
    assert flag['evidence'] == {'certification_expires_at': '2026-11-10T15:59:59.999Z', 'assessment_time': '2026-11-10T16:00:00Z'}
    assert flag['expected'] == 'Valid through duty end'


def test_certification_boundary_sample_passes_when_assessed_at_start():
    path = EDGE / '07_certification_boundaries.csv'
    rows = parse_roster(path.name, path.read_bytes())
    assert cert_codes(rows, 'start') == []
