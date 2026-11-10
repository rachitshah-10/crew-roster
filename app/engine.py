"""Pure, deterministic demo checks. Not an implementation of FAA/EASA regulation.

Every rule, built-in or manager-defined, is evaluated by the same interpreter
from its JSON description (see app.ruleset). Each building block below is
covered by tests, so any combination a manager assembles runs tested code.
"""
from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from .ruleset import MEASURES, normalize_ruleset

DEFAULT_RULES = {
    "name": "Illustrative MVP rules",
    "max_duty_hours": 12.0,
    "min_rest_hours": 10.0,
    "certification_at": "end",
}
ENGINE_VERSION = "2.0.0"
OPS = {"<=": lambda v, l: v <= l, "<": lambda v, l: v < l, ">=": lambda v, l: v >= l, ">": lambda v, l: v > l}


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(value):
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace(".000+00:00", "Z").replace("+00:00", "Z")


def zone_of(name):
    return timezone.utc if name in ("UTC", "Z") else ZoneInfo(name)


class Duty:
    __slots__ = ("row", "start", "end")

    def __init__(self, row):
        self.row, self.start, self.end = row, instant(row["duty_start"]), instant(row["duty_end"])

    @property
    def hours(self):
        return (self.end - self.start).total_seconds() / 3600

    def clipped_hours(self, begin, end):
        return max(0.0, (min(self.end, end) - max(self.start, begin)).total_seconds() / 3600)

    def local_days(self, zone):
        day, last = self.start.astimezone(zone).date(), (self.end - timedelta(microseconds=1)).astimezone(zone).date()
        while day <= last:
            yield day
            day += timedelta(days=1)


def local_bounds(day, zone):
    return (datetime.combine(day, time(), zone).astimezone(timezone.utc),
            datetime.combine(day + timedelta(days=1), time(), zone).astimezone(timezone.utc))


def clock(value):
    return time.fromisoformat(value)


def in_range(moment, start, end):
    # Ranges may wrap past midnight, e.g. 22:00–05:00.
    return start <= moment < end if start < end else moment >= start or moment < end


def touches_window(duty, start, end, zone):
    first = duty.start.astimezone(zone).date() - timedelta(days=1)
    last = duty.end.astimezone(zone).date()
    day = first
    while day <= last:
        begin = datetime.combine(day, start, zone)
        finish = datetime.combine(day + timedelta(days=1) if end <= start else day, end, zone)
        if duty.start < finish and begin < duty.end:
            return True
        day += timedelta(days=1)
    return False


def matches(duty, condition, zone):
    field, value = condition["field"], condition["value"]
    if field == "crew_id":
        return duty.row["crew_id"] in value
    if field == "weekday":
        return duty.start.astimezone(zone).weekday() in value
    start, end = clock(value[0]), clock(value[1])
    if field == "overlaps_time":
        return touches_window(duty, start, end, zone)
    moment = (duty.start if field == "start_time" else duty.end).astimezone(zone).time()
    return in_range(moment, start, end)


def amount(value, measure):
    return f"{round(value, 4):g} {MEASURES[measure]['unit']}"


def expected_text(rule):
    symbol = {"<=": "≤", "<": "<", ">=": "≥", ">": ">"}[rule["compare"]]
    return f"{symbol} {amount(rule['limit'], rule['measure'])}"


class Finding:
    def __init__(self, duty, rule, observed, expected, evidence, severity="review", code=None, title=None):
        self.duty, self.rule = duty, rule
        self.code, self.title = code or rule["code"], title or rule["name"]
        self.observed, self.expected, self.evidence, self.severity = observed, expected, evidence, severity

    def as_flag(self):
        row = self.duty.row
        return {"id": f"{row['row_number']}-{self.code}", "row_number": row["row_number"], "crew_id": row["crew_id"],
                "duty_id": row["duty_id"], "code": self.code, "title": self.title, "observed": self.observed,
                "expected": self.expected, "evidence": self.evidence, "severity": self.severity}


def per_duty(rule, duties, matching, zone):
    ok = OPS[rule["compare"]]
    for duty in matching:
        if rule["measure"] == "duty_hours":
            if not ok(duty.hours, rule["limit"]):
                yield Finding(duty, rule, f"{duty.hours:g} h", expected_text(rule),
                              {"duty_start": duty.row["duty_start"], "duty_end": duty.row["duty_end"],
                               "difference_hours": round(duty.hours - rule["limit"], 4)})
            continue
        point = duty.row["duty_end"] if rule["at"] == "end" else duty.row["duty_start"]
        expiry = duty.row["certification_expires_at"]
        if not expiry:
            yield Finding(duty, rule, "No expiry supplied", "Expiry timestamp required", {"assessment_time": point},
                          "incomplete", code="CERT_MISSING", title="Certification evidence missing")
            continue
        left = (instant(expiry) - instant(point)).total_seconds() / 3600
        if not ok(left, rule["limit"]):
            expected = f"Valid through duty {rule['at']}" if rule["limit"] == 0 else f"Valid {expected_text(rule)} after duty {rule['at']}"
            evidence = {"certification_expires_at": expiry, "assessment_time": point}
            if rule["limit"]:
                evidence["remaining_hours"] = round(left, 4)
            yield Finding(duty, rule, expiry, expected, evidence)


