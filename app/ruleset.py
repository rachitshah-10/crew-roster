"""Rule sets that a manager can build without code.

A rule is a sentence assembled from fixed, tested building blocks:

    [who] [which duties] [measure] [per] must be [compare] [limit]

e.g. "Pilots · duties touching 02:00–05:59 · duty hours · per duty · ≤ 10 h".
Rules are stored as JSON in a rule version and evaluated by app.engine; nothing
the manager types is executed.
"""
import re
from typing import Literal, Union
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MEASURES = {
    "duty_hours": {"label": "Duty hours", "unit": "h", "per": ["duty", "day", "rolling_days"], "min": 0, "max": 1000},
    "duty_count": {"label": "Number of duties", "unit": "duties", "per": ["day", "rolling_days"], "min": 0, "max": 100},
    "rest_hours": {"label": "Rest before the next duty", "unit": "h", "per": ["between_duties"], "min": 0, "max": 240},
    "overlap_hours": {"label": "Overlap with the next duty", "unit": "h", "per": ["between_duties"], "min": 0, "max": 24},
    "consecutive_days": {"label": "Consecutive duty days", "unit": "days", "per": ["streak"], "min": 1, "max": 60},
    "certification_remaining_hours": {"label": "Certification validity left", "unit": "h", "per": ["duty"], "min": 0, "max": 8760},
}
PERIODS = {
    "duty": "for each duty",
    "day": "on any calendar day",
    "rolling_days": "in any rolling window of days",
    "between_duties": "after each duty",
    "streak": "in a row",
}
CONDITIONS = {
    "start_time": {"label": "Duty starts between", "kind": "time_range"},
    "end_time": {"label": "Duty ends between", "kind": "time_range"},
    "overlaps_time": {"label": "Duty touches the daily window", "kind": "time_range"},
    "weekday": {"label": "Duty starts on", "kind": "weekdays"},
    "crew_id": {"label": "Crew ID is one of", "kind": "list"},
}
ROLES = {"all": "All crew", "pilot": "Pilots", "cabin": "Cabin crew"}
COMPARE = {"<=": "at most", "<": "less than", ">=": "at least", ">": "more than"}
TIME = re.compile(r"(?:[01]\d|2[0-3]):[0-5]\d")
CODE = r"^[A-Z][A-Z0-9_]{2,39}$"

DEFAULT_NAME = "Illustrative MVP rules"


def builtin_rules(max_duty_hours=12.0, min_rest_hours=10.0, certification_at="end", zone="UTC"):
    return [
        {"code": "DUTY_LIMIT", "name": "Duty exceeds limit", "enabled": True, "role": "all", "when": [],
         "measure": "duty_hours", "per": "duty", "window_days": None, "compare": "<=", "limit": float(max_duty_hours), "zone": zone, "at": "end"},
        {"code": "CERT_EXPIRED", "name": "Certification expires too early", "enabled": True, "role": "all", "when": [],
         "measure": "certification_remaining_hours", "per": "duty", "window_days": None, "compare": ">=", "limit": 0.0, "zone": zone,
         "at": certification_at},
        {"code": "DUTY_OVERLAP", "name": "Duties overlap", "enabled": True, "role": "all", "when": [],
         "measure": "overlap_hours", "per": "between_duties", "window_days": None, "compare": "<=", "limit": 0.0, "zone": zone, "at": "end"},
        {"code": "REST_MIN", "name": "Insufficient rest", "enabled": True, "role": "all", "when": [],
         "measure": "rest_hours", "per": "between_duties", "window_days": None, "compare": ">=", "limit": float(min_rest_hours), "zone": zone, "at": "end"},
    ]


def preset(code, name, measure, per, compare, limit, window_days=None, when=(), role="all", at="end"):
    return {"code": code, "name": name, "enabled": True, "role": role, "when": list(when), "measure": measure, "per": per,
            "window_days": window_days, "compare": compare, "limit": float(limit), "zone": "UTC", "at": at}


NIGHT = {"field": "overlaps_time", "value": ["02:00", "05:59"]}
PRESETS = [
    *builtin_rules(),
    preset("WEEKLY_HOURS", "Duty hours in any 7 days", "duty_hours", "rolling_days", "<=", 60, window_days=7),
    preset("MONTHLY_HOURS", "Duty hours in any 28 days", "duty_hours", "rolling_days", "<=", 190, window_days=28),
    preset("DAILY_DUTIES", "Duties on one calendar day", "duty_count", "day", "<=", 2),
    preset("CONSECUTIVE_DAYS", "Consecutive duty days", "consecutive_days", "streak", "<=", 6),
    preset("NIGHT_DUTY_LIMIT", "Night duty limit", "duty_hours", "duty", "<=", 10, when=[NIGHT]),
    preset("REST_AFTER_NIGHT", "Rest after a night duty", "rest_hours", "between_duties", ">=", 14, when=[NIGHT]),
    preset("CERT_MARGIN_30D", "Certification valid 30 days beyond duty", "certification_remaining_hours", "duty", ">=", 720),
]


