# Koda Resolutions 2027

The member app for Koda CrossFit Iron View's six-week nutrition and lifestyle challenge
(Jan 18 – Feb 28, 2027). People sign up as a **Current Koda Member** or a **Remote Participant**
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
| Participants | One row per person: intake answers in readable columns, points, days logged, whether the welcome email went out | Kevin edits **Paid**, **Coach**, **Team**, **Status**, **Type**, **Notes**. Sort and filter it freely |
| App Data (hidden tab) | Each person's checklist setup and check-in history, keyed by ID, stamped with that ID | Nobody. If it's ever sorted on one column only, the app refuses to read the mismatched rows (and logs it) rather than mixing people up: undo the sort |
| Check-ins | One row per person per day: done, the day's score out of 10, bonus, points, every answer in words | The app |
| Days | Day 1–42 from the 2027 video plan: title, video link, category, "About", action item, bonus task, presenter, plus filming notes and the 2026 video it can reuse (the last two columns aren't shown in the app) | Kevin and the coaches |
| Finishers | Finisher workouts by week (shown to people tracking finishers) | Kevin |
| Settings | Dates, price, Venmo/Zelle/card link, coaches, contact email, edit window | Kevin |
| Accounts | Sign-in data: salted password hashes, never passwords | Nobody |
| Log | Sign-ups, setup changes, errors | The app |

Changes to Settings and Days show in the app within about a minute.

### Common jobs

- **Add today's video:** paste the YouTube link into `Video URL` on that day's row. Unlisted is fine.
  Several versions (e.g. the hormone videos): one per line, like `Guys: https://youtu.be/…`.
  If a label contains the person's goal (e.g. `Fat Loss: …`), that version opens first for them.
- **A one-day bonus:** fill `Bonus Task` (and `Bonus Points`, default 1) on that day. It shows up on
  everyone's checklist that day only and adds its points on top of the day's score out of 10.
- **Mark a remote payment:** type `TRUE` in `Paid`. Their app stops showing "payment pending".
- **Teams and coaches:** fill `Team` and `Coach` on Participants. They show on the person's profile.
- **Remove someone:** set `Status` to `Removed`. They're signed out and can't sign back in.
- **Close sign-ups:** set `registration_open` to FALSE in Settings. Signing in keeps working.
- **Change the dates:** `start_date` and `length_days` in Settings. The app counts from them.
- **Card payments:** make a $99 Zen Planner retail product and paste its checkout link into
  `card_url`. Until then, card payers are told we'll email them a secure link.
- **Venmo:** the app and welcome email build a "Pay $99 on Venmo" button from `venmo` and
  `remote_price`, with the amount and "Koda Resolutions 2027 - Name" filled in.
- **Shirt orders:** put the order date in `shirt_changes_until`. After it, sizes are locked in the
  app and people are told to email you. Every size change is written to the Log tab.
- **Emails that didn't go out** (the Gmail account sends about 100 a day, shared with the other
  Koda sign-up pages) show on the Log tab as "Email not sent", and the person's Welcome Email cell
  says NOT SENT. Welcome emails stop while fewer than 25 sends are left that day.
- **Forgot password:** people reset it themselves with an emailed 6-digit code. If email fails
  they're told to email the contact address.

### Missed days (Overdue)

