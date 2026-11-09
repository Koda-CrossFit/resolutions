# Koda Resolutions 2027

The member app for Koda CrossFit Iron View's six-week nutrition and lifestyle challenge
(Jan 11 – Feb 21, 2027). People sign up as a **Current Koda Member** or a **Remote Participant**
($99), answer a short intake, and get their own daily checklist. Every day they open the app,
watch a short video and tap Yes or No on each habit. Answers save as they tap.

- **Site:** https://koda-crossfit.github.io/resolutions/ (GitHub Pages from `main`; a push goes live in about a minute)
- **Backend:** `apps-script/Resolutions27.js`, deployed inside the hyrox Apps Script project
  (`Desktop\Claude\hyrox-simulation-signup\apps-script`), routed from its `Code.js` by `type: "res27"`.
  That project already has permission for Sheets and email, so this needed no new Google consent.
- **Data:** the Google Sheet **"Koda Resolutions 2027"** in kevschuetz3@gmail.com's Drive
  (its id is in the script property `RES27_SHEET_ID`).

## The sheet

Columns are found by their header, so they can be moved. Don't rename headers.

| Tab | What it holds | Who edits it |
|---|---|---|
| Participants | One row per person: intake answers in readable columns | Kevin edits **Paid**, **Coach**, **Team**, **Status**, **Type**, **Notes**. The app writes the rest. Leave the hidden "(app data)" columns alone |
| Check-ins | One row per person per day: done, points, every answer in words | The app |
| Days | Day 1–42: title, video link, category, "About", action item, bonus task | Kevin and the coaches |
| Finishers | Finisher workouts by week (shown to people tracking finishers) | Kevin |
| Settings | Dates, price, Venmo/Zelle/card link, coaches, contact email, edit window | Kevin |
| Accounts | Sign-in data: salted password hashes, never passwords | Nobody |
| Log | Sign-ups, setup changes, errors | The app |

Changes to Settings and Days show in the app within about a minute.

### Common jobs

- **Add today's video:** paste the YouTube link into `Video URL` on that day's row. Unlisted is fine.
  Several versions (e.g. the hormone videos): one per line, like `Guys: https://youtu.be/…`.
  If a label contains the person's goal (e.g. `Fat Loss: …`), that version opens first for them.
- **A one-day bonus:** fill `Bonus Task` (and `Bonus Points`, default 4) on that day. It shows up on
  everyone's checklist that day only.
- **Mark a remote payment:** type `TRUE` in `Paid`. Their app stops showing "payment pending".
- **Teams and coaches:** fill `Team` and `Coach` on Participants. They show on the person's profile.
- **Remove someone:** set `Status` to `Removed`. They're signed out and can't sign back in.
- **Close sign-ups:** set `registration_open` to FALSE in Settings. Signing in keeps working.
- **Change the dates:** `start_date` and `length_days` in Settings. The app counts from them.
- **Card payments:** make a $99 Zen Planner retail product and paste its checkout link into
  `card_url`. Until then, card payers are told we'll email them a secure link.
- **Forgot password:** people reset it themselves with an emailed 6-digit code. If email fails
  they're told to email the contact address.

### Trying it as a participant before Jan 11

Sign up with your own email, then set that row's `Type` to `Test` and put a date like
`2027-01-14` in `preview_today` (Settings). That account now sees Day 4 and can check in.
Test rows stay out of the summary. Clear every test account before launch with the
`adminPurgeTests` request (below).

## Points

Video 3 · each meal on plan 1 (Breakfast, Lunch, Dinner, Snacks) · workout 2 · sleep 1 ·
water 1 · skill 1 · mobility 1 · each custom habit 1 · finisher 2 (extra credit, doesn't lower
the day's %) · bonus task as set on the Days tab. The same scale as 2026's SugarWOD points, so a
perfect "standard" day is 10. People choose different checklists, so the team leaderboard
(coming later) should rank by **completion %**, not raw points.

## Running it locally

```
node dev/server.js            # http://localhost:8790, real backend on an in-memory fake sheet
node --test tests/api.test.js # backend tests
```

Dev-only URLs: `/dev/reset?demo=1&at=2027-01-20T19:30:00-07:00` (fresh world plus a demo
member, `demo@koda.test` / `koda2027`, with check-ins), `/dev/time?set=ISO`, `/dev/emails`,
`/dev/rows?tab=Participants`, `/dev/as?email=…&password=…&to=%23%2Fprogress` (signs a browser in),
`/dev/slow?ms=900`. `dev/shot.ps1` takes headless-Edge screenshots of any page.

## Deploying

**Front end:** commit and push to `main`.

**Backend** (from `Desktop\Claude\hyrox-simulation-signup\apps-script`, after copying
`apps-script/Resolutions27.js` there):

```
clasp push
clasp create-version "res27: <what changed>"
clasp update-deployment AKfycbwWjHrhE6k3vVPDXD4qi3VLxZVAXMykAFIKocoUiq0BtXdv2XLy7Oo0GRfrP48fHytnyw -V <n> -d "res27: <what changed>"
```

The deployment id above is the hyrox web app every Koda sign-up page calls, so check the
other files in that folder match what's live before pushing (`clasp pull` into a scratch copy
and diff).

Admin requests are POSTs to the web app with `{"type":"res27","action":"…","key":"<hyrox admin key>"}`:
`adminSetup` (creates or repairs the sheet; pass `days` to seed an empty Days tab),
`adminSeedDays` (`days`, `overwrite: true` to replace), `adminSummary` (counts, shirt sizes,
unpaid remote people), `adminSetType` (`email`, `participantType`: Member/Remote/Test),
`adminPurgeTests`.