def catalog():
    return {"measures": MEASURES, "periods": PERIODS, "conditions": CONDITIONS, "roles": ROLES, "compare": COMPARE, "presets": PRESETS}


def valid_zone(name):
    if name in ("UTC", "Z"):
        return True
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


class Condition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: Literal["start_time", "end_time", "overlaps_time", "weekday", "crew_id"]
    value: list[Union[int, str]] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def check_value(self):
        kind = CONDITIONS[self.field]["kind"]
        if kind == "time_range":
            if len(self.value) != 2 or not all(isinstance(v, str) and TIME.fullmatch(v) for v in self.value):
                raise ValueError("Use two times in HH:MM format.")
            if self.value[0] == self.value[1]:
                raise ValueError("Start and end times must differ.")
        elif kind == "weekdays":
            if not all(isinstance(v, int) and 0 <= v <= 6 for v in self.value) or len(set(self.value)) != len(self.value):
                raise ValueError("Choose weekdays (Monday=0 to Sunday=6) without repeats.")
        else:
            cleaned = [v.strip() for v in self.value if isinstance(v, str) and v.strip()]
            if len(cleaned) != len(self.value) or any(len(v) > 40 for v in cleaned):
                raise ValueError("List crew IDs of up to 40 characters.")
            self.value = cleaned
        return self


class RuleSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    code: str = Field(pattern=CODE)
    name: str = Field(min_length=3, max_length=80)
    enabled: bool = True
    role: Literal["all", "pilot", "cabin"] = "all"
    when: list[Condition] = Field(default_factory=list, max_length=5)
    measure: Literal["duty_hours", "duty_count", "rest_hours", "overlap_hours", "consecutive_days", "certification_remaining_hours"]
    per: Literal["duty", "day", "rolling_days", "between_duties", "streak"]
    window_days: Union[int, None] = Field(default=None, ge=1, le=90)
    compare: Literal["<=", "<", ">=", ">"]
    limit: float
    zone: str = "UTC"
    at: Literal["start", "end"] = "end"

    @field_validator("name")
    @classmethod
    def strip_name(cls, value):
        if len(value.strip()) < 3:
            raise ValueError("Give the rule a name of at least 3 characters.")
        return value.strip()

    @model_validator(mode="after")
    def check_combination(self):
        measure = MEASURES[self.measure]
        if self.per not in measure["per"]:
            raise ValueError(f"{measure['label']} can be checked {' or '.join(PERIODS[p] for p in measure['per'])}.")
        if self.per == "rolling_days" and self.window_days is None:
            raise ValueError("Choose how many days the rolling window covers.")
        if self.per != "rolling_days":
            self.window_days = None
        if not measure["min"] <= self.limit <= measure["max"]:
            raise ValueError(f"The limit for {measure['label'].lower()} must be between {measure['min']} and {measure['max']} {measure['unit']}.")
        if not valid_zone(self.zone):
            raise ValueError("Choose a valid time zone, such as Asia/Seoul or UTC.")
        return self


def check_unique_codes(rules):
    codes = [r.code for r in rules]
    if len(codes) != len(set(codes)):
        raise ValueError("Each rule needs a different code.")
    return rules


class RuleSetChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int
    name: str = Field(min_length=3, max_length=80)
    reason: str = Field(min_length=5, max_length=400)
    rules: list[RuleSpec] = Field(min_length=1, max_length=30)

    @field_validator("rules")
    @classmethod
    def unique_codes(cls, rules):
        return check_unique_codes(rules)


class RulePreview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str = Field(pattern=r"^[a-f0-9]{24}$")
    rules: list[RuleSpec] = Field(min_length=1, max_length=30)

    @field_validator("rules")
    @classmethod
    def unique_codes(cls, rules):
        return check_unique_codes(rules)


def normalize_ruleset(value):
    """Return {"name", "rules"}; accepts the original three-threshold format so
    historical rule versions and saved checks keep working."""
    if "rules" in value:
        return {"name": value.get("name", DEFAULT_NAME), "rules": value["rules"]}
    return {"name": value.get("name", DEFAULT_NAME),
            "rules": builtin_rules(value["max_duty_hours"], value["min_rest_hours"], value["certification_at"])}
