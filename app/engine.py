"""Pure, deterministic demo checks. Not an implementation of FAA/EASA regulation."""
from collections import defaultdict
from datetime import datetime

DEFAULT_RULES = {
    "name": "Illustrative MVP rules",
    "max_duty_hours": 12.0,
    "min_rest_hours": 10.0,
    "certification_at": "end",
}
ENGINE_VERSION = "1.0.0"


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def check_roster(rows, rules):
    flags, by_crew = [], defaultdict(list)
    def flag(row, code, title, observed, expected, evidence, severity="review"):
        flags.append({"id": f"{row['row_number']}-{code}", "row_number": row["row_number"],
                      "crew_id": row["crew_id"], "duty_id": row["duty_id"], "code": code,
                      "title": title, "observed": observed, "expected": expected,
                      "evidence": evidence, "severity": severity})
    for row in rows:
        start, finish = instant(row["duty_start"]), instant(row["duty_end"])
        hours = (finish - start).total_seconds() / 3600
        by_crew[row["crew_id"]].append(row)
        if hours > rules["max_duty_hours"]:
            flag(row, "DUTY_LIMIT", "Duty exceeds limit", f"{hours:g} h", f"≤ {rules['max_duty_hours']:g} h",
                 {"duty_start": row["duty_start"], "duty_end": row["duty_end"], "difference_hours": round(hours - rules["max_duty_hours"], 4)})
        certification = row["certification_expires_at"]
        point = row["duty_end"] if rules["certification_at"] == "end" else row["duty_start"]
        if not certification:
            flag(row, "CERT_MISSING", "Certification evidence missing", "No expiry supplied", "Expiry timestamp required",
                 {"assessment_time": point}, "incomplete")
        elif instant(certification) < instant(point):
            flag(row, "CERT_EXPIRED", "Certification expires too early", certification, f"Valid through duty {rules['certification_at']}",
                 {"certification_expires_at": certification, "assessment_time": point})
    unassessed = []
    for crew_rows in by_crew.values():
        ordered = sorted(crew_rows, key=lambda r: (instant(r["duty_start"]), instant(r["duty_end"])))
        prior = None
        for row in ordered:
            if prior is None:
                unassessed.append(row["duty_id"])
            else:
                gap = (instant(row["duty_start"]) - instant(prior["duty_end"])).total_seconds() / 3600
                evidence = {"previous_duty_id": prior["duty_id"], "previous_duty_end": prior["duty_end"], "next_duty_start": row["duty_start"]}
                if gap < 0:
                    flag(row, "DUTY_OVERLAP", "Duties overlap", f"{-gap:g} h overlap", "No overlap", evidence)
                elif gap < rules["min_rest_hours"]:
                    flag(row, "REST_MIN", "Insufficient rest", f"{gap:g} h", f"≥ {rules['min_rest_hours']:g} h", evidence)
            # Keep latest end, not just previous start, to handle nested overlapping duties.
            if prior is None or instant(row["duty_end"]) > instant(prior["duty_end"]):
                prior = row
    flagged = {f["row_number"] for f in flags}
    return {"rows": rows, "flags": flags, "summary": {"duties": len(rows), "crew": len(by_crew),
            "flagged_duties": len(flagged), "findings": len(flags), "no_flags": len(rows)-len(flagged)},
            "coverage": {"first_duties_without_prior_rest": unassessed,
                         "note": "Rest before each crew member’s first duty is not assessed. Include preceding duties in this file. Historical uploads are not merged."},
            "engine_version": ENGINE_VERSION}
