"""Render the architecture SVG. User flow is generated separately from Mermaid."""
from pathlib import Path
from html import escape
OUT = Path(__file__).resolve().parents[1] / 'docs/diagrams'
NAVY='#142a43'; BLUE='#315ee8'; MUTED='#63738a'

def start(w,h,title,desc):
    return [f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc"><title id="title">{title}</title><desc id="desc">{desc}</desc><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="none" stroke="#72849b" stroke-width="1.5"/></marker></defs><rect width="100%" height="100%" rx="20" fill="#f6f8fc"/><g font-family="Inter,Arial,sans-serif">''']
def txt(s,x,y,t,size=18,color=NAVY,weight=400):
    s.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{color}">{escape(t)}</text>')
def box(s,x,y,w,h,label,lines=(),accent=False):
    s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{NAVY if accent else "white"}" stroke="{NAVY if accent else "#d8e0ec"}"/>')
    txt(s,x+22,y+34,label,20,'white' if accent else NAVY,650)
    for i,line in enumerate(lines):txt(s,x+22,y+63+i*24,line,16,'#ccd8ec' if accent else MUTED)
def line(s,points,label=None,lx=0,ly=0):
    s.append(f'<path d="{points}" fill="none" stroke="#72849b" stroke-width="2" marker-end="url(#arrow)"/>')
    if label:txt(s,lx,ly,label,14,MUTED)
def save(s,name):
    (OUT/name).write_text(''.join(s)+ '</g></svg>')

s=start(1500,790,'CrewCheck system architecture','A browser calls one FastAPI application with authentication, file validation, deterministic rules and SQLite persistence.')
txt(s,44,52,'SYSTEM ARCHITECTURE',15,BLUE,700)
txt(s,44,94,'One application. Explicit rules. Saved evidence.',32,NAVY,650)
s.append('<rect x="390" y="150" width="640" height="500" rx="18" fill="#edf2ff" stroke="#cdd8fb"/>')
txt(s,416,184,'APPLICATION SERVER · DEPLOYMENT ADAPTER',15,BLUE,700)
box(s,44,265,280,180,'Browser application',('Scheduler / Manager','Upload • review • history','Role-aware controls'),True)
box(s,418,211,584,102,'Access & API',('Password session · CSRF · ownership · manager permissions',))
box(s,418,352,274,135,'File validation',('CSV / Excel (.xlsx)','Schema + UTC timestamps','Preview captures rule version'))
box(s,728,352,274,135,'Rule engine',('Duty · rest · overlap','Certification expiry','Deterministic findings'))
box(s,418,529,584,91,'Snapshot & history',('Source rows + findings + rule version + file hash',))
box(s,1110,263,346,224,'SQLite persistence',('Local SQLite / hosted D1','Upload and check snapshots','Versioned rule settings','Append-only audit events'),True)
line(s,'M324 295 H368 V260 H418','Same-origin HTTP',206,234)
line(s,'M551 313 V352','Upload',566,337)
line(s,'M866 313 V352','Run check',881,337)
line(s,'M692 418 H728')
line(s,'M866 487 V529','Findings',881,512)
line(s,'M1002 262 H1062 V323 H1110','Read / write',1046,236)
line(s,'M1002 573 H1062 V432 H1110')
txt(s,44,704,'CHECK LIFECYCLE',14,BLUE,700)
txt(s,44,739,'Validate file → save preview + rule version → run checks → save immutable result → human review',21,NAVY,500)
txt(s,1110,543,'Demo deployment boundary',17,NAVY,650)
txt(s,1110,574,'No LLM or external data feeds.',16,MUTED)
txt(s,1110,601,'Original file bytes are discarded;',16,MUTED)
txt(s,1110,627,'normalized rows are retained.',16,MUTED)
txt(s,44,776,'PLANNED INTERNAL ROLLOUT: PostgreSQL + employee authentication + governed audit retention',15,BLUE,650)
save(s,'system-architecture.svg')

print('Wrote system-architecture.svg; use npm run diagrams:user-flow for the Mermaid flow.')
