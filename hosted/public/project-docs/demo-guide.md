# Review guide

1. Open Architecture & user flow before showing the app. Explain the current SQLite-based storage and planned PostgreSQL internal deployment.
2. Choose **Explore as Scheduler**. The demo opens directly on **Load a roster**. In the starter card, download `sample_roster.csv` or `sample_roster.xlsx` to your computer.
3. Choose **Browse files** and select that downloaded file (or drag it into the upload area). This demonstrates the actual file upload. Confirm six duties, four crew and the captured rule version in the preview, then choose **Run roster check**. With the initial 12 h duty / 10 h rest / duty-end policy there are three findings. The secondary **Or load sample directly** button is a shortcut if file selection is not part of your walkthrough.
4. Open D103's details: observed rest is 7 h, below the 10 h minimum. The drawer shows timestamps, original rule version and source file hash.
5. Select **Switch role**, then **Explore as Manager**. See scheduler and manager history in the same sandbox and open Audit trail.
6. Set maximum duty to 16 h, minimum rest to 8 h, and certification assessment to Duty start. Record a reason and save a new version. A fresh Quick walkthrough upload gives one finding. The earlier check still shows three.
7. Try **Catch input mistakes** from Sample library. Select UTC for the unzoned time when prompted. The zero-duration duty still rejects the upload before checking.

Sample counts are tied to the initial illustrative policy. “No configured flags” does not certify compliance: first duties lack previous rest context, histories are not merged, cumulative duty limits are not implemented, and actual regulations remain to be confirmed.

All identities, duties and qualifications are fictional. Each browser has an isolated demo space. Demo roles are selectable for review; actual authentication and assigned roles belong to the planned internal rollout. Workspace access expires after seven days. Do not upload actual employee records.
