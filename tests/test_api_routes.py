import asyncio
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import BodyLimit, create_app
from app.ruleset import builtin_rules

SAMPLES = Path(__file__).resolve().parents[1] / 'samples'


@pytest.fixture
def app(tmp_path):
    return create_app(tmp_path / 'test.db')


def login(client, role='scheduler'):
    password = 'ManagerDemo!2026' if role == 'manager' else 'SchedulerDemo!2026'
    response = client.post('/api/auth/login', json={'email': role + '@crewcheck.local', 'password': password})
    assert response.status_code == 200, response.text
    client.headers['X-CSRF-Token'] = response.json()['csrf']


def checked_run(client):
    upload = client.post('/api/uploads', files={'file': ('sample.csv', (SAMPLES / 'sample_roster.csv').read_bytes(), 'text/csv')})
    assert upload.status_code == 201, upload.text
    return client.post(f"/api/uploads/{upload.json()['id']}/check").json()


def test_public_pages_and_security_headers(app):
    with TestClient(app) as c:
        assert c.get('/api/health').json() == {'status': 'ok', 'mode': 'local-demo'}
        page = c.get('/')
        assert page.status_code == 200 and '<div id="app">' in page.text
        assert "frame-ancestors 'none'" in page.headers['content-security-policy']
        assert 'cache-control' not in page.headers  # only API responses are no-store
        assert c.get('/api/health').headers['cache-control'] == 'no-store'
        redirect = c.get('/documentation', follow_redirects=False)
        assert redirect.status_code == 307 and redirect.headers['location'] == '/project-docs/index.html'


def test_untrusted_host_is_rejected(app):
    with TestClient(app, base_url='http://evil.example') as c:
        assert c.get('/api/health').status_code == 400


def test_active_rules_and_history(app):
    with TestClient(app) as scheduler, TestClient(app) as manager:
        login(scheduler); login(manager, 'manager')
        active = scheduler.get('/api/rules').json()
        assert active['version'] == 1 and [r['code'] for r in active['rules']] == ['DUTY_LIMIT', 'CERT_EXPIRED', 'DUTY_OVERLAP', 'REST_MIN']
        assert active['rules'][0]['limit'] == 12
        saved = manager.post('/api/rules', json={'expected_version': 1, 'name': '  Night ops  ', 'rules': builtin_rules(10, 11, 'start'),
                                                 'reason': 'Tighter limits for night operations'})
        assert saved.status_code == 200 and saved.json()['name'] == 'Night ops'
        history = manager.get('/api/rules/history').json()
        assert [v['version'] for v in history] == [2, 1]
        assert history[0]['created_by'] == saved.json()['created_by']
        assert scheduler.get('/api/rules').json()['version'] == 2


@pytest.mark.parametrize('options', ['not json', '[1]', '{"mapping": []}', '{"timezone": 5}', '{"worksheet": ["a"]}'])
def test_invalid_import_settings(app, options):
    with TestClient(app) as c:
        login(c)
        response = c.post('/api/uploads', files={'file': ('s.csv', b'x')}, data={'options': options})
        assert response.status_code == 422 and response.json()['detail'] == 'Invalid import settings.'


def test_upload_filename_is_reduced_to_basename(app):
    with TestClient(app) as c:
        login(c)
        response = c.post('/api/uploads', files={'file': ('..\\..\\secret/roster.csv', (SAMPLES / 'sample_roster.csv').read_bytes())})
        assert response.status_code == 201 and response.json()['filename'] == 'roster.csv'


def test_history_filters_and_pagination_limits(app):
    with TestClient(app) as c:
        login(c, 'manager')
        run = checked_run(c)
        today = datetime.now(timezone.utc).date().isoformat()
        assert c.get(f'/api/runs?from_date={today}&to_date={today}').json()['total'] == 1
        assert c.get('/api/runs?from_date=2000-01-01&to_date=2000-01-02').json()['total'] == 0
        assert c.get('/api/runs?to_date=nope').status_code == 422
        assert c.get('/api/runs?q=' + 'x' * 161).status_code == 422
        page = c.get('/api/runs?offset=25').json()
        assert page['items'] == [] and page['total'] == 1 and page['limit'] == 25
        item = c.get('/api/runs').json()['items'][0]
        assert set(item) == {'id', 'created_at', 'filename', 'owner', 'summary', 'rules'} and item['id'] == run['id']


def test_unknown_run_and_upload_return_404(app):
    with TestClient(app) as c:
        login(c)
        assert c.get('/api/runs/' + '0' * 24).status_code == 404
        assert c.post('/api/uploads/' + '0' * 24 + '/check').status_code == 404


@pytest.mark.parametrize('kind,marker', [('csv', b'crew_id'), ('xlsx', b'PK')])
def test_template_downloads(app, kind, marker):
    with TestClient(app) as c:
        assert c.get(f'/api/templates/{kind}').status_code == 401
        login(c)
        response = c.get(f'/api/templates/{kind}')
        assert response.status_code == 200 and response.content.startswith(marker)
        assert f'sample_roster.{kind}' in response.headers['content-disposition']
        assert c.get('/api/templates/pdf').status_code == 422


def test_json_body_limit(app):
    with TestClient(app) as c:
        response = c.post('/api/auth/login', content=b'{' + b' ' * (64 * 1024) + b'}', headers={'Content-Type': 'application/json'})
        assert response.status_code == 413


def run_body_limit(messages, method='POST'):
    """Drive the ASGI middleware directly to cover chunked bodies and disconnects."""
    queue, received, sent = list(messages), [], []

    async def inner(scope, receive, send):
        received.append(await receive())
        received.append(await receive())

    async def receive():
        return queue.pop(0) if queue else {'type': 'http.disconnect'}

    async def send(message):
        sent.append(message)

    asyncio.run(BodyLimit(inner)({'type': 'http', 'method': method, 'path': '/api/rules'}, receive, send))
    return received, sent


def test_body_limit_joins_chunks_then_passes_through_receive():
    received, sent = run_body_limit([{'type': 'http.request', 'body': b'ab', 'more_body': True},
                                     {'type': 'http.request', 'body': b'cd', 'more_body': False}])
    assert received[0] == {'type': 'http.request', 'body': b'abcd', 'more_body': False}
    assert received[1] == {'type': 'http.disconnect'} and sent == []


def test_body_limit_stops_on_client_disconnect():
    assert run_body_limit([{'type': 'http.disconnect'}]) == ([], [])


def test_body_limit_ignores_reads():
    received, _ = run_body_limit([{'type': 'http.request', 'body': b'x', 'more_body': False}], method='GET')
    assert received[0]['body'] == b'x'


def test_allowed_hosts_are_configurable(tmp_path, monkeypatch):
    monkeypatch.setenv('CREWCHECK_ALLOWED_HOSTS', 'crewcheck.example, localhost')
    app = create_app(tmp_path / 'hosts.db')
    with TestClient(app, base_url='http://crewcheck.example') as c:
        assert c.get('/api/health').status_code == 200
    with TestClient(app) as c:  # default test host is no longer listed
        assert c.get('/api/health').status_code == 400
