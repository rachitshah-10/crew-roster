"""CSV/XLSX import with explicit sheet, column and timezone choices."""
import csv
import io
import os
import re
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from openpyxl import load_workbook

COLUMNS = ["crew_id", "crew_name", "role", "duty_id", "duty_start", "duty_end", "certification_expires_at"]
MAX_BYTES = int(os.environ.get("CREWCHECK_MAX_UPLOAD_BYTES", 5 * 1024 * 1024))

class RosterError(ValueError):
    def __init__(self, errors):
        self.errors = errors[:50]
        self.import_options = None
        super().__init__("The roster needs corrections before it can be checked.")

class ImportSetupError(RosterError):
    def __init__(self, message, options):
        super().__init__([{"row": 0, "message": message}])
        self.import_options = options
        self.args = (message,)

# During a clock change a local time has two possible instants (repeated hour) or
# none (skipped hour). Resolve automatically to the stricter reading for checks:
# earliest start, latest end, earliest certification expiry.
DST_CHOICE = {"duty_start": "earliest", "duty_end": "latest", "certification_expires_at": "earliest"}


def normalize_timestamp(value, key, zone="", notes=None):
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?", text):
            raise ValueError(f"{key} needs a date and time, such as 2026-11-09 06:00, or an ISO timestamp with an offset.")
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        if not zone:
            raise ImportSetupError("Select the source time zone for dates that do not include an offset.", {"needs_timezone": True})
        if zone in ("UTC", "Z"):
            dt = dt.replace(tzinfo=timezone.utc)
        elif re.fullmatch(r"[+-]\d{2}:\d{2}", zone):
            hours, minutes = int(zone[1:3]), int(zone[4:6])
            if hours > 23 or minutes > 59:
                raise ValueError("Invalid UTC offset.")
            dt = dt.replace(tzinfo=timezone(timedelta(minutes=(hours*60+minutes)*(1 if zone[0]=="+" else -1))))
        else:
            try: tz = ZoneInfo(zone)
            except (ZoneInfoNotFoundError, ValueError):
                raise ValueError("Select a valid source time zone, such as America/New_York, UTC or +09:00.")
            readings = {dt.replace(tzinfo=tz, fold=fold).astimezone(timezone.utc) for fold in (0, 1)}
            if len(readings) == 1:
                dt = readings.pop()
            else:
                choice = DST_CHOICE.get(key, "earliest")
                local = dt
                dt = (min if choice == "earliest" else max)(readings)
                repeated = any(r.astimezone(tz).replace(tzinfo=None) == local for r in readings)
                if notes is not None:
                    notes.append({"field": key, "local": local.isoformat(sep=" ", timespec="minutes"), "zone": zone,
                                  "kind": "repeated" if repeated else "skipped", "choice": choice,
                                  "utc": dt.isoformat(timespec="milliseconds").replace(".000+00:00", "Z").replace("+00:00", "Z")})
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace(".000+00:00", "Z").replace("+00:00", "Z")

