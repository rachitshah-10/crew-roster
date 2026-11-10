import csv
import io
import zipfile

import pytest
from openpyxl import Workbook

from app.parsing import COLUMNS, ImportSetupError, RosterError, normalize_timestamp, parse_roster

VALID = ['C1', 'Synthetic Test', 'pilot', 'D1', '2026-11-09T06:00:00Z', '2026-11-09T18:00:00Z', '2027-01-01T00:00:00Z']


def csv_bytes(rows, header=COLUMNS):
    output = io.StringIO()
    csv.writer(output).writerows([header, *rows])
    return output.getvalue().encode()


def xlsx_bytes(rows):
    wb = Workbook()
    for row in rows:
        wb.active.append(row)
    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


def zip_bytes(names):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        for name in names:
            archive.writestr(name, b'')
    return output.getvalue()


def row_errors(rows, **kwargs):
    with pytest.raises(RosterError) as error:
        parse_roster('r.csv', csv_bytes(rows, **kwargs))
    return [e['message'] for e in error.value.errors]


@pytest.mark.parametrize('zone,expected', [('+09:00', '2026-11-08T21:00:00Z'), ('-05:30', '2026-11-09T11:30:00Z'),
                                           ('Z', '2026-11-09T06:00:00Z'), ('Asia/Seoul', '2026-11-08T21:00:00Z')])
def test_naive_times_use_selected_zone(zone, expected):
    assert normalize_timestamp('2026-11-09 06:00', 'duty_start', zone) == expected


def test_explicit_offset_wins_over_selected_zone():
    assert normalize_timestamp('2026-11-09T06:00:00+02:00', 'duty_start', 'Asia/Seoul') == '2026-11-09T04:00:00Z'


@pytest.mark.parametrize('zone,message', [('+24:00', 'Invalid UTC offset.'), ('+09:60', 'Invalid UTC offset.'),
                                          ('Mars/Olympus', 'valid source time zone'), ('../etc', 'valid source time zone')])
def test_invalid_selected_zone(zone, message):
    with pytest.raises(ValueError, match=message):
        normalize_timestamp('2026-11-09 06:00', 'duty_start', zone)


def test_invalid_zone_is_reported_per_row():
    rows = [[*VALID[:4], '2026-11-09 06:00', '2026-11-09 18:00', '']]
    with pytest.raises(RosterError) as error:
        parse_roster('r.csv', csv_bytes(rows), {'timezone': 'Nowhere/City'})
    assert 'valid source time zone' in error.value.errors[0]['message']


def test_source_timezone_is_recorded():
    rows = parse_roster('r.csv', csv_bytes([[*VALID[:4], '2026-11-09 06:00', '2026-11-09 18:00', '']]), {'timezone': '+09:00'})
    assert rows[0]['source_timezone'] == '+09:00' and rows[0]['duty_start'] == '2026-11-08T21:00:00Z'


def test_empty_file():
    for content in (b'', b'\n\n,,\n'):
        with pytest.raises(RosterError) as error:
            parse_roster('r.csv', content)
        assert error.value.errors == [{'row': 1, 'message': 'The file is empty.'}]


def test_header_only_file_needs_a_duty():
    with pytest.raises(RosterError) as error:
        parse_roster('r.csv', csv_bytes([]))
    assert error.value.errors == [{'row': 2, 'message': 'Add at least one duty row.'}]


def test_too_many_csv_columns():
    with pytest.raises(RosterError) as error:
        parse_roster('r.csv', (','.join(f'c{i}' for i in range(33)) + '\n').encode())
    assert 'Too many columns' in error.value.errors[0]['message']


def test_non_utf8_csv_is_rejected():
    with pytest.raises(RosterError):
        parse_roster('r.csv', b'\xff\xfe\x00bad')


@pytest.mark.parametrize('names,message', [([f'f{i}' for i in range(1001)], 'decompression budget'),
                                           (['[Content_Types].xml', 'xl/vbaProject.bin'], 'Macro-enabled')])
def test_workbook_archive_guards(names, message):
    with pytest.raises(RosterError) as error:
        parse_roster('r.xlsx', zip_bytes(names))
    assert message in error.value.errors[0]['message']


def test_unreadable_workbook_has_generic_message():
    with pytest.raises(RosterError) as error:
        parse_roster('r.xlsx', zip_bytes(['hello.txt']))
    assert error.value.errors[0]['message'] == 'The file is not a readable CSV or XLSX workbook.'


def test_whitespace_only_spreadsheet_rows_are_skipped():
    rows = parse_roster('r.xlsx', xlsx_bytes([COLUMNS, ['  '], VALID]))
    assert len(rows) == 1 and rows[0]['row_number'] == 3


def test_unrecognised_headers_ask_for_mapping():
    header = ['Crew', 'Name', 'Rank', 'Duty', 'Start', 'End']
    with pytest.raises(ImportSetupError) as error:
        parse_roster('r.csv', csv_bytes([VALID[:6]], header=header))
    options = error.value.import_options
    assert options['needs_mapping'] and options['headers'] == header
    assert set(options['mapping'].values()) == {''}


def test_explicit_mapping_reads_custom_headers():
    header = ['Crew', 'Name', 'Rank', 'Duty', 'Start', 'End']
    mapping = dict(zip(COLUMNS, header))
    mapping['certification_expires_at'] = 'Missing column'
    rows = parse_roster('r.csv', csv_bytes([VALID[:6]], header=header), {'mapping': mapping})
    assert rows[0]['crew_id'] == 'C1' and rows[0]['certification_expires_at'] == ''


def test_one_column_cannot_feed_two_fields():
    mapping = {key: key for key in COLUMNS}
    mapping['duty_id'] = 'crew_id'
    with pytest.raises(RosterError) as error:
        parse_roster('r.csv', csv_bytes([VALID]), {'mapping': mapping})
    assert error.value.errors[0]['message'] == 'Use a different source column for each roster field.'


@pytest.mark.parametrize('row,message', [
    ([*VALID, 'extra'], 'Unexpected extra cells without column headers.'),
    (['', *VALID[1:]], 'crew_id is required.'),
    ([VALID[0], 'x' * 161, *VALID[2:]], 'Cell text must not exceed 160 characters.'),
    ([*VALID[:2], 'captain', *VALID[3:]], 'role must be pilot or cabin.'),
    ([*VALID[:4], 'tomorrow', *VALID[5:]], 'duty_start needs a date and time'),
])
def test_row_level_errors(row, message):
    errors = row_errors([row])
    assert errors[0].startswith(message)


def test_short_rows_leave_optional_certification_blank():
    rows = parse_roster('r.csv', csv_bytes([VALID[:6]]))
    assert rows[0]['certification_expires_at'] == ''


def test_role_is_case_insensitive():
    assert parse_roster('r.csv', csv_bytes([[*VALID[:2], 'Cabin', *VALID[3:]]]))[0]['role'] == 'cabin'


def test_row_errors_are_capped_at_fifty():
    rows = [[f'C{i}', 'Name', 'captain', f'D{i}', *VALID[4:]] for i in range(60)]
    assert len(row_errors(rows)) == 50


def test_oversized_upload_is_rejected(monkeypatch):
    monkeypatch.setattr('app.parsing.MAX_BYTES', 10)
    with pytest.raises(RosterError) as error:
        parse_roster('r.csv', b'x' * 11)
    assert 'upload budget' in error.value.errors[0]['message']
