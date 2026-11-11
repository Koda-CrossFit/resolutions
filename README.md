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
| Settings | Dates, price, Venmo/Zelle/card link, coaches and their emails, contact email | Kevin |
| Questions | Every "Ask a question" from the FAQs page: who, their coach, where it was emailed, the question | The app |
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
- **Teams and coaches:** fill `Team` and `Coach` on Participants. They show on the person's profile,
  and the person's questions from the FAQs page go to that coach (add the coach to `coach_emails`).
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

### Leaderboard (team standings)

The second tab (it was Progress until 11/10). It shows each person their own four numbers (points,
daily average out of 10, days logged, streak) and the **team standings**: every team ranked by its
average points per person, for the whole challenge or this week, so team size doesn't matter.
Teams come from the `Team` column on Participants ("Iron", "iron" and "Team Iron" are the same team;
the app shows "Team Iron"). Only team averages ever leave the server: nobody sees anyone else's own
score (Kevin's choice), so a team with fewer than **3 people** is listed without a score (its
average would be someone's own). Removed people and people with no team don't count; beta testers
only see the beta testers' teams. The standings refresh about every two minutes. Nothing is ranked
before Day 1.

**Set teams before Day 1.** Mid-challenge, moving one person to another team, removing them or
clearing their Team cell lets anyone who compares the standings before and after work out that
person's total. If a change is needed, make several at once.

### Koda Cookbook

Nutrition › **Koda Cookbook** is the 2026 Koda Resolutions Cookbook (the PDF in the gym's Drive):
its six sections (Breakfast, Lunch, Dinner, Soups & Chili, Snacks, Sides) open to their recipes,
each recipe to its ingredients, directions, notes and credit, with a search box. The data is
`content/cookbook.json`, built from the PDF's text by `node dev/build-cookbook.js` (it reads the
git-ignored `content/private/cookbook-2026-pdf.txt`). For a new edition, save the new PDF's text
there and run the script again.

### FAQs and Ask a question

**FAQs** is its own item in the sidebar (on phones it's under Profile › Help, because the bottom tab
bar holds five). The questions live in `assets/content.js` (`faq`). Below them, **Ask a question**
is a text box: the question is emailed to the person's coach (the `Coach` column on Participants,
matched to `coach_emails` in Settings, e.g. `Riley: riley@example.com`, one per line), with
Reply-To set to the person, so the coach just hits Reply. No coach yet, or a coach with no email
listed: it goes to `contact_email`. Every question is also kept on the Questions tab. Five an hour
and twenty a day per person, up to 2,000 characters. Coaches' addresses never reach the app.

### Missed days (Overdue) and the weekly window

Kevin, 11/11: people can enter or change their scores for **any day of the week until midnight on
the Monday after it**. That's when the week's scores are pulled; they're tallied Tuesday morning.
So on a Monday, all of last week is still open; from Tuesday on, only this week (never a day
ahead). A past day that's still open and not finished (some habit has no Yes or No) is **Overdue**:
a card at the top of Today ("Yesterday · Day 1 — Not filled in yet. You can fill it in until Monday
at midnight", at most three rows), an amber day in the week strip, and a count on the Today tab.
Tapping it opens that day; the last answer says it's caught up. (The old `edit_days_back` setting
is gone.)

### Beta test (a practice run before Jan 18)

Put a date in `beta_start` (Settings), e.g. `2026-11-09`, and a length in `beta_days` (7).
Then send testers **https://koda-crossfit.github.io/resolutions/?beta=1**:

- The landing page shows the beta dates and says it's practice. Sign-ups through that link become
  `Type` = `Test` (Notes says what they picked), pay nothing, and get a beta welcome email that
  says they'll sign up again for the real challenge.
- Have testers open the link in Safari/Chrome and sign up there first, then add it to the home
  screen and sign in once. (An iPhone home-screen app keeps its own storage; if someone starts there,
  the real landing page shows a "Here for the beta test? Join the beta" link while the beta is open.)
- Testers on the plain link instead? Set `beta_everyone` to `TRUE`: while the beta is open, every
  sign-up joins it (the landing page shows the beta to everyone, and even a page loaded earlier signs
  up a Test account). Once the beta is over, sign-ups are real again either way. Someone who already
  signed up for real can be moved over with `node dev/live.js set-type <email> Test`; type changes are
  written to the Log tab ("Changed type", e.g. `Member → Test`), so you can move them back afterwards.
- Every Test account goes through Days 1, 2, 3… of the plan on the real dates from `beta_start`. A day
  with no `Video URL` yet plays the 2026 video in `2026 Video (not shown)`, marked as a stand-in (only
  in the beta). A pasted link replaces it.
- After the beta's last day the beta link stops making Test accounts. A beta page left open and sent
  after that is stopped ("The beta test is over…") instead of quietly becoming a real $99 sign-up.
  Beta testers keep their beta week until `beta_start` is cleared; after that their account says
  it's a test account that will be deleted.
- Test rows stay out of the summary (it shows how many there are). End the beta with
  `node dev/live.js beta off` (it also turns `beta_everyone` back off), and clear every test account before launch with
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
node --test "tests/*.test.js" # backend tests (52)
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
