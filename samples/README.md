# Fictional demo rosters

For the stakeholder demo, the additional [exception sample pack](edge-cases/README.md) contains six scenarios in CSV and Excel, with verified expected results. Follow the [meeting runbook](../docs/meeting-demo-runbook.html).

All names, IDs and duties are synthetic. These files contain no airline or employee records. Times are explicit UTC values and certification dates are illustrative.

| File | Scenario | Expected with initial 12 h / 10 h / duty-end policy |
|---|---|---|
| `sample_roster.csv` / `.xlsx` | Quick walkthrough | 6 duties, 4 crew, 3 findings |
| `clean_roster.csv` / `.xlsx` | No configured flags | 24 duties, 8 crew, 0 findings |
| `review_roster.csv` / `.xlsx` | Mixed review cases | 25 duties, 8 crew, 6 findings |
| `input_errors.csv` / `.xlsx` | Source time-zone confirmation and invalid duration | Select UTC when prompted; invalid duration prevents checking |

The first duty for each crew member still lacks preceding-rest context, even in the clean example. No flags does not certify regulatory compliance.