def between_duties(rule, duties, matching, zone):
    ok, chosen = OPS[rule["compare"]], {id(d) for d in matching}
    prior = None
    for duty in duties:
        if prior is not None and id(prior) in chosen:
            gap = (duty.start - prior.end).total_seconds() / 3600
            evidence = {"previous_duty_id": prior.row["duty_id"], "previous_duty_end": prior.row["duty_end"],
                        "next_duty_start": duty.row["duty_start"]}
            if rule["measure"] == "overlap_hours" and gap < 0 and not ok(-gap, rule["limit"]):
                expected = "No overlap" if rule["limit"] == 0 else expected_text(rule)
                yield Finding(duty, rule, f"{-gap:g} h overlap", expected, evidence)
            elif rule["measure"] == "rest_hours" and gap >= 0 and not ok(gap, rule["limit"]):
                yield Finding(duty, rule, f"{gap:g} h", expected_text(rule), evidence)
        # Keep the latest end, not just the previous start, to handle nested overlapping duties.
        if prior is None or duty.end > prior.end:
            prior = duty


def per_day(rule, duties, matching, zone):
    ok, days = OPS[rule["compare"]], defaultdict(list)
    for duty in matching:
        for day in duty.local_days(zone):
            days[day].append(duty)
    for day in sorted(days):
        begin, end = local_bounds(day, zone)
        group = days[day]
        value = sum(d.clipped_hours(begin, end) for d in group) if rule["measure"] == "duty_hours" else len(group)
        if not ok(value, rule["limit"]):
            anchor = max(group, key=lambda d: (d.start, d.end))
            yield Finding(anchor, rule, amount(value, rule["measure"]), expected_text(rule),
                          {"day": day.isoformat(), "zone": rule["zone"], "duties": [d.row["duty_id"] for d in group]})


def rolling(rule, duties, matching, zone):
    ok, span = OPS[rule["compare"]], timedelta(days=rule["window_days"])
    for anchor in matching:
        end, begin = anchor.end, anchor.end - span
        group = [d for d in matching if d.end > begin and d.start < end]
        value = sum(d.clipped_hours(begin, end) for d in group) if rule["measure"] == "duty_hours" else len(group)
        if not ok(value, rule["limit"]):
            yield Finding(anchor, rule, amount(value, rule["measure"]), f"{expected_text(rule)} in any {rule['window_days']} days",
                          {"window_start": iso(begin), "window_end": iso(end), "duties": [d.row["duty_id"] for d in group]})


def streak(rule, duties, matching, zone):
    ok, days = OPS[rule["compare"]], defaultdict(list)
    for duty in matching:
        for day in duty.local_days(zone):
            days[day].append(duty)
    first = previous = None
    for day in sorted(days):
        first = first if previous is not None and day - previous == timedelta(days=1) else day
        previous = day
        length = (day - first).days + 1
        if not ok(length, rule["limit"]):
            anchor = max(days[day], key=lambda d: (d.start, d.end))
            yield Finding(anchor, rule, amount(length, rule["measure"]), expected_text(rule),
                          {"first_day": first.isoformat(), "last_day": day.isoformat(), "zone": rule["zone"]})


PERIOD_CHECKS = {"duty": per_duty, "between_duties": between_duties, "day": per_day, "rolling_days": rolling, "streak": streak}


def evaluate(rule, crews):
    zone = zone_of(rule.get("zone", "UTC"))
    for duties in crews.values():
        role = duties[0].row["role"]
        if rule.get("role", "all") not in ("all", role):
            continue
        matching = [d for d in duties if all(matches(d, c, zone) for c in rule.get("when", []))]
        yield from PERIOD_CHECKS[rule["per"]](rule, duties, matching, zone)


def check_roster(rows, rules):
    ruleset = normalize_ruleset(rules)
    crews = defaultdict(list)
    for row in rows:
        crews[row["crew_id"]].append(Duty(row))
    for duties in crews.values():
        duties.sort(key=lambda d: (d.start, d.end))
    findings = {}
    for rule in ruleset["rules"]:
        if not rule.get("enabled", True):
            continue
        for finding in evaluate(rule, crews):
            # One finding per duty per rule code; a duty can anchor several windows.
            findings.setdefault((finding.duty.row["row_number"], finding.code), finding)
    order = {row["row_number"]: i for i, row in enumerate(rows)}
    flags = [f.as_flag() for f in sorted(findings.values(), key=lambda f: order[f.duty.row["row_number"]])]
    unassessed = [duties[0].row["duty_id"] for duties in crews.values()]
    flagged = {f["row_number"] for f in flags}
    return {"rows": rows, "flags": flags, "summary": {"duties": len(rows), "crew": len(crews),
            "flagged_duties": len(flagged), "findings": len(flags), "no_flags": len(rows)-len(flagged)},
            "coverage": {"first_duties_without_prior_rest": unassessed,
                         "note": "Rest before each crew member’s first duty is not assessed. Include preceding duties in this file. Historical uploads are not merged."},
            "engine_version": ENGINE_VERSION}
