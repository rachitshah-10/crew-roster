"""Build fictional review scenarios and a parity fixture for the hosted checker."""
import csv,json,copy
from datetime import datetime,timedelta,timezone
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font,PatternFill,Alignment
from app.parsing import COLUMNS,parse_roster
from app.engine import check_roster,DEFAULT_RULES
root=Path(__file__).resolve().parents[1]
out=root/'samples'; out.mkdir(exist_ok=True)
names=['Avery Sample','Blake Sample','Cameron Sample','Drew Sample','Emery Sample','Finley Sample','Harper Sample','Jamie Sample']
base=datetime(2026,11,16,6,tzinfo=timezone.utc)
iso=lambda d:d.isoformat().replace('+00:00','Z')
clean=[]
for day in range(3):
 for i,name in enumerate(names):
  start=base+timedelta(days=day,hours=i%4)
  clean.append([f'DEMO-{i+1:03}',name,'pilot' if i<4 else 'cabin',f'DEMO-D{day+1}{i+1:02}',iso(start),iso(start+timedelta(hours=8)), '2027-05-01T00:00:00Z'])
review=copy.deepcopy(clean)
review[0][5]='2026-11-16T20:00:00Z' # 14 h duty
review[1][5]='2026-11-16T23:00:00Z' # 16 h duty + next-day 8 h rest
review[4][6]='2026-11-16T10:00:00Z' # expires within first duty
review[6][6]='' # missing evidence
review.append(['DEMO-003','Cameron Sample','pilot','DEMO-OVERLAP','2026-11-16T14:00:00Z','2026-11-16T18:00:00Z','2027-05-01T00:00:00Z'])
def write(name,rows):
 with (out/f'{name}.csv').open('w',newline='') as f:csv.writer(f).writerows([COLUMNS,*rows])
 wb=Workbook(); ws=wb.active;ws.title='Roster'
 for row in [COLUMNS,*rows]:ws.append(row)
 for cell in ws[1]:cell.fill=PatternFill('solid',fgColor='142A43');cell.font=Font(color='FFFFFF',bold=True);cell.alignment=Alignment(wrap_text=True)
 for column in ws.columns:ws.column_dimensions[column[0].column_letter].width=30
 ws.auto_filter.ref=ws.dimensions;ws.freeze_panes='A2';wb.save(out/f'{name}.xlsx')
write('clean_roster',clean);write('review_roster',review)
invalid=copy.deepcopy(clean[:2]);invalid[0][4]='2026-11-16T06:00:00';invalid[1][5]=invalid[1][4];write('input_errors',invalid)
fixtures=[]
for name in ['sample_roster','clean_roster','review_roster']:
 rows=parse_roster(name+'.csv',(out/(name+'.csv')).read_bytes())
 result=check_roster(rows,DEFAULT_RULES)
 fixtures.append({'name':name,'rows':rows,'expected':result,'csv':(out/(name+'.csv')).read_bytes().decode('utf-8')})
 print(name,result['summary'])
(root/'hosted/lib').mkdir(exist_ok=True)
(root/'hosted/lib/demo-fixtures.json').write_text(json.dumps(fixtures,indent=2))
(out/'README.md').write_text('''# Fictional demo rosters\n\nAll names, IDs and duties are synthetic. These files contain no airline or employee records. Times are explicit UTC values and certification dates are illustrative.\n\n| File | Scenario | Expected with initial 12 h / 10 h / duty-end policy |\n|---|---|---|\n'''+''.join(f"| `{f['name']}.csv` / `.xlsx` | {'Quick walkthrough' if f['name']=='sample_roster' else 'No configured flags' if f['name']=='clean_roster' else 'Mixed review cases'} | {f['expected']['summary']['duties']} duties, {f['expected']['summary']['crew']} crew, {f['expected']['summary']['findings']} findings |\n" for f in fixtures)+'''| `input_errors.csv` / `.xlsx` | Source time-zone confirmation and invalid duration | Select UTC when prompted; invalid duration prevents checking |\n\nThe first duty for each crew member still lacks preceding-rest context, even in the clean example. No flags does not certify regulatory compliance.\n''')
