"""Per-crew timeline of a saved check.

Derived only from the stored rows and flags, so the view always matches the
saved result and never re-applies rules.
"""
from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .engine import instant



def iso(value):
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def display_zone(name):
    if name in ("UTC", "Z"):
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("Unknown time zone. Use an IANA name such as Asia/Seoul or UTC.")


def local_midnight(day, zone):
    # Midnight can fall in a DST gap in a few zones; normalising through UTC moves it forward.
    return datetime.combine(day, time(), zone).astimezone(timezone.utc)


def duty_status(flags):
    if not flags:
        return "ok"
    return "review" if any(f["severity"] != "incomplete" for f in flags) else "incomplete"


def build_timeline(result, zone_name="UTC"):
    """Group a saved result by crew member. Day boundaries follow `zone_name`, so a
    daylight-saving change produces a 23 or 25 hour day."""
    zone = display_zone(zone_name)
    rows, flags = result["rows"], result["flags"]
    if not rows:
        return {"zone": zone_name, "start": None, "end": None, "days": [], "crew": []}
    by_row = defaultdict(list)
    for item in flags:
        by_row[item["row_number"]].append(item)

    lanes, day_findings = {}, defaultdict(int)
    first = last = None
    for row in rows:
        start, end = instant(row["duty_start"]), instant(row["duty_end"])
        first = start if first is None else min(first, start)
        last = end if last is None else max(last, end)
        row_flags = by_row[row["row_number"]]
        lane = lanes.setdefault(row["crew_id"], {"crew_id": row["crew_id"], "crew_name": row["crew_name"],
                                                 "role": row["role"], "findings": 0, "duties": [], "gaps": []})
        lane["findings"] += len(row_flags)
        day_findings[start.astimezone(zone).date()] += len(row_flags)
        lane["duties"].append({"row_number": row["row_number"], "duty_id": row["duty_id"],
                               "start": iso(start), "end": iso(end),
                               "hours": round((end - start).total_seconds() / 3600, 2),
                               "codes": [f["code"] for f in row_flags], "status": duty_status(row_flags)})
        for item in row_flags:
            # Any finding about the interval between two duties (built-in or custom rule) is drawn.
            if "previous_duty_end" not in item["evidence"]:
                continue
            previous_end, next_start = instant(item["evidence"]["previous_duty_end"]), instant(item["evidence"]["next_duty_start"])
            lane["gaps"].append({"kind": "overlap" if next_start < previous_end else "short_rest", "code": item["code"],
                                 "title": item["title"], "row_number": row["row_number"],
                                 "previous_duty_id": item["evidence"]["previous_duty_id"], "duty_id": row["duty_id"],
                                 "start": iso(min(previous_end, next_start)), "end": iso(max(previous_end, next_start)),
                                 "observed": item["observed"]})

    days, day = [], first.astimezone(zone).date()
    while True:
        begin, end = local_midnight(day, zone), local_midnight(day + timedelta(days=1), zone)
        days.append({"date": day.isoformat(), "start": iso(begin), "end": iso(end),
                     "hours": round((end - begin).total_seconds() / 3600, 2), "findings": day_findings.get(day, 0)})
        if end >= last:
            break
        day += timedelta(days=1)

    for lane in lanes.values():
        lane["duties"].sort(key=lambda d: (d["start"], d["end"]))
        lane["gaps"].sort(key=lambda g: (g["start"], g["end"]))
    crew = sorted(lanes.values(), key=lambda lane: (-lane["findings"], lane["crew_id"]))
    return {"zone": zone_name, "start": days[0]["start"], "end": days[-1]["end"], "days": days, "crew": crew}
