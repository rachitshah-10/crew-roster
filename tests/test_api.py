from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from app.main import create_app

SAMPLE=Path(__file__).resolve().parents[1]/'samples/sample_roster.csv'

@pytest.fixture
def app(tmp_path):return create_app(tmp_path/'test.db')

def login(client,role='scheduler'):
    result=client.post('/api/auth/login',json={'email':role+'@crewcheck.local','password':'ManagerDemo!2026' if role=='manager' else 'SchedulerDemo!2026'})
    assert result.status_code==200,result.text
    client.headers['X-CSRF-Token']=result.json()['csrf']
    return result

def upload(client):
    response=client.post('/api/uploads',files={'file':('sample.csv',SAMPLE.read_bytes(),'text/csv')})
    assert response.status_code==201,response.text
    return response.json()

def rule_body(version=1):return dict(expected_version=version,name='Demo rule update',max_duty_hours=16,min_rest_hours=8,certification_at='start',reason='Demonstrate versioned rule snapshots')

def test_anonymous_and_login_logout(app):
    with TestClient(app) as c:
        assert c.get('/api/runs').status_code==401
        assert c.post('/api/auth/login',json={'email':'scheduler@crewcheck.local','password':'wrong'}).status_code==401
        response=login(c)
        cookie=response.headers['set-cookie'].lower();assert 'httponly' in cookie and 'samesite=strict' in cookie
        assert c.get('/api/auth/me').json()['role']=='scheduler'
        assert c.post('/api/auth/logout').status_code==200
        assert c.get('/api/auth/me').status_code==401

def test_scheduler_cannot_configure_rules_and_csrf(app):
    with TestClient(app) as c:
        login(c)
        assert c.post('/api/rules',json=rule_body()).status_code==403
        assert c.get('/api/rules/history').status_code==403
        c.headers.pop('X-CSRF-Token')
        assert c.post('/api/uploads',files={'file':('x.csv',SAMPLE.read_bytes())}).status_code==403
        assert c.post('/api/auth/logout',headers={'Origin':'https://evil.example'}).status_code==403

def test_preview_run_idempotence_history_access_and_snapshot(app):
    with TestClient(app) as scheduler, TestClient(app) as manager:
        login(scheduler);login(manager,'manager')
        preview=upload(scheduler)
        assert preview['row_count']==6 and preview['rules']['version']==1
        # Existing preview keeps its selected version even if a manager edits rules.
        assert manager.post('/api/rules',json=rule_body()).status_code==200
        run=scheduler.post('/api/uploads/'+preview['id']+'/check').json()
        assert run['summary']['findings']==3 and run['rules']['version']==1
        second=scheduler.post('/api/uploads/'+preview['id']+'/check').json()
        assert second['id']==run['id']
        assert scheduler.get('/api/runs').json()['total']==1
        assert manager.get('/api/runs/'+run['id']).status_code==200
        manager_preview=upload(manager)
        manager_run=manager.post('/api/uploads/'+manager_preview['id']+'/check').json()
        assert manager_run['rules']['version']==2
        assert manager_run['summary']['findings']==1 # 7-hour rest remains below 8 hours
        assert scheduler.get('/api/runs/'+manager_run['id']).status_code==404
        assert scheduler.post('/api/uploads/'+manager_preview['id']+'/check').status_code==404
        assert manager.get('/api/runs').json()['total']==2
        assert scheduler.get('/api/runs').json()['total']==1
        assert manager.post('/api/rules',json=rule_body()).status_code==409
        assert manager.get('/api/runs/'+run['id']).json()['rules']['max_duty_hours']==12
        assert manager.post('/api/rules',json=rule_body(2)).status_code==200
        assert manager.get('/api/runs/'+run['id']).json()==run
        historical=next(r for r in manager.get('/api/runs').json()['items'] if r['id']==run['id'])
        assert historical['rules']==run['rules']

def test_bad_uploads_and_no_partial_history(app):
    with TestClient(app) as c:
        login(c)
        result=c.post('/api/uploads',files={'file':('roster.pdf',b'no')})
        assert result.status_code==422 and result.json()['errors']
        bad=(SAMPLE.parent/'invalid_roster.csv').read_bytes()
        result=c.post('/api/uploads',files={'file':('bad.csv',bad)})
        assert result.status_code==422 and result.json()['import_options']['needs_timezone']
        resolved=c.post('/api/uploads',files={'file':('bad.csv',bad)},data={'options':'{"timezone":"UTC"}'})
        assert resolved.status_code==201
        assert resolved.json()['preview'][0]['duty_start']=='2026-11-09T06:00:00Z'
        assert c.get('/api/runs').json()['total']==0
        assert c.post('/api/uploads',content=b'x'*(6*1024*1024+1),headers={'Content-Type':'application/octet-stream'}).status_code==413

def test_threshold_validation_and_filtering(app):
    with TestClient(app) as c:
        login(c,'manager')
        body=rule_body();body['max_duty_hours']=0
        assert c.post('/api/rules',json=body).status_code==422
        body=rule_body();body['reason']='     '
        assert c.post('/api/rules',json=body).status_code==422
        assert c.get('/api/runs?from_date=broken').status_code==422
        assert c.get('/api/runs?offset=-1').status_code==422
        preview=upload(c);c.post('/api/uploads/'+preview['id']+'/check')
        assert c.get('/api/runs?q=sample').json()['total']==1
        assert c.get('/api/runs?q=missing').json()['total']==0

def test_excel_route_and_restart_persistence(tmp_path):
    path=tmp_path/'persistent.db'
    with TestClient(create_app(path)) as c:
        login(c)
        content=(SAMPLE.parent/'sample_roster.xlsx').read_bytes()
        preview=c.post('/api/uploads',files={'file':('sample.xlsx',content)}).json()
        run=c.post('/api/uploads/'+preview['id']+'/check').json()
    with TestClient(create_app(path)) as c:
        login(c,'manager')
        assert c.get('/api/runs/'+run['id']).json()['summary']['findings']==3

def test_login_throttle(app):
    with TestClient(app) as c:
        for _ in range(10):
            assert c.post('/api/auth/login',json={'email':'nobody','password':'wrong'}).status_code==401
        assert c.post('/api/auth/login',json={'email':'nobody','password':'wrong'}).status_code==429
