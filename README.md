# Koda Resolutions 2027

The member app for the Koda gyms' six-week nutrition and lifestyle challenge (Jan 18 – Feb 28,
2027), run by Koda CrossFit Iron View for all six gyms (since 11/23/2026). People pick their gym, sign up as a **Current
Koda Member** or a **Remote Participant** ($99), answer a short intake, and get their own daily
checklist. Every day they open the app, watch a short video and tap Yes or No on each habit.
Answers save as they tap, and a 3 AM email each day gives them the day and a link to log yesterday.

- **Site:** https://koda-crossfit.github.io/resolutions/ (GitHub Pages from `main`; a push goes live in about a minute).
  One link per gym (see [Six gyms](#six-gyms)).
- **Backend:** `apps-script/Resolutions27.js`, deployed inside the hyrox Apps Script project
  (`Desktop\Claude\hyrox-simulation-signup\apps-script`), routed from its `Code.js` by `type: "res27"`.
  The daily email (1.8.0) needs two Google permissions the project didn't have before (calling the
  email service, and the hourly timer): Kevin approves them once, in the order under
  [Deploying](#deploying) ("1.8.0 deploy order").
- **Data:** the Google Sheet **"Koda Resolutions 2027"** in kevschuetz3@gmail.com's Drive
  (its id is in the script property `RES27_SHEET_ID`).

## The sheet

Columns are found by their header, so they can be moved. Don't rename headers.

| Tab | What it holds | Who edits it |
|---|---|---|
| Participants | One row per person: their **Gym**, intake answers in readable columns, points, days logged, whether the welcome email went out, **Daily Email** (On/Off: it's on only when blank, On, Yes, Y, TRUE or 1, so anything else typed there, like "Off (asked 1/20)", stops it) | Kevin edits **Paid**, **Coach**, **Team**, **Status**, **Type**, **Gym** (before Day 1; `live.js set-gym` after), **Daily Email**, **Notes**. Sort and filter it freely |
| Gyms | One row per gym: name, city, address, time zone, contact email (members' replies go there), coaches and their emails, Venmo / Zelle / card link, remote price | Kevin and each gym's owner |
| App Data (hidden tab) | Each person's checklist setup and check-in history, keyed by ID, stamped with that ID | Nobody. If it's ever sorted on one column only, the app refuses to read the mismatched rows (and logs it) rather than mixing people up: undo the sort |
| Check-ins | One row per person per day: done, the day's score out of 10, bonus, points, every answer in words | The app |
| Days | Day 1–42 from the 2027 video plan: title, video link, category, "About", action item, bonus task, presenter, plus filming notes and the 2026 video it can reuse (the last two columns aren't shown in the app) | Kevin and the coaches |
| Finishers | Finisher workouts by week (shown to people tracking finishers) | Kevin |
| Settings | Dates, default price and contact email, the daily email switches | Kevin (payment details, coaches and coach emails moved to the Gyms tab on 11/23/2026) |
| Questions | Every "Ask a question" from the FAQs page: who, their coach, where it was emailed, the question | The app |
| Accounts | Sign-in data: salted password hashes, never passwords | Nobody |
| Log | Sign-ups, setup changes, errors | The app |

Changes to Settings and Days show in the app within about a minute.

### Common jobs

- **Add today's video:** paste the YouTube link into `Video URL` on that day's row. Unlisted is fine.
  Several versions (e.g. the hormone videos): one per line, like `Guys: https://youtu.be/…`.
  If a label contains the person's goal (e.g. `Fat Loss: …`), that version opens first for them.
  **One gym's own video:** a line labeled with the gym (`Tulsa: https://youtu.be/…`, or `OKC:`,
  `Native:`, `Norman:`, `Downtown:`, `Iron View:`, or the gym's Name on the Gyms tab) replaces that
  day's video for that gym only; everyone else keeps the shared one. A label that names a gym
  anywhere belongs to the gyms it names, and the rest of it is that version's label:
  `OKC Fat Loss:` is OKC's Fat Loss version, `Tulsa, Native:` and `OKC-Tulsa:` go to both. Any gym
  name in a label makes the line that gym's, so there's no "not" or "except" form (`Not OKC:` is
  OKC's), and a gym name inside an ordinary label counts too (`Downtown 5K:` is Downtown's). The
  same works on the Finishers tab.
- **A one-day bonus:** fill `Bonus Task` (and `Bonus Points`, default 1) on that day. It shows up on
  everyone's checklist that day only and adds its points on top of the day's score out of 10.
- **Mark a remote payment:** type `TRUE` in `Paid`. Their app stops showing "payment pending".
- **Teams and coaches:** fill `Team` and `Coach` on Participants. They show on the person's profile,
  and the person's questions from the FAQs page go to that coach (add the coach to `Coach Emails` on
  their gym's row of the Gyms tab). Teams belong to a gym: "Iron" at OKC and "Iron" at Tulsa are two teams.
- **Remove someone:** set `Status` to `Removed`. They're signed out and can't sign back in.
- **Close sign-ups:** set `registration_open` to FALSE in Settings. Signing in keeps working.
- **Change the dates:** `start_date` and `length_days` in Settings. The app counts from them.
- **How remote people pay (per gym, Gyms tab):** the gym's `Venmo` (the app and welcome email build
  a "Pay $99 on Venmo" button with the amount and "Koda Resolutions 2027 - Name" filled in) and
  `Zelle` when they're filled in, and a credit card at every gym (Kevin, 11/23/2026: "put a
  placeholder for the card link, we'll add one later"). With the gym's checkout link in `Card URL`,
  card payers get a "Pay $99 by card" button; until it's there they're told "We'll email you a
  secure link" (the app and the welcome email say so, and Payment says Credit Card), so email them
  one. Money never falls back to Iron View's details. `Remote Price` blank = Settings `remote_price`.
- **Shirt orders:** put the order date in `shirt_changes_until`. After it, sizes are locked in the
  app and people are told to email you. Every size change is written to the Log tab.
- **Emails that didn't go out** (the Gmail account sends about 100 a day, shared with the other
  Koda sign-up pages) show on the Log tab as "Email not sent", and the person's Welcome Email cell
  says NOT SENT. Welcome emails stop while fewer than 25 sends are left that day.
- **Forgot password:** people reset it themselves with an emailed 6-digit code. If email fails
  they're told to email the contact address.

### Six gyms

One site, one sheet, six gyms (Kevin, 11/23/2026). Share each gym's own link: it opens in that
gym's colors and picks the gym for the sign-up (the phone remembers it):

| Gym | Link | Colors | Time zone |
|---|---|---|---|
| Koda Iron View | https://koda-crossfit.github.io/resolutions/ (or `?gym=ironview`) | navy + silver (the default) | Mountain |
| Koda OKC | https://koda-crossfit.github.io/resolutions/?gym=okc | black + purple | Central |
| Koda Native (Bethany) | https://koda-crossfit.github.io/resolutions/?gym=native | black + pink | Central |
| Koda Norman | https://koda-crossfit.github.io/resolutions/?gym=norman | black + crimson | Central |
| Koda Downtown (Austin) | https://koda-crossfit.github.io/resolutions/?gym=downtown | black + green | Central |
| Koda Tulsa | https://koda-crossfit.github.io/resolutions/?gym=tulsa | teal + grey | Central |

The plain link shows Iron View's colors and makes the person pick a gym (nothing is pre-picked).
Signed in, the app always uses the person's own gym. Colors are in two places that must match:
`C.gyms` in `assets/content.js` and the `:root[data-gym]` rules in `assets/app.css` (the e2e checks
they match and that every text color is readable). The gym list itself is also `RES27_GYMS` in the
backend (a unit test checks the two lists match).

What changes by gym: colors and name, the Gyms tab row (payment, coaches, contact email used as
Reply-To), videos labeled with the gym, the team standings, and the time zone of the 3 AM email.
A gym's `Time Zone` must be one of America/New_York, America/Chicago, America/Denver,
America/Phoenix, America/Los_Angeles, America/Anchorage or Pacific/Honolulu (any case); anything
else counts as the gym's own zone from the code.
A person's gym can be changed in the app until Day 1: it locks as soon as Day 1 has started at their
own gym (12:30 AM on Jan 18 in Oklahoma, Day 1 there, is still Jan 17 in Denver), on their phone (a
phone east of the gym reaches Day 1 first, and can log it), or at the gym they'd move to (they
couldn't move back). After that only with `live.js set-gym` (moving someone
mid-challenge lets people work out their total, same as moving teams). Either way a gym change
clears their **Team** and **Coach** (they were for the old gym: teams belong to a gym), and the Log
line ("Changed gym · Tulsa → OKC · Team Thunder and Coach Sam cleared") and `set-gym` say so, so
set the new ones.

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

**My gym / All gyms** (11/23/2026): "My gym" is the list above with only your gym's teams, plus
your gym's place on the You card. "All gyms" ranks the six gyms by average points per person
(whole challenge or this week). A gym with fewer than 3 people shows no number, and a gym's
number is also held back while only 1 or 2 of its people are outside the teams that show
numbers (otherwise the gym average minus the team averages would give away their own score).

### The daily email (3 AM)

Kevin, 11/23/2026: "an automated email each day for each person with the details of that day and
a link to the website to log the previous days scores … the same email for all participants if
they are doing a good job logging their scores … it should say that they are overdue if they
haven't entered their points for the day 2 days before. Like 3am on a wednesday would say they are
overdue if they didn't enter monday's points."

- **When:** 3 AM in each gym's own time zone. One trigger runs every hour, and each gym's email
  goes on its first run after 3:00 there (so between 3 and 4 AM). A run Google skips is made up
  by the next one, until noon; changing `email_hour` needs nothing else. A run sends a day again
  only to people it failed for, never to people it may already have reached (see the next two
  points); only `email-send --force` sends a deliberate second copy.
- **If sending fails:** when none of a gym's emails went out, its day stays open and the next run
  sends it again; when some did, the next runs that morning send it to just the people it failed
  for. Either way the Log row says so and the run fails, so Google emails Kevin, with the command
  to send it by hand (it names the day: `--date=`). Resend sends a batch "permissively": one
  address it turns down no longer stops the rest of the gym.
- **No answer (unconfirmed):** if a batch's answer never comes back (a timeout, or a gateway's 502
  or 504), Resend may have sent it, so its people are **unconfirmed**: nothing sends it to them
  again on its own, and the Log row and Google's email name them. Check Resend's log (Emails),
  then `node dev/live.js email-send <gym> --date=<day> --yes` sends it to them. Every batch carries
  an Idempotency-Key made from the gym, the day and its people, and Resend keeps it for 24 hours:
  within that time a resend of a batch Resend already took sends nothing again. After 24 hours, or
  if someone left that batch's list meanwhile, it would go out again, so look at the log first.
- **Addresses that aren't valid:** sign-up refuses addresses like `jess@gmail.com.` that an email
  service would turn down. One that got in before that check is skipped by the daily email (so it
  can't hold up the gym's batch), named on that day's Log row ("1 skipped, address not valid"),
  and listed by `node dev/live.js gyms` instead of being counted as "on": fix Email on both
  Participants and Accounts. Their questions from the FAQs page still reach the coach, with
  replies going to their gym's Contact Email (the email says so).
- **Who:** everyone with an email whose challenge is running that day, from Day 1 through the
  Monday after Day 42 (the last week stays open until that midnight), unless their Daily Email is
  Off. Beta testers get it during a beta. Nothing before Day 1.
- **What:** today's day, video, action and bonus; "Log yesterday's points" (from Day 2); on Mondays
  "Last week locks tonight at midnight". The **Overdue** box only for people with nothing logged
  two days ago, and only while that day can still be filled in (so never on Tuesdays: Sunday locked
  at Monday midnight).
- **From** `resolutions@kodacrossfitironview.com`, named "<Gym> Resolutions" ("Koda OKC
  Resolutions"); **replies** go to the gym's Contact Email on the Gyms tab (blank: Settings
  `contact_email`, which is also used when the gym's has a typo). A gym Name with a comma is fine
  (it's sent in quotes). Every email has a "Stop these daily emails" link (a page with a button,
  so email scanners can't trip it); people can also switch it in their Profile.
- **Log tab:** one row per gym per run: how many sent, failed, unconfirmed and overdue, and their
  addresses (and anyone skipped). `node dev/live.js gyms` shows the last day each gym's went out
  and, for each day, anyone waiting for a resend.

**Turning it on (once):**
1. Resend (Kevin's own account): kodacrossfitironview.com added 11/23/2026. It's verified (and moved
   off the old Iron Games team-finder account) once Resend's TXT record is on the domain (cPanel →
   Zone Editor; the record is on Resend's Domains page). Upgrade to Pro ($20/month) before Jan 18:
   the free plan stops at 100 emails a day.
2. Resend → API Keys → create "Koda Resolutions" (Sending access, that domain). Paste it in the
   Apps Script project (hyrox) → Project Settings → Script Properties as `RES27_EMAIL_API_KEY`.
   It's never in the sheet, the repo or a log.
3. Deploy 1.8.0 in the order under [Deploying](#deploying) ("1.8.0 deploy order"): push, then in
   the script editor run `res27AuthorizeEmail` once and click Allow (new permissions: call the
   email service, run the hourly timer), and only then make the new version live.
4. Settings: `email_provider` = `resend`, `email_from` = `Koda Resolutions <resolutions@kodacrossfitironview.com>`.
5. Try it: `node dev/live.js email-preview okc` (saves the email as a page), `node dev/live.js
   email-send okc --date=2027-01-20` (who would get what, sends nothing), then a real send to your
   own inbox only: `node dev/live.js email-send okc --date=2027-01-20 --to=<your email> --yes`
   (any day; it goes to that one address and marks nothing, so the morning's run still sends that
   day to everyone). To try it, always use `--to`: without it `--yes` is the real send to the
   whole gym (and a later day than today is refused).
6. `node dev/live.js email-triggers on` (the hourly trigger), and set `daily_email` to TRUE (the
   master switch).

If a morning's email failed: the next hourly runs (until noon) send it to whoever it failed for
(never to the unconfirmed ones). Each day keeps its own list of people waiting, so the next
morning's send doesn't touch the day before's. `node dev/live.js email-send <gym> --date=<day>`
shows who's waiting that day (failed, and unconfirmed) and what `--yes` would do;
`email-send <gym> --date=<day> --yes` then sends that day's to just them (or today's to everyone,
if none of it went out), on any later day. Every command the alarm, the Log and `live.js` print
names the day, and once no run is left (after 11 AM, or for an earlier day) they say to send it
by hand. A list waits 7 days; after that, or once the challenge (or a beta) is over, it's dropped
and the Log tab says who never got that day ("dropped the list of …"). `--force` sends a day's
email to everyone again (a deliberate second copy, so it has new Idempotency-Keys). A later day is
always refused (that morning's run sends it); an earlier day's goes only to the people waiting on
its list, or with `--force` to everyone.

### Koda Cookbook

**Koda Cookbook** is its own page (`#/cookbook`; its own sidebar item since 11/12/2026; on phones a
chip on the Nutrition tab, which stays lit there). It's the 2026 Koda Resolutions Cookbook (the PDF
in the gym's Drive): its six sections (Breakfast, Lunch, Dinner, Soups & Chili, Snacks, Sides) open
to their recipes, each recipe to its photo, ingredients, directions, notes and credit, with a search
box. The data is `content/cookbook.json`, built from the PDF's text by `node dev/build-cookbook.js`
(it reads the git-ignored `content/private/cookbook-2026-pdf.txt`). For a new edition, save the new
PDF's text there and run the script again.

**Photos.** The PDF has none, so each recipe has a free-licensed example photo picked to match it
(Kevin's choice, 11/12/2026): Creative Commons photos from Flickr, Wikimedia and stock sites, found
through Openverse, each licence then checked on the photo's own page. `content/cookbook-photos.json`
lists them by recipe id with each one's alt text, title, creator, source page and licence; the files
are `assets/cookbook/<id>.jpg` (960×640) and `assets/cookbook/thumbs/<id>.jpg` (160×160), crops of
the original. The build merges them in and refuses a missing file, a photo used twice, a licence we
can't use (only CC0, public domain, CC BY and CC BY-SA), or a CC BY photo with no creator. Each
recipe shows the credit the licence asks for (`Example photo: "Title" by … · CC BY 2.0, cropped`,
linked to the source page, the creator and the licence), so keep it. The cropped copies of CC BY-SA
photos are shared under the same licence. To swap a photo, replace both files and its entry, then
run the build again.

### FAQs and Ask a question

**FAQs** is its own item in the sidebar (on phones it's under Profile › Help, because the bottom tab
bar holds five). The questions live in `assets/content.js` (`faq`). Below them, **Ask a question**
is a text box: the question is emailed to the person's coach (the `Coach` column on Participants,
matched to `Coach Emails` on their gym's row of the Gyms tab, e.g. `Riley: riley@example.com`, one
per line), with Reply-To set to the person, so the coach just hits Reply. No coach yet, or a coach
with no email listed: it goes to the gym's `Contact Email` (blank: Settings `contact_email`). Every
question is also kept on the Questions tab. Five an hour and twenty a day per person, up to 2,000
characters. Coaches' addresses never reach the app.

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
  written to the Log tab ("Changed type", e.g. `Member → Test`). Moved people are deleted with the
  beta like everyone else on it (Kevin, 11/11), so tell them they'll sign up again.
- Every beta account sees a grey note at the top of Today: practice only, beta accounts are deleted
  when the beta ends, sign up again for Day 1.
- Every Test account goes through Days 1, 2, 3… of the plan on the real dates from `beta_start`. A day
  with no `Video URL` yet plays the 2026 video in `2026 Video (not shown)`, marked as a stand-in (only
  in the beta). A pasted link replaces it.
- After the beta's last day the beta link stops making Test accounts. A beta page left open and sent
  after that is stopped ("The beta test is over…") instead of quietly becoming a real $99 sign-up.
  Beta testers keep their beta week until `beta_start` is cleared; after that their account says
  it's a test account that will be deleted.
- Test rows stay out of the summary (it shows how many there are). While a beta runs, clear one of
  your own practice accounts with `purge-test <email>`: `purge-tests` covers every beta tester too.

From this folder: `node dev/live.js beta 2026-11-09 7` starts one (it checks the live backend is
1.3.0 or later first, and prints what the app now says). A new one is refused while Test accounts
are on Participants and no beta is running (they're left from one that's over, or were moved to
Test: every Test account goes through whatever beta is set, daily emails included): run
`end-beta` first, or add `--force`. The beta that's running can be changed with its testers on
it: a new length (`beta 2026-11-09 14`), or a new start while it's still open. `beta off`,
`end-beta` and `purge-tests` need 1.7.0.

### Ending the beta

Kevin's call (11/11/2026, "Delete with the beta"): when the beta ends, every beta account is deleted,
including people who signed up for real and were moved onto it. They sign up again for January.
Kevin's own account goes back to Member and is kept. One command does it, in the safe order:

1. **When:** not before the Tuesday after the beta's last day. The last week can be filled in until
   midnight on Monday (Mountain); `end-beta` and `beta off` both refuse to run before then.
2. **Look first.** While Kevin is still Test, his Leaderboard shows the beta's final standings, and the
   sheet's Check-ins and Questions tabs hold the testers' days and questions. All of that goes with the
   purge. For a marked copy, use File › Version history › Name current version first; version history
   can also bring rows back after a mistake.
3. **Tell the testers** their beta account is being deleted and to sign up again (the Today note has
   said so since 11/11, but a direct message is the sure way, especially for people who were moved).
4. **Preview:** `node dev/live.js end-beta <kevin's email>` lists who would be deleted and how each
   became Test ("beta sign-up" or "moved to Test"), and flags anyone who may have paid (a Remote
   choice, a payment method or Paid) or who is neither (a Type cell changed by hand, or the Type
   column sorted on its own, looks like that; so do people moved before moves were logged, at about
   11 AM on 11/11/2026: Kevin and the first four testers). It changes nothing, and ends with the exact
   command to run, including a short code for that list: `--yes=<code>`.
5. **Do it:** run that command. If the list changed since the preview, the code no longer matches and
   nothing happens. Otherwise, in order, it:
   - sets Kevin to Member, clearing his practice days (his beta-dated Check-ins rows and history) and
     counting his Points and Days Logged again;
   - deletes exactly the Test accounts on that list, never the kept email or any row with its ID,
     writing each one to the Log tab first ("Deleting test account");
   - turns the beta off (`beta_start` blank, `beta_everyone` FALSE);
   - checks that no Test accounts are left. It ends with `"ok": true`.
6. If it lists rows that "don't line up", a tab was sorted on one column, or an email was changed on
   only one of Participants and Accounts: nothing is deleted. Undo the sort (Edit › Undo is safest;
   restoring an old version also undoes everything since) or make the emails match, then preview again.

The backend checks every row before deleting anything (the Accounts tab says who each ID belongs
to), so a sorted ID, email or data column can't take a real member's rows with it. A Type column
sorted on its own can't be caught that way, which is why the list says how each person became Test.
A Questions row whose email doesn't match is left in place and listed. A phone still signed in to a
deleted account is told "This account no longer exists… Sign up again" and lands on Sign in.
`purge-tests` works the same way (it lists with a code; `--yes=<code>` deletes that list) and takes no
email: for one account use `purge-test <email>`. Every `live.js` command checks its arguments (an
on/off flag like `--overwrite` or `--force` takes no `=value`), says which backend it's talking to,
and exits 1 when the backend says no, so nothing chained after a failed step runs.
`setting <key> --clear` blanks a value (in PowerShell an empty `""` never reaches node), and a
misspelled setting name is refused. `node tests/endbeta-cli.js` runs all of this against the dev
server (see "Running it locally"), with every request kept on this computer.

### Trying one day as a participant

With no beta set, give a Test account a date in `preview_today`, e.g. `2027-01-21`: every Test
account then sees that date as today (Day 4 of the real challenge). `preview_today` is ignored while
a beta is set, so beta testers always see the real date. Clear it when you're done. Use a separate
Test account for this, not your own: days saved this way are on real challenge dates, so they stay
when the account goes back to Member and would count in January.

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
node --test "tests/*.test.js" # backend, gyms, daily email + cookbook tests (127)
node tests/e2e.js             # browser walkthrough (173 checks) + screenshots (needs the dev server;
                              #   E2E_BASE=http://localhost:<port> for another port)
node tests/endbeta-cli.js     # live.js end-beta / purge-tests / beta against the dev server (resets it; 45 checks)
node tests/email-cli.js       # live.js gyms / email-* commands against the dev server (57 checks)
```

The two CLI scripts take `BASE=http://localhost:<port>` for a dev server on another port.

Another port: `PORT=8795 node dev/server.js`. The dev world sends daily emails through a fake
Gmail (`email_provider` = `mailapp`): `/dev/run-daily?gym=okc&dry=1` runs a gym's 3 AM email at
the dev clock's time (drop `dry=1` to "send"), and they show in `/dev/emails`. `/dev/gym` edits a
Gyms-tab row; `/dev/email-off` makes a stop link. `/dev/resend?on=1` sends through the mock's
Resend instead (a made-up key; the mock answers on this computer), and
`/dev/resend?fail=<email>&how=refuse|down|lost` makes that address's batch turned down, answered
503, or taken with its answer lost, to see what Kevin would see (`?off=1` goes back to mailapp).

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
`…/exec?action=res27Health`; `setup` checks it too, and stops if the live backend isn't 1.8 yet
(an `update-deployment` that pointed at the wrong version), before anything changes.

**While the daily email's trigger is on** (`email-triggers on`, from January): the hourly run uses
the project's latest **pushed** code, not the deployed version. So every `clasp push` from the
hyrox folder changes the next run's emails at once, before `create-version` or
`update-deployment`, and including pushes made for the other Koda pages in that folder. Push
Resolutions27.js only as part of a full release (push, version, deploy, setup in one go), and to
roll the email back, push the old file too: rolling the deployment back alone doesn't.

The deployment id above is the hyrox web app every Koda sign-up page calls, so check the
other files in that folder match what's live before pushing (`clasp pull` into a scratch copy
and diff).

Admin requests are POSTs to the web app with `{"type":"res27","action":"…","key":"<hyrox admin key>"}`:
`adminSetup` (creates or repairs the sheet; pass `days` to seed an empty Days tab, `settings` to set
values), `adminSeedDays` (`days`, `overwrite: true` to replace), `adminSummary` (counts, shirt sizes,
unpaid remote people, test accounts, per-gym counts), `adminSetType` (`email`, `participantType`:
Member/Remote/Test), `adminPurgeTests` (every Test account, or just `email`), `adminSetGym`,
`adminEmailPreview`, `adminEmailSend`, `adminEmailTriggers`. `dev/live.js` wraps all of these.

**1.8.0 (six gyms) deploy order.** The editor only asks for permissions the code already in the
project uses, so 1.8.0 has to be pushed before Kevin can approve them, and made live only after:

1. `node dev/install-backend.js` (copies Resolutions27.js into the hyrox folder).
2. `clasp push` **only**. The live web app is pinned to a version, so nothing changes yet.
3. Reload the script editor, pick `res27AuthorizeEmail` and Run, then on Google's screen tick
   **Select all** and Allow (both new permissions: leaving either unticked breaks the web app). It
   should return "Email permissions are on".
4. `clasp create-version "res27: …"`, then `clasp update-deployment … -V <n> -d "res27: …"` (above).
5. Check that `…/exec?action=res27Health` says 1.8.0.
6. `node dev/live.js setup` (adds the Gyms tab, the Gym column after Type and the Daily Email column
   after Welcome Email, and fills blank Gym cells with Iron View). Then `node dev/live.js gyms` and
   check Iron View's line shows `Venmo @kevin-schuetz-5`.
7. Push the front end.

If 1.8.0 is ever made live before step 3, every Koda page on the hyrox web app answers
"Authorization is required…" (and `live.js` says "Not JSON"): run `res27AuthorizeEmail` in the
editor and Allow; no new deployment is needed.

A page cached from before 1.8.0 (an open tab, a phone that hasn't reloaded) can still sign people
up after the deploy: its sign-ups send no gym, so they're Iron View's, the only gym that page knew.