A day that hasn't been filled in (some habit still has no Yes or No) stays open for
`edit_days_back` days after it (2 by default), then locks. While it's open the app calls it
**Overdue**: a card at the top of Today ("Yesterday · Day 1 — Not filled in yet. You can fill it in
through tomorrow"), an amber day in the week strip and the Progress calendar, and a count on the
Today tab. Tapping it opens that day; the last answer says it's caught up.

### Beta test (a practice run before Jan 18)

Put a date in `beta_start` (Settings), e.g. `2026-11-09`, and a length in `beta_days` (7).
Then send testers **https://koda-crossfit.github.io/resolutions/?beta=1**:

- The landing page shows the beta dates and says it's practice. Sign-ups through that link become
  `Type` = `Test` (Notes says what they picked), pay nothing, and get a beta welcome email that
  says they'll sign up again for the real challenge.
- Have testers open the link in Safari/Chrome and sign up there first, then add it to the home
  screen and sign in once. (An iPhone home-screen app keeps its own storage; if someone starts there,
  the real landing page shows a "Here for the beta test? Join the beta" link while the beta is open.)
- Every Test account goes through Days 1, 2, 3… of the plan on the real dates from `beta_start`. A day
  with no `Video URL` yet plays the 2026 video in `2026 Video (not shown)`, marked as a stand-in (only
  in the beta). A pasted link replaces it.
- After the beta's last day the beta link stops making Test accounts. A beta page left open and sent
  after that is stopped ("The beta test is over…") instead of quietly becoming a real $99 sign-up.
  Beta testers keep their beta week until `beta_start` is cleared; after that their account says
  it's a test account that will be deleted.
- Test rows stay out of the summary (it shows how many there are). End the beta with
  `node dev/live.js beta off`, and clear every test account before launch with
  `node dev/live.js purge-tests` (or one with `purge-test <email>`; while a beta runs, use that one
  for your own practice accounts, because `purge-tests` also removes every beta tester).

From this folder: `node dev/live.js beta 2026-11-09 7` starts one (it checks the live backend is
1.3.0 or later first, and prints what the app now says).

### Trying one day as a participant

With no beta set, give a Test account a date in `preview_today`, e.g. `2027-01-21`: every Test
account then sees that date as today (Day 4 of the real challenge). `preview_today` is ignored while
a beta is set, so beta testers always see the real date. Clear it when you're done.

## Points: every day is out of 10

Kevin's rules (11/10/2026), so someone tracking two habits and someone tracking all of them
compete fairly. Each habit has a weight:

| On the checklist | Weight |
|---|---|
| Nutrition: Breakfast, Lunch, Dinner, Snacks (or none), each | 1 (4 in all) |
| Daily workout · Sleep | 2 each (half of nutrition) |
| Video · Protein minimum · Water · Skill work · Mobility · Recovery · Other | 1 each (a quarter of nutrition) |
| Finisher (weekly goal of 1, 2 or 3) | 1, only on the days one is done |

The day's score is 10 × (weight answered Yes) ÷ (weight on that day's list), to one decimal.
On the last day of each challenge week (Sunday), every finisher short of that week's goal adds 1
to the list, so missing them lowers Sunday's score; doing them keeps a perfect week perfect. A
bonus task adds its `Bonus Points` (default 1) **on top** of the 10. A day's points are its
score plus any bonus, and the Participants `Points` column adds them up (42 perfect days = 420,
plus bonuses). The weights live in `RES27_POINTS` at the top of `Resolutions27.js`.

Sign-up asks Yes or No for every habit (nutrition, workout and sleep start on Yes). The sleep goal
starts at 7 hours. Finishers are 1, 2 or 3 a week. "Other" is one short habit typed on the habits
page. The last page has no consent checkbox (Kevin, 11/10).

## Running it locally

```
node dev/server.js            # http://localhost:8790, real backend on an in-memory fake sheet
node --test "tests/*.test.js" # backend tests (43)
node tests/e2e.js             # browser walkthrough + screenshots (needs the dev server)
```

Dev-only URLs: `/dev/reset?demo=1&at=2027-01-27T19:30:00-07:00` (fresh world plus a demo
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

Then, from this folder, run `node dev/live.js setup` **before** pushing the front end: it brings
the sheet up to the new code (new columns, setting descriptions, one-time fixes such as the
11/10 change of bonus tasks from 4 points to 1). Check the backend version with
`…/exec?action=res27Health`.

The deployment id above is the hyrox web app every Koda sign-up page calls, so check the
other files in that folder match what's live before pushing (`clasp pull` into a scratch copy
and diff).

Admin requests are POSTs to the web app with `{"type":"res27","action":"…","key":"<hyrox admin key>"}`:
`adminSetup` (creates or repairs the sheet; pass `days` to seed an empty Days tab, `settings` to set
values), `adminSeedDays` (`days`, `overwrite: true` to replace), `adminSummary` (counts, shirt sizes,
unpaid remote people, test accounts), `adminSetType` (`email`, `participantType`: Member/Remote/Test),
`adminPurgeTests` (every Test account, or just `email`). `dev/live.js` wraps all of these.
