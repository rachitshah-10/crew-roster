"""Regenerate synthetic input files; never downloads real crew data."""
import csv
from pathlib import Path
from openpyxl import Workbook
from app.parsing import COLUMNS
root = Path(__file__).resolve().parent.parent / "samples"
rows = [
 ["C001", "Alex Sample", "pilot", "D101", "2026-11-09T06:00:00Z", "2026-11-09T20:00:00Z", "2027-01-01T00:00:00Z"],
 ["C002", "Jordan Sample", "pilot", "D102", "2026-11-09T15:00:00Z", "2026-11-09T23:00:00Z", "2027-01-01T00:00:00Z"],
 ["C002", "Jordan Sample", "pilot", "D103", "2026-11-10T06:00:00Z", "2026-11-10T14:00:00Z", "2027-01-01T00:00:00Z"],
 ["C003", "Morgan Sample", "cabin", "D104", "2026-11-09T08:00:00Z", "2026-11-09T16:00:00Z", "2026-11-09T12:00:00Z"],
 ["C004", "Casey Sample", "cabin", "D105", "2026-11-09T07:00:00Z", "2026-11-09T15:00:00Z", "2027-01-01T00:00:00Z"],
 ["C004", "Casey Sample", "cabin", "D106", "2026-11-10T07:00:00Z", "2026-11-10T15:00:00Z", "2027-01-01T00:00:00Z"],
]
root.mkdir(exist_ok=True)
with (root/"sample_roster.csv").open("w", newline="") as f:
    csv.writer(f).writerows([COLUMNS, *rows])
wb = Workbook(); ws = wb.active; ws.title = "Roster"
for row in [COLUMNS, *rows]: ws.append(row)
for col in ws.columns: ws.column_dimensions[col[0].column_letter].width = 28
ws.freeze_panes = "A2"; wb.save(root/"sample_roster.xlsx")
with (root/"invalid_roster.csv").open("w", newline="") as f:
    invalid = list(rows[0]); invalid[4] = "2026-11-09T06:00:00"
    csv.writer(f).writerows([COLUMNS, invalid])
print("Created CSV/XLSX samples: 6 duties, 4 crew, 3 expected findings under initial rules.")
