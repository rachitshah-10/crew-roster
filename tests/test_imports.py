"""Every upload attempt is logged, including rejected files, and original bytes are kept."""
import hashlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

SAMPLES = Path(__file__).resolve().parents[1] / 'samples'


@pytest.fixture
def app(tmp_path):
    return create_app(tmp_path / 'test.db')


def login(client, role='scheduler'):
    password = 'ManagerDemo!2026' if role == 'manager' else 'SchedulerDemo!2026'
    response = client.post('/api/auth/login', json={'email': role + '@crewcheck.local', 'password': password})
    client.headers['X-CSRF-Token'] = response.json()['csrf']


def upload(client, name, content, options=None):
    return client.post('/api/uploads', files={'file': (name, content)}, data={'options': options} if options else None)


def test_accepted_upload_is_logged_with_original_file(app, tmp_path):
    content = (SAMPLES / 'sample_roster.csv').read_bytes()
    with TestClient(app) as c:
        login(c)
        preview = upload(c, 'sample.csv', content).json()
        log = c.get('/api/imports').json()
        assert log['total'] == 1
        item = log['items'][0]
        assert item['id'] == preview['import_id'] and item['status'] == 'accepted'
        assert item['upload_id'] == preview['id'] and item['row_count'] == 6 and item['run_id'] is None
        assert item['file_hash'] == hashlib.sha256(content).hexdigest() and item['size'] == len(content) and item['stored']
        assert item['owner'] == 'Alex Morgan' and item['options'] == {} and item['errors'] == []
        stored = tmp_path / 'files' / item['file_hash'][:2] / item['file_hash']
        assert stored.read_bytes() == content
        run = c.post(f"/api/uploads/{preview['id']}/check").json()
        assert run['import_id'] == item['id']
        assert c.get(f"/api/imports/{item['id']}").json()['run_id'] == run['id']
        download = c.get(f"/api/imports/{item['id']}/file")
        assert download.status_code == 200 and download.content == content
        assert download.headers['content-type'] == 'application/octet-stream'
        assert 'attachment' in download.headers['content-disposition'] and 'sample.csv' in download.headers['content-disposition']


def test_rejected_upload_is_logged_with_errors_and_file(app):
    bad = (SAMPLES / 'edge-cases/04_duplicate_records.csv').read_bytes()
    with TestClient(app) as c:
        login(c)
        response = upload(c, 'dupes.csv', bad)
        assert response.status_code == 422
        import_id = response.json()['import_id']
        item = c.get(f'/api/imports/{import_id}').json()
        assert item['status'] == 'rejected' and item['upload_id'] is None and item['row_count'] is None
        assert item['errors'] == [{'row': 4, 'message': 'Duplicate crew_id and duty_id in this file.'}]
        assert c.get(f'/api/imports/{import_id}/file').content == bad
        assert c.get('/api/runs').json()['total'] == 0  # nothing reaches check history


def test_setup_needed_then_resolved_attempts_are_both_logged(app):
    content = (SAMPLES / 'invalid_roster.csv').read_bytes()
    with TestClient(app) as c:
        login(c)
        first = upload(c, 'local.csv', content)
        second = upload(c, 'local.csv', content, '{"timezone":"UTC"}')
        assert first.status_code == 422 and second.status_code == 201
        items = c.get('/api/imports').json()['items']
        assert [i['status'] for i in items] == ['accepted', 'needs_setup']
        assert items[1]['import_options'] == {'needs_timezone': True}
        assert items[0]['options'] == {'timezone': 'UTC'}
        assert items[0]['file_hash'] == items[1]['file_hash']  # stored once, shared
        assert [i['status'] for i in c.get('/api/imports?status=needs_setup').json()['items']] == ['needs_setup']


def test_invalid_settings_and_unsupported_files_are_logged(app):
    with TestClient(app) as c:
        login(c)
        bad_options = upload(c, 'r.csv', b'crew_id\n', 'not json')
        assert bad_options.status_code == 422
        item = c.get(f"/api/imports/{bad_options.json()['import_id']}").json()
        assert item['status'] == 'rejected' and item['options'] == 'not json'
        assert item['errors'] == [{'row': 0, 'message': 'Invalid import settings.'}]
        pdf = upload(c, 'roster.pdf', b'%PDF-1.7')
        assert c.get(f"/api/imports/{pdf.json()['import_id']}/file").content == b'%PDF-1.7'
        assert c.get('/api/imports?status=rejected').json()['total'] == 2


def test_oversized_upload_is_logged_without_storing_bytes(tmp_path, monkeypatch):
    monkeypatch.setattr('app.main.MAX_BYTES', 10)
    monkeypatch.setattr('app.parsing.MAX_BYTES', 10)
    app = create_app(tmp_path / 'test.db')
    with TestClient(app) as c:
        login(c)
        response = upload(c, 'big.csv', b'x' * 50)
        assert response.status_code == 422
        item = c.get(f"/api/imports/{response.json()['import_id']}").json()
        assert item['status'] == 'rejected' and not item['stored'] and item['file_hash'] is None and item['size'] == 11
        assert c.get(f"/api/imports/{item['id']}/file").status_code == 404
    assert not (tmp_path / 'files').exists()


def test_missing_file_on_disk_returns_404(app, tmp_path):
    with TestClient(app) as c:
        login(c)
        import_id = upload(c, 's.csv', (SAMPLES / 'sample_roster.csv').read_bytes()).json()['import_id']
        for path in (tmp_path / 'files').rglob('*'):
            if path.is_file(): path.unlink()
        assert c.get(f'/api/imports/{import_id}/file').status_code == 404


def test_scheduler_sees_own_attempts_manager_sees_all(app):
    with TestClient(app) as scheduler, TestClient(app) as manager:
        login(scheduler); login(manager, 'manager')
        mine = upload(manager, 'manager.pdf', b'nope').json()['import_id']
        upload(scheduler, 'scheduler.pdf', b'nope')
        assert [i['filename'] for i in scheduler.get('/api/imports').json()['items']] == ['scheduler.pdf']
        assert manager.get('/api/imports').json()['total'] == 2
        assert scheduler.get(f'/api/imports/{mine}').status_code == 404
        assert scheduler.get(f'/api/imports/{mine}/file').status_code == 404
        assert manager.get('/api/imports/' + '0' * 24).status_code == 404


def test_import_log_paging_and_validation(app):
    with TestClient(app) as c:
        assert c.get('/api/imports').status_code == 401
        login(c)
        for n in range(27):
            upload(c, f'{n}.pdf', b'x')
        first, second = c.get('/api/imports').json(), c.get('/api/imports?offset=25').json()
        assert (first['total'], len(first['items']), len(second['items'])) == (27, 25, 2)
        assert first['items'][0]['filename'] == '26.pdf' and second['items'][-1]['filename'] == '0.pdf'
        assert c.get('/api/imports?offset=-1').status_code == 422
        assert c.get('/api/imports?status=deleted').status_code == 422


def test_files_directory_can_be_configured(tmp_path, monkeypatch):
    monkeypatch.setenv('CREWCHECK_FILES', str(tmp_path / 'vault'))
    with TestClient(create_app(tmp_path / 'test.db')) as c:
        login(c)
        upload(c, 'x.pdf', b'abc')
    assert (tmp_path / 'vault' / hashlib.sha256(b'abc').hexdigest()[:2]).is_dir()