def parse_roster(filename, content, options=None):
    options = options or {}
    if len(content) > MAX_BYTES:
        raise RosterError([{"row": 0, "message": "This file exceeds the current server upload budget. Contact the administrator to adjust deployment capacity."}])
    suffix = Path(filename).suffix.lower()
    try:
        matrix, source_rows = [], []
        if suffix == ".csv":
            for n, values in enumerate(csv.reader(io.StringIO(content.decode("utf-8-sig")), strict=True), 1):
                if len(values) > 32:
                    raise ValueError("Too many columns for the current parser capacity.")
                if any(str(v).strip() for v in values): matrix.append(values); source_rows.append(n)
        elif suffix == ".xlsx":
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                if len(archive.infolist()) > 1000 or sum(i.file_size for i in archive.infolist()) > 30 * 1024 * 1024:
                    raise ValueError("Workbook exceeds the server's decompression budget.")
                if any("vbaproject" in i.filename.lower() for i in archive.infolist()):
                    raise ValueError("Macro-enabled workbooks are not supported.")
            wb = load_workbook(io.BytesIO(content), read_only=True, data_only=False, keep_links=False)
            try:
                names = [s.title for s in wb.worksheets]
                selected = options.get("worksheet")
                if (len(names) > 1 and not selected) or (selected and selected not in names):
                    raise ImportSetupError("Choose the worksheet containing the roster.", {"worksheets": names})
                ws = wb[selected] if selected else wb.worksheets[0]
                ws.reset_dimensions()
                for n, cells in enumerate(ws.iter_rows(max_col=33), 1):
                    values = []
                    for cell in cells:
                        if cell.data_type == "f":
                            raise ValueError("Formulas in the selected worksheet need to be replaced with values before checking.")
                        if cell.data_type == "e": raise ValueError("Spreadsheet error cells are not supported.")
                        values.append("" if cell.value is None else cell.value)
                    while values and values[-1] == "": values.pop()
                    if len(values)>32: raise ValueError("Too many columns for the current parser capacity.")
                    if values: matrix.append(values); source_rows.append(n)
            finally:
                wb.close()
        else:
            raise ValueError("Only .csv and .xlsx files are supported. PDF, DOCX and legacy .xls are excluded.")
    except RosterError:
        raise
    except Exception as exc:
        msg = str(exc) if isinstance(exc, (ValueError, UnicodeError, csv.Error)) else "The file is not a readable CSV or XLSX workbook."
        raise RosterError([{"row": 0, "message": msg}]) from exc
    if not matrix: raise RosterError([{"row": 1, "message": "The file is empty."}])
    headers = [str(v).strip() for v in matrix[0]]
    if len(headers) != len(set(headers)):
        raise RosterError([{"row": 1, "message": "Column names must be unique so they can be mapped unambiguously."}])
    normalize = lambda v: re.sub(r"[\s-]+", "_", v.lower().strip())
    mapping = options.get("mapping", {})
    indices = {}
    for key in COLUMNS:
        matches = [i for i,h in enumerate(headers) if normalize(h)==key]
        indices[key] = (headers.index(mapping[key]) if mapping[key] in headers else -1) if key in mapping else (matches[0] if len(matches)==1 else -1)
    if any(indices[k]<0 for k in COLUMNS[:-1]):
        raise ImportSetupError("Match your roster columns to the fields needed for checking.", {"headers":headers,"needs_mapping":True,"mapping":{k:headers[i] if i>=0 else "" for k,i in indices.items()}})
    assigned=[i for i in indices.values() if i>=0]
    if len(assigned)!=len(set(assigned)):
        raise RosterError([{"row":1,"message":"Use a different source column for each roster field."}])
    errors, rows, seen, people = [], [], set(), {}
    zone_needed = False
    for number, values in zip(source_rows[1:], matrix[1:]):
        if not any(str(v).strip() for v in values): continue
        try:
            if len(values) > len(headers): raise ValueError("Unexpected extra cells without column headers.")
            row = {key: values[i] if 0<=i<len(values) else "" for key,i in indices.items()}
            for key in COLUMNS[:-1]:
                if not str(row[key]).strip(): raise ValueError(f"{key} is required.")
            if any(len(str(v))>160 for v in row.values()): raise ValueError("Cell text must not exceed 160 characters.")
            notes = []
            for key in ("duty_start", "duty_end", "certification_expires_at"):
                if row[key] != "": row[key]=normalize_timestamp(row[key], key, options.get("timezone", ""), notes)
            row={k:str(v).strip() for k,v in row.items()}
            row["role"]=row["role"].lower()
            if row["role"] not in ("pilot","cabin"): raise ValueError("role must be pilot or cabin.")
            if datetime.fromisoformat(row["duty_end"].replace("Z", "+00:00"))<=datetime.fromisoformat(row["duty_start"].replace("Z", "+00:00")):
                raise ValueError("duty_end must be after duty_start.")
            key=(row["crew_id"],row["duty_id"]); identity=(row["crew_name"],row["role"])
            if key in seen: raise ValueError("Duplicate crew_id and duty_id in this file.")
            if row["crew_id"] in people and people[row["crew_id"]]!=identity: raise ValueError("Crew name and role must be consistent for a crew_id.")
            seen.add(key); people[row["crew_id"]]=identity; row["row_number"]=number
            if options.get("worksheet"): row["source_sheet"]=options["worksheet"]
            if options.get("timezone"): row["source_timezone"]=options["timezone"]
            if notes: row["dst_adjustments"]=notes
            rows.append(row)
        except ImportSetupError:
            zone_needed=True
        except (ValueError, OverflowError) as exc:
            errors.append({"row":number,"message":str(exc)})
    if zone_needed: raise ImportSetupError("Select the source time zone for dates that do not include an offset.", {"needs_timezone":True})
    if not rows and not errors: errors.append({"row":2,"message":"Add at least one duty row."})
    if errors: raise RosterError(errors)
    return rows
