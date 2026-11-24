/**
 * KODA RESOLUTIONS 2027 — backend for the member app at koda-crossfit.github.io/resolutions
 *
 * Lives in the hyrox Apps Script project next to Sim1025.js, Trial1025.js, MendWomens.js and
 * Friendsday.js. Code.js routes to it:
 *   doPost: data.type === "res27"          → res27Post(data)
 *   doGet:  action starting with "res27"   → res27Get(action, e)
 * Every name here starts with res27 / RES27_ so nothing collides with the other files.
 *
 * PERMISSIONS (1.8.0, 11/23/2026): the daily email uses UrlFetchApp (the email provider) and
 * ScriptApp (its hourly trigger), which are new to the hyrox project. Before deploying this version,
 * Kevin pushes it, opens the script editor, runs res27AuthorizeEmail once and clicks Allow (README
 * "1.8.0 deploy order"). Deployed before that, the web app answers "Authorization required" for
 * every Koda page it serves.
 *
 * Six gyms (11/23/2026): one app, one backend, one sheet for all six Koda gyms. A person's gym
 * (Participants Gym column) picks their colors, coaches, payment details, videos, leaderboards and
 * daily email. Each gym's details are on the Gyms tab.
 *
 * Data lives in its own spreadsheet, "Koda Resolutions 2027" (id in the script property
 * RES27_SHEET_ID), made by the adminSetup request. Columns are found by header name.
 *
 * What Kevin edits in the sheet: Settings (dates, prices, the daily email), Gyms (each gym's
 * address, coaches, payment info), Days (titles and video links), Finishers, and on Participants:
 * Paid, Coach, Team, Status, Type, Gym, Daily Email, Notes.
 * Participants can be sorted and filtered freely: each person's checklist setup and check-in
 * history live on the hidden "App Data" tab, keyed by ID, and every write re-checks that the
 * row it is about to change still belongs to that ID.
 *
 * Passwords are never stored: Accounts keeps a salted PBKDF2-HMAC-SHA256 hash. Sign-in returns a
 * signed token the phone keeps, so people stay signed in. Changing a password (or "sign out
 * everywhere") bumps Token Version, which ends every older token.
 */

var RES27_VERSION = '1.8.1 (2026-11-24)';
var RES27_TZ = 'America/Denver';
var RES27_SHEET_PROP = 'RES27_SHEET_ID';
var RES27_SECRET_PROP = 'RES27_SECRET';
var RES27_ADMIN_PROP = 'RES27_ADMIN_KEY';
var RES27_HASH_ROUNDS = 300;
var RES27_TOKEN_MAX_DAYS = 400;
var RES27_MAX_FAILED_LOGINS = 8;
var RES27_LOCK_MINUTES = 15;
var RES27_RESET_MINUTES = 20;
var RES27_RESET_MAX_TRIES = 6;
var RES27_RESET_BAD_BUDGET = 12; // wrong codes per account per 6 hours, across all codes
var RES27_RESET_STARTS_PER_HOUR = 30; // reset emails per hour, whole app
// Answers from sign-in and the password reset, per hour, whole app (review, 11/24/2026): every one
// but a sign-in or a new password says whether the email has an account (res27LookupAllowed_).
var RES27_LOOKUPS_PER_HOUR = 120;
// The sign-up's "already signed up?" hint, per hour, whole app: its own allowance, so a rush of
// sign-ups can't use up sign-in's and the reset's.
var RES27_EMAIL_HINTS_PER_HOUR = 120;
// A failed sign-in or reset code takes at least this long, writes included (second review,
// 11/24/2026): an account's wrong password does a row read and a write that an email with no
// account doesn't, so without it the time an answer took told them apart. (Both do the hashing.)
var RES27_EVEN_ANSWER_MS = 2000;
var RES27_MAIL_RESERVE = 25; // welcome/notify emails leave this many sends for the other Koda pages

var RES27_GOALS = { performance: 'Performance', muscle: 'Muscle Gain', fatloss: 'Fat Loss', health: 'General Health' };
var RES27_PLANS = {
  recommended: 'Resolutions Recommended Plan',
  plant: 'Plant Based',
  whole30: 'Whole30',
  carnivore: 'Carnivore',
  macros: 'Macros',
  other: 'Other',
};
var RES27_TRACK_KEYS = ['nutrition', 'workout', 'sleep', 'protein', 'hydration', 'finishers', 'skill', 'mobility', 'recovery', 'other'];
var RES27_SHIRTS = { tee: 'T-Shirt', tank: 'Ladies Tank' };
var RES27_SIZES = { tee: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'], tank: ['XS', 'S', 'M', 'L', 'XL', '2XL'] };
var RES27_PAYMENTS = { venmo: 'Venmo', zelle: 'Zelle', card: 'Credit Card' };
// What Payment says for a remote sign-up made at a gym with no way to pay (the first six-gym build,
// 11/23/2026, before every gym offered a card): the app tells those people "We'll email you how to
// pay", as it does for any Payment it can't show. New sign-ups never get it: since Kevin's "put a
// placeholder for the card link, we'll add one later" every gym offers a card (res27GymPayments_),
// so a remote sign-up always picks one of RES27_PAYMENTS.
var RES27_PAY_LATER = 'Email them how to pay';
var RES27_SLEEP_CHOICES = [7, 7.5, 8, 8.5, 9];
var RES27_FINISHER_CHOICES = [1, 2, 3];
/**
 * How much each yes counts toward the day's score out of 10 (Kevin, 11/10/2026): the four meals are
 * 1 each, workout and sleep are half of nutrition, the video and every other habit a quarter.
 * The day's score is 10 x (weight answered yes) / (weight on the list), so it's out of 10 however
 * many habits someone tracks. Bonus tasks add their points on top of the 10.
 */
var RES27_POINTS = { video: 1, meal: 1, workout: 2, sleep: 2, protein: 1, hydration: 1, finisher: 1, skill: 1, mobility: 1, recovery: 1, other: 1, bonus: 1 };
var RES27_MEALS = [['m1', 'Breakfast'], ['m2', 'Lunch'], ['m3', 'Dinner'], ['snack', 'Snacks or none']];

/**
 * The six Koda gyms (Kevin, 11/23/2026: the challenge runs at all six, with "a different color
 * scheme" for each and "overall leaderboards between gyms along with leaderboards within the
 * gyms"). One app, one backend, one sheet: the person's gym picks their colors, coaches, payment
 * details, videos and leaderboards. Ids are the code's keys; the Participants Gym column shows the
 * short name. assets/content.js has the same list (C.gyms, with the site's colors) and a test keeps
 * the two in step. Address and time zone are what setup puts on the Gyms tab, where Kevin keeps
 * each gym's details (a gym with no row there gets these).
 * `mail` is the email colors, since emails can't use the site's CSS. Text on a color is at least
 * 4.5:1 (WCAG), so the light brand colors (pink, green, teal) take black text, and headings on
 * white use a deeper shade of the brand. Iron View keeps the emails it has always sent, under its
 * old name line ("Koda CrossFit Iron View"); the others show their Name from the Gyms tab.
 */
var RES27_GYMS = [
  { id: 'ironview', name: 'Koda Iron View', short: 'Iron View', city: 'Louisville, CO', address: '740 S Pierce Ave #5, Louisville, CO 80027', tz: 'America/Denver',
    mail: { label: 'Koda CrossFit Iron View', head: '#0C1A2B', headSub: '#AEB7C2', bar: '', ink: '#0C1A2B', button: '#0C1A2B', buttonText: '#FFFFFF' } },
  { id: 'okc', name: 'Koda OKC', short: 'OKC', city: 'Oklahoma City, OK', address: '7016 Ozzy Ave, Oklahoma City, OK 73105', tz: 'America/Chicago',
    mail: { head: '#000000', headSub: '#C4A5F3', bar: '#7C28E6', ink: '#6A1FCB', button: '#7C28E6', buttonText: '#FFFFFF' } },
  { id: 'native', name: 'Koda Native', short: 'Native', city: 'Bethany, OK', address: '4310 N Martin Ave, Building A, Bethany, OK 73008', tz: 'America/Chicago',
    mail: { head: '#000000', headSub: '#FAB1D8', bar: '#FAB1D8', ink: '#4B6886', button: '#FAB1D8', buttonText: '#000000' } },
  { id: 'norman', name: 'Koda Norman', short: 'Norman', city: 'Norman, OK', address: '1210 McGee Dr, Norman, OK 73069', tz: 'America/Chicago',
    mail: { head: '#000000', headSub: '#F0A3A1', bar: '#891C1A', ink: '#891C1A', button: '#891C1A', buttonText: '#FFFFFF' } },
  { id: 'downtown', name: 'Koda Downtown', short: 'Downtown', city: 'Austin, TX', address: '', tz: 'America/Chicago',
    mail: { head: '#000000', headSub: '#00AD40', bar: '#00AD40', ink: '#007A2D', button: '#00AD40', buttonText: '#000000' } },
  { id: 'tulsa', name: 'Koda Tulsa', short: 'Tulsa', city: 'Tulsa, OK', address: '1141 S Frankfort Ave, Tulsa, OK 74104', tz: 'America/Chicago',
    mail: { head: '#141414', headSub: '#02AFAD', bar: '#02AFAD', ink: '#00706F', button: '#02AFAD', buttonText: '#000000' } },
];
// Before 11/23/2026 there was one gym, so everyone who signed up then (a blank Gym cell) is Iron View.
var RES27_DEFAULT_GYM = 'ironview';

var RES27_TABS = {
  participants: {
    name: 'Participants',
    headers: ['ID', 'Signed Up', 'First Name', 'Last Name', 'Email', 'Type', 'Gym', 'Payment', 'Paid', 'Shirt', 'Size', 'Goal',
      'Nutrition Plan', 'Plan Details', 'Daily Checklist', 'Coach Ranking', 'Coach', 'Team', 'Status', 'Points', 'Days Logged',
      'Last Seen', 'Welcome Email', 'Daily Email', 'Notes'],
    // A column added to a sheet that already has rows goes at the end, except these, which go next
    // to the column named (where Kevin looks for them).
    after: { 'Gym': 'Type', 'Daily Email': 'Welcome Email' },
    dates: ['Signed Up', 'Last Seen'],
    numbers: ['Days Logged'],
    decimals: ['Points'],
    widths: { 'ID': 80, 'First Name': 110, 'Last Name': 120, 'Email': 210, 'Gym': 90, 'Daily Checklist': 320, 'Plan Details': 200, 'Coach Ranking': 180, 'Welcome Email': 140, 'Daily Email': 100, 'Notes': 200 },
    hidden: [],
  },
  appdata: {
    name: 'App Data',
    headers: ['ID', 'Setup', 'History', 'Updated'],
    dates: ['Updated'],
    numbers: [],
    widths: { 'Setup': 360, 'History': 480 },
    hidden: [],
    hiddenTab: true,
  },
  accounts: {
    name: 'Accounts',
    headers: ['ID', 'Email', 'Password Hash', 'Salt', 'Rounds', 'Token Version', 'Failed Logins', 'Locked Until', 'Reset Code',
      'Reset Expires', 'Reset Tries', 'Last Login', 'Created'],
    dates: ['Locked Until', 'Reset Expires', 'Last Login', 'Created'],
    numbers: ['Rounds', 'Token Version', 'Failed Logins', 'Reset Tries'],
    widths: { 'Email': 210, 'Password Hash': 120, 'Salt': 90, 'Reset Code': 90 },
    hidden: [],
  },
  checkins: {
    name: 'Check-ins',
    headers: ['Key', 'ID', 'Name', 'Team', 'Gym', 'Date', 'Day', 'Done', 'Of', 'Score', 'Bonus', 'Points', 'Answers', 'Updated'],
    after: { 'Gym': 'Team' },
    dates: ['Updated'],
    numbers: ['Day', 'Done', 'Of', 'Bonus'],
    decimals: ['Score', 'Points'],
    widths: { 'Key': 150, 'Name': 150, 'Answers': 420 },
    hidden: ['Key'],
    retired: ['Max Points'], // v1.1, before the out-of-10 score
  },
  days: {
    name: 'Days',
    headers: ['Day', 'Date', 'Week', 'Week Theme', 'Title', 'Video URL', 'Category', 'About', 'Action Item', 'Bonus Task',
      'Bonus Points', 'Presenter', 'Notes (not shown)', '2026 Video (not shown)'],
    dates: [],
    numbers: ['Day', 'Week', 'Bonus Points'],
    widths: { 'Date': 110, 'Week Theme': 180, 'Title': 240, 'Video URL': 240, 'About': 320, 'Action Item': 280, 'Bonus Task': 220, 'Notes (not shown)': 240, '2026 Video (not shown)': 220 },
    hidden: [],
  },
  finishers: {
    name: 'Finishers',
    headers: ['Week', 'Name', 'Workout', 'Video URL'],
    dates: [],
    numbers: ['Week'],
    widths: { 'Name': 180, 'Workout': 420, 'Video URL': 240 },
    hidden: [],
  },
  settings: {
    name: 'Settings',
    headers: ['Setting', 'Value', 'What it does'],
    dates: [],
    numbers: [],
    widths: { 'Setting': 190, 'Value': 300, 'What it does': 460 },
    hidden: [],
  },
  // One row per gym (11/23/2026), keyed by the Gym column (the gym's id). Blank Venmo or Zelle: that
  // way to pay isn't offered at that gym (never another gym's). A card is offered at every gym
  // (Kevin: "put a placeholder for the card link, we'll add one later"): Card URL is where each gym's
  // checkout link goes, and until it's pasted in, card payers are told we'll email them a secure
  // link. Blank Remote Price or Contact Email: the one in Settings. Blank Coaches: that gym's sign-up
  // skips ranking coaches.
  gyms: {
    name: 'Gyms',
    headers: ['Gym', 'Name', 'City', 'Address', 'Time Zone', 'Contact Email', 'Coaches', 'Coach Emails', 'Venmo', 'Zelle', 'Card URL', 'Remote Price', 'Notes'],
    dates: [],
    numbers: ['Remote Price'],
    widths: { 'Gym': 90, 'Name': 150, 'City': 140, 'Address': 280, 'Time Zone': 140, 'Contact Email': 210, 'Coaches': 220, 'Coach Emails': 320, 'Venmo': 150, 'Zelle': 190, 'Card URL': 240, 'Notes': 240 },
    hidden: [],
  },
  questions: {
    name: 'Questions',
    headers: ['When', 'ID', 'Name', 'Email', 'Team', 'Coach', 'Sent To', 'Question', 'Emailed'],
    dates: ['When'],
    numbers: [],
    widths: { 'Name': 150, 'Email': 210, 'Sent To': 210, 'Question': 480 },
    hidden: [],
  },
  log: {
    name: 'Log',
    headers: ['When', 'Who', 'What', 'Detail'],
    dates: ['When'],
    numbers: [],
    widths: { 'Who': 200, 'What': 160, 'Detail': 480 },
    hidden: [],
  },
};

var RES27_SETTINGS_DEFAULTS = [
  ['program_name', 'Koda Resolutions 2027', 'The name at the top of the app'],
  ['start_date', '2027-01-18', 'Day 1 of the challenge, typed like 2027-01-18'],
  ['length_days', 42, 'How many days the challenge runs'],
  ['registration_open', true, 'FALSE stops new sign-ups (signing in keeps working)'],
  ['remote_price', 99, 'What a remote participant pays, in dollars, at any gym whose Remote Price is blank on the Gyms tab'],
  // Since 11/23/2026 each gym's payment details and coaches are on the Gyms tab. These five filled in
  // Iron View's row there when the tab was made; the app no longer reads them.
  ['venmo', '@kevin-schuetz-5', 'Not used since 11/23/2026: each gym’s Venmo is on the Gyms tab (this filled in Iron View’s row there once)'],
  ['zelle', 'kodaironview@gmail.com', 'Not used since 11/23/2026: each gym’s Zelle is on the Gyms tab (this filled in Iron View’s row there once)'],
  ['card_url', '', 'Not used since 11/23/2026: each gym’s card checkout link is on the Gyms tab (this filled in Iron View’s row there once)'],
  ['coaches', 'Kevin, Riley, Jamie, Maggie', 'Not used since 11/23/2026: each gym’s coaches are on the Gyms tab (this filled in Iron View’s row there once)'],
  ['contact_email', 'kodaironview@gmail.com', 'Where participants send questions (also the reply-to on emails) for any gym whose Contact Email is blank on the Gyms tab'],
  ['site_url', 'https://koda-crossfit.github.io/resolutions/', 'The app link used in emails'],
  ['shirt_changes_until', '', 'Last day people can change their shirt style or size, e.g. 2026-12-15 (blank = any time)'],
  ['cookbook_url', 'https://docs.google.com/document/d/1GYO72pgnYteRCpjKJSa0rvk4ZRN1DRvGElrm0lFWy6o/edit?usp=sharing', 'The Koda Cookbook link on the Nutrition tab'],
  ['welcome_email', true, 'TRUE sends a welcome email after sign-up'],
  ['notify_email', '', 'Optional: also email this address about every new sign-up'],
  ['coach_emails', '', 'Not used since 11/23/2026: each gym’s coach emails are on the Gyms tab (Coach Emails, same format, like  Riley: riley@example.com). This filled in Iron View’s row there once'],
  ['show_upcoming_titles', false, 'TRUE shows the titles of videos that have not unlocked yet'],
  ['preview_today', '', 'Test accounts (Type = Test on Participants) see this date as today, e.g. 2027-01-21. Blank = the real date. Ignored while a beta test is set (beta_start), so beta testers always see the real date'],
  ['beta_start', '', 'Beta test: Day 1 of a practice run, e.g. 2026-11-09. Everyone who signs up through the beta link (the app link with ?beta=1 on the end), or anyone at all while beta_everyone is TRUE, becomes a Test account, and every Test account goes through Days 1, 2, 3… on the real dates from here. Blank = no beta test'],
  ['beta_days', 7, 'How many days the beta test runs (1 to 42)'],
  ['beta_everyone', false, 'TRUE: while the beta test is open, everyone who signs up joins it as a Test account, with or without the beta link (the sign-up page shows the beta to everyone). FALSE: only the beta link does. Once the beta is over, sign-ups are real again either way'],
  // The daily email (Kevin, 11/23/2026): "an automated email each day for each person with the
  // details of that day and a link to the website to log the previous days scores", at 3 AM.
  ['daily_email', false, 'TRUE sends the daily email every morning at email_hour in each gym’s own time zone: the day’s video, action and bonus, a link to log yesterday, and an Overdue note for anyone who hasn’t logged the day two days before. It also needs email_provider, email_from, the API key (Script Properties RES27_EMAIL_API_KEY) and the hourly trigger (node dev/live.js email-triggers on). FALSE: nothing is sent'],
  ['email_provider', 'off', 'Who sends the emails: resend or brevo (their API key goes in the Apps Script project’s Script Properties as RES27_EMAIL_API_KEY, never in this sheet), mailapp (tests only: Kevin’s Gmail sends about 100 a day in all, shared with Koda’s other pages), or off. With resend or brevo, the welcome, password-code and question emails go through it too, with Gmail as the fallback'],
  ['email_from', '', 'Who the emails come from with resend or brevo, e.g. Koda Resolutions <resolutions@kodacrossfitironview.com> (that domain has to be verified with the provider). Required for resend and brevo'],
  ['email_hour', 3, 'The hour the daily email goes out, in each gym’s own time zone (0 to 11; 3 = 3 AM): the first hourly run after that hour sends that gym’s (with 3, between 3 and 4 AM), and a missed run is made up by the next one, until noon. Nothing else needs changing after it'],
];
// edit_days_back: replaced 11/11/2026 by the weekly window (a week stays open until midnight the Monday after it).
var RES27_RETIRED_SETTINGS = ['venmo_url', 'edit_days_back'];

var RES27_REQ_ = {};

/* ================================================================ entry points ==== */

function res27Post(data) {
  RES27_REQ_ = {};
  var out;
  try {
    out = res27Route_(data || {});
  } catch (err) {
    out = res27ErrorOut_(err, data);
  }
  RES27_REQ_ = {};
  return res27Json_(out);
}

function res27Get(action, e) {
  RES27_REQ_ = {};
  var out;
  try {
    if (action === 'res27Health') {
      out = { ok: true, version: RES27_VERSION, ready: !!res27Prop_(RES27_SHEET_PROP) };
    } else {
      out = { ok: false, error: 'Unknown request.', code: 'unknown' };
    }
  } catch (err) {
    out = res27ErrorOut_(err, { action: action });
  }
  RES27_REQ_ = {};
  return res27Json_(out);
}

function res27Json_(out) {
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function res27Route_(d) {
  var action = String(d.action || '');
  var open = {
    config: res27ConfigAction_,
    emailStatus: res27EmailStatus_,
    register: res27Register_,
    login: res27Login_,
    resetStart: res27ResetStart_,
    resetFinish: res27ResetFinish_,
    emailOff: res27EmailOff_,
  };
  var signedIn = {
    me: res27Me_,
    save: res27Save_,
    setup: res27UpdateSetup_,
    password: res27ChangePassword_,
    signoutAll: res27SignOutAll_,
    leaderboard: res27Leaderboard_,
    ask: res27Ask_,
  };
  var admin = {
    adminSetup: res27AdminSetup_,
    adminSeedDays: res27AdminSeedDays_,
    adminSummary: res27AdminSummary_,
    adminSetType: res27AdminSetType_,
    adminPurgeTests: res27AdminPurgeTests_,
    adminSetGym: res27AdminSetGym_,
    adminEmailPreview: res27AdminEmailPreview_,
    adminEmailSend: res27AdminEmailSend_,
    adminEmailTriggers: res27AdminEmailTriggers_,
  };
  if (open[action]) return open[action](d);
  if (signedIn[action]) return signedIn[action](d, res27Auth_(d.token));
  if (admin[action]) {
    if (!res27IsAdmin_(d.key)) res27Fail_('Not allowed.', 'forbidden');
    return admin[action](d);
  }
  res27Fail_('Unknown request.', 'unknown');
}

/* ================================================================ errors, utils ==== */

function res27Fail_(message, code) {
  var err = new Error(message);
  err.res27 = true;
  err.code = code || 'bad_request';
  throw err;
}

function res27ErrorOut_(err, data) {
  if (err && err.res27) return { ok: false, error: err.message, code: err.code };
  var detail = String((err && err.stack) || err);
  try {
    console.error('res27 ' + ((data && data.action) || '') + ': ' + detail);
  } catch (ignore) {}
  try {
    res27Log_('(server)', 'Error in ' + ((data && data.action) || '?'), detail.slice(0, 1500));
  } catch (ignore) {}
  if (/lock timeout|holding the lock/i.test(detail)) {
    return { ok: false, error: 'Lots of people are saving right now. Please try again in a few seconds.', code: 'busy' };
  }
  return { ok: false, error: 'Something went wrong on our end. Please try again in a minute.', code: 'server' };
}

function res27Now_() {
  return typeof __NOW__ !== 'undefined' && __NOW__ ? new Date(__NOW__).getTime() : Date.now();
}

function res27Prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function res27IsDate_(value) {
  return Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime());
}

function res27Pad_(n) {
  return (n < 10 ? '0' : '') + n;
}

function res27KeyToUtc_(key) {
  var p = String(key).split('-');
  return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function res27UtcToKey_(ms) {
  var d = new Date(ms);
  return d.getUTCFullYear() + '-' + res27Pad_(d.getUTCMonth() + 1) + '-' + res27Pad_(d.getUTCDate());
}

function res27AddDays_(key, n) {
  return res27UtcToKey_(res27KeyToUtc_(key) + n * 86400000);
}

function res27DiffDays_(from, to) {
  return Math.round((res27KeyToUtc_(to) - res27KeyToUtc_(from)) / 86400000);
}

/** True for a real calendar day written yyyy-MM-dd (so 2027-01-32 and 2027-02-00 are not). */
function res27IsDayKey_(key) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(key)) && res27UtcToKey_(res27KeyToUtc_(key)) === String(key);
}

/** A yyyy-MM-dd key from a Date, a yyyy-MM-dd string, or a m/d/yyyy string. Null if it isn't a real day. */
function res27ParseDateKey_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (res27IsDate_(value)) return Utilities.formatDate(value, RES27_TZ, 'yyyy-MM-dd');
  var text = String(value).trim();
  var key = null;
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) key = m[1] + '-' + res27Pad_(Number(m[2])) + '-' + res27Pad_(Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (m) key = m[3] + '-' + res27Pad_(Number(m[1])) + '-' + res27Pad_(Number(m[2]));
  return key && res27IsDayKey_(key) ? key : null;
}

function res27TodayKey_() {
  return Utilities.formatDate(new Date(res27Now_()), RES27_TZ, 'yyyy-MM-dd');
}

function res27Time_(value) {
  if (res27IsDate_(value)) return value.getTime();
  if (typeof value === 'number' && value > 1e11) return value;
  if (value) {
    var t = new Date(value).getTime();
    if (!isNaN(t)) return t;
  }
  return 0;
}

function res27Truthy_(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  return /^(true|yes|y|1|on|x|✓|paid)$/i.test(String(value).trim());
}

function res27CleanText_(value, max) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 80);
}

/**
 * A new email address (a sign-up, the Gyms tab, Settings), lower-cased, or '' when it isn't one an
 * email service will take. The 11/23/2026 review found "jess@gmail.com." and "john@gmail.com>"
 * getting in, and one such address can make the provider turn down a whole gym's daily email. So:
 * one @, printable ASCII only, none of , ; : < > ( ) [ ] \ " (they mean something in an address
 * line), no dot at the start or end of the name or two in a row, and a domain of letters, digits
 * and hyphens that ends in letters (.com, not .c0m).
 */
function res27CleanEmail_(value) {
  var email = String(value || '').trim().toLowerCase();
  if (email.length > 120) return '';
  if (!/^[^@]+@[^@]+$/.test(email) || /[^\x21-\x7e]|[,;:<>()[\]\\"]/.test(email)) return '';
  var at = email.indexOf('@');
  if (/^\.|\.\.|\.$/.test(email.slice(0, at))) return '';
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(email.slice(at + 1)) ? email : '';
}

/**
 * An email typed to find an account or row that's already there (sign-in, a password reset, the
 * admin commands): trimmed and lower-cased, with the looser check from before 11/23/2026, so
 * someone whose address got in then can still sign in, and Kevin can still fix their row.
 */
function res27LookupEmail_(value) {
  var email = String(value || '').trim().toLowerCase();
  if (email.length > 120) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : '';
}

/** Text that Sheets would read as a formula gets a leading apostrophe, so it stays text. */
function res27SafeCell_(value) {
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) return "'" + value;
  return value;
}

function res27ParseJson_(text, fallback) {
  if (!text) return fallback;
  try {
    var value = JSON.parse(String(text));
    return value && typeof value === 'object' ? value : fallback;
  } catch (e) {
    return fallback;
  }
}

function res27Hex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function res27RandomHex_(count) {
  var out = '';
  while (out.length < count * 2) out += Utilities.getUuid().replace(/-/g, '');
  return out.slice(0, count * 2);
}

function res27Bytes_(text) {
  return Utilities.newBlob(String(text)).getBytes();
}

/** PBKDF2-HMAC-SHA256, one 32-byte block, as hex. An empty password never matches anything. */
function res27HashPassword_(password, saltHex, rounds) {
  if (!password) return '';
  var key = res27Bytes_(password);
  var salt = res27Bytes_(saltHex);
  var u = Utilities.computeHmacSha256Signature(salt.concat([0, 0, 0, 1]), key);
  var out = u.slice();
  for (var i = 1; i < rounds; i++) {
    u = Utilities.computeHmacSha256Signature(u, key);
    for (var j = 0; j < out.length; j++) out[j] = out[j] ^ u[j];
  }
  return res27Hex_(out);
}

function res27Secret_() {
  // Kept for the request: the daily email signs one "stop" link per person.
  if (RES27_REQ_.secret) return RES27_REQ_.secret;
  var secret = res27Prop_(RES27_SECRET_PROP);
  if (!secret) {
    secret = res27RandomHex_(32);
    PropertiesService.getScriptProperties().setProperty(RES27_SECRET_PROP, secret);
  }
  RES27_REQ_.secret = secret;
  return secret;
}

function res27Sign_(payload) {
  var sig = Utilities.computeHmacSha256Signature(res27Bytes_(payload), res27Bytes_(res27Secret_()));
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}

function res27IssueToken_(id, version) {
  var payload = id + '.' + (Number(version) || 1) + '.' + res27Now_().toString(36);
  return payload + '.' + res27Sign_(payload);
}

function res27NewId_() {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (var attempt = 0; attempt < 20; attempt++) {
    var hex = res27RandomHex_(6);
    var id = 'R';
    for (var i = 0; i < 6; i++) id += alphabet.charAt(parseInt(hex.substr(i * 2, 2), 16) % alphabet.length);
    if (!res27FindRow_('accounts', 'ID', id)) return id;
  }
  throw new Error('Could not make a new participant id');
}

function res27RandomCode_() {
  var n = parseInt(res27RandomHex_(4), 16) % 1000000;
  return ('000000' + n).slice(-6);
}

function res27IsAdmin_(key) {
  key = String(key || '');
  if (key.length < 6) return false;
  var own = res27Prop_(RES27_ADMIN_PROP);
  if (own && key === own) return true;
  if (typeof sim1025Authorized === 'function') {
    try {
      return !!sim1025Authorized(key);
    } catch (e) {
      return false;
    }
  }
  return false;
}

/** Adds one to a CacheService counter and returns the new count (good enough for rate limits). */
function res27Bump_(key, seconds) {
  var cache = CacheService.getScriptCache();
  var n = (parseInt(cache.get(key), 10) || 0) + 1;
  cache.put(key, String(n), seconds);
  return n;
}

function res27Count_(key) {
  return parseInt(CacheService.getScriptCache().get(key), 10) || 0;
}

/**
 * Uses one of the hour's sign-in and reset answers, and says whether one was left (review,
 * 11/24/2026). Sign-in and the password reset told anyone whether an email has an account, with no
 * limit, so a list of addresses (a gym's members) could be run through them to see who joined. Now
 * every answer they give after the checks that are the same for everyone (blank or malformed input,
 * resets busy, can't send) uses one of RES27_LOOKUPS_PER_HOUR, an email with an account or not,
 * except a sign-in or a new password; past them, an email with none gets the answer one with an
 * account would, and failed answers all take RES27_EVEN_ANSWER_MS (res27EvenOut_). With the
 * sign-up hint's own allowance, that slows a list down to about 240 addresses an hour; it doesn't
 * stop one outright. An account still shows itself to someone who locks it out, has its owner sent a
 * code, or signs up with its email while sign-ups are open (a new email makes a real sign-up). The
 * Log gets one row the hour they run out, so a "my code never came" can be explained.
 */
function res27LookupAllowed_() {
  var n = res27Bump_('res27:lk:' + res27HourKey_(), 3700);
  if (n === RES27_LOOKUPS_PER_HOUR + 1) {
    try {
      res27Log_('(sign-in)', 'Lookup limit reached', 'Sign-in and password-reset answers used up this hour (' + RES27_LOOKUPS_PER_HOUR + '): until the hour ends, an email with no account is answered as if it had one. A mistyped email then hears "That password doesn’t match" or waits for a code that never comes.');
    } catch (ignore) {}
  }
  return n <= RES27_LOOKUPS_PER_HOUR;
}

/** This hour in Mountain time (the rate-limit counters' key). */
function res27HourKey_() {
  return Utilities.formatDate(new Date(res27Now_()), RES27_TZ, 'yyyy-MM-dd-HH');
}

// The answers sign-in and the reset code give after looking the email up (res27EvenOut_).
var RES27_EVENED_CODES = ['no_account', 'bad_password', 'locked', 'too_many', 'expired', 'bad_code'];

/**
 * Runs a sign-in or a reset code (`work`) and holds any answer it gives after looking the email up
 * until RES27_EVEN_ANSWER_MS after `t0`, writes included, so how long it took says nothing about
 * whether the email has an account (second review, 11/24/2026). Successes aren't held.
 */
function res27EvenOut_(t0, work) {
  try {
    return work();
  } catch (err) {
    if (err && err.res27 && RES27_EVENED_CODES.indexOf(err.code) >= 0) {
      try { SpreadsheetApp.flush(); } catch (ignore) {}
      var wait = t0 + RES27_EVEN_ANSWER_MS - Date.now();
      if (wait > 0) Utilities.sleep(Math.min(wait, RES27_EVEN_ANSWER_MS));
      // Shows in the Apps Script project's Executions: if it ever does, raise RES27_EVEN_ANSWER_MS.
      else console.warn('res27 even-out overran by ' + (-wait) + ' ms (' + err.code + ')');
    }
    throw err;
  }
}

/* ================================================================ the sheet ==== */

function res27Book_() {
  if (RES27_REQ_.book) return RES27_REQ_.book;
  var id = res27Prop_(RES27_SHEET_PROP);
  if (!id) res27Fail_('The Resolutions app is not set up yet. Please check back soon.', 'not_setup');
  RES27_REQ_.book = SpreadsheetApp.openById(id);
  return RES27_REQ_.book;
}

function res27Sheet_(tabKey) {
  RES27_REQ_.sheets = RES27_REQ_.sheets || {};
  if (RES27_REQ_.sheets[tabKey]) return RES27_REQ_.sheets[tabKey];
  var sheet = res27Book_().getSheetByName(RES27_TABS[tabKey].name);
  if (!sheet) throw new Error('Missing tab: ' + RES27_TABS[tabKey].name);
  RES27_REQ_.sheets[tabKey] = sheet;
  return sheet;
}

function res27Headers_(tabKey) {
  RES27_REQ_.headers = RES27_REQ_.headers || {};
  if (RES27_REQ_.headers[tabKey]) return RES27_REQ_.headers[tabKey];
  var sheet = res27Sheet_(tabKey);
  var lastColumn = Math.max(1, sheet.getLastColumn());
  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (h) {
    return String(h).trim();
  });
  RES27_REQ_.headers[tabKey] = headers;
  return headers;
}

function res27Col_(tabKey, header) {
  var col = res27Headers_(tabKey).indexOf(header) + 1;
  if (!col) throw new Error('Missing column "' + header + '" on ' + RES27_TABS[tabKey].name);
  return col;
}

function res27RowObject_(headers, values, rowNumber) {
  var row = { _row: rowNumber };
  headers.forEach(function (h, i) {
    if (h) row[h] = values[i];
  });
  return row;
}

/**
 * The first row whose `header` cell matches `value` (trimmed, any case), or null. The whole row is
 * read after the match, so it re-checks that cell and looks again if the sheet moved in between.
 */
function res27FindRow_(tabKey, header, value) {
  var want = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  if (!want) return null;
  var sheet = res27Sheet_(tabKey);
  var headers = res27Headers_(tabKey);
  var col = res27Col_(tabKey, header);
  for (var attempt = 0; attempt < 3; attempt++) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;
    var column = sheet.getRange(2, col, lastRow - 1, 1).getValues();
    var at = -1;
    for (var i = 0; i < column.length; i++) {
      if (String(column[i][0]).trim().toLowerCase() === want) {
        at = i;
        break;
      }
    }
    if (at < 0) return null;
    var rowNumber = at + 2;
    var row = res27RowObject_(headers, sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0], rowNumber);
    if (String(row[header]).trim().toLowerCase() === want) return row;
  }
  throw new Error('Rows on ' + RES27_TABS[tabKey].name + ' kept moving while looking for ' + value);
}

/** Before writing to a row by number: make sure it still holds what it held when it was read. */
function res27AssertRow_(tabKey, rowNumber, header, value) {
  var cell = res27Sheet_(tabKey).getRange(rowNumber, res27Col_(tabKey, header)).getValue();
  if (String(cell).trim().toLowerCase() !== String(value).trim().toLowerCase()) {
    res27Fail_('The sheet was just rearranged. Please try again.', 'busy');
  }
}

function res27AllRows_(tabKey) {
  var sheet = res27Sheet_(tabKey);
  var headers = res27Headers_(tabKey);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function (cells, i) {
    return res27RowObject_(headers, cells, i + 2);
  });
}

function res27AppendRow_(tabKey, obj) {
  var sheet = res27Sheet_(tabKey);
  var headers = res27Headers_(tabKey);
  var row = headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(obj, h) ? res27SafeCell_(obj[h]) : '';
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

/** Writes only the named cells of one row, so nothing else on it (like Kevin's Team) is touched. */
function res27UpdateRow_(tabKey, rowNumber, obj) {
  var sheet = res27Sheet_(tabKey);
  Object.keys(obj).forEach(function (h) {
    sheet.getRange(rowNumber, res27Col_(tabKey, h)).setValue(res27SafeCell_(obj[h]));
  });
}

function res27Log_(who, what, detail) {
  var sheet = res27Sheet_('log');
  sheet.appendRow([new Date(res27Now_()), res27SafeCell_(String(who || '')), res27SafeCell_(String(what || '')), res27SafeCell_(String(detail || '').slice(0, 2000))]);
}

/* ================================================================ settings & content ==== */

function res27Settings_() {
  if (RES27_REQ_.settings) return RES27_REQ_.settings;
  var cache = CacheService.getScriptCache();
  var hit = cache.get('res27:settings');
  if (hit) {
    RES27_REQ_.settings = JSON.parse(hit);
    return RES27_REQ_.settings;
  }
  var out = {};
  RES27_SETTINGS_DEFAULTS.forEach(function (r) {
    out[r[0]] = r[1];
  });
  var values = res27Sheet_('settings').getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    var key = String(values[i][0]).trim();
    if (!key) continue;
    var value = values[i][1];
    out[key] = res27IsDate_(value) ? Utilities.formatDate(value, RES27_TZ, 'yyyy-MM-dd') : value;
  }
  cache.put('res27:settings', JSON.stringify(out), 60);
  RES27_REQ_.settings = out;
  return out;
}

/** A comma-separated coach list (a gym's Coaches cell) as names, in the order typed. */
function res27Coaches_(text) {
  return String(text || '')
    .split(',')
    .map(function (c) {
      return res27CleanText_(c, 40);
    })
    .filter(Boolean);
}

/* ---------------------------------------------------------------------------- gyms ---- */

function res27Alnum_(value) {
  return String(value === null || value === undefined ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * A gym's id from what someone typed (Participants Gym column, live.js, a Days video label): the
 * id, the short name or the full name, any case or spacing ("okc", "OKC", "Koda OKC"; "Iron View",
 * "ironview"; "Koda CrossFit Tulsa" too). '' for blank or for anything else.
 */
function res27GymId_(value) {
  var key = res27Alnum_(value);
  if (!key) return '';
  var bare = key.replace(/^koda(?:crossfit)?/, '');
  for (var i = 0; i < RES27_GYMS.length; i++) {
    var g = RES27_GYMS[i];
    var names = [res27Alnum_(g.id), res27Alnum_(g.short), res27Alnum_(g.name)];
    if (names.indexOf(key) >= 0 || (bare && names.indexOf(bare) >= 0)) return g.id;
  }
  return '';
}

function res27GymDef_(id) {
  for (var i = 0; i < RES27_GYMS.length; i++) if (RES27_GYMS[i].id === id) return RES27_GYMS[i];
  return RES27_GYMS[0];
}

/** A price typed as 99, "99" or "$99". 0 when blank or not a price. */
function res27Price_(value) {
  var n = Number(String(value === null || value === undefined ? '' : value).replace(/[^0-9.]/g, ''));
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

// The time zones a gym's row can name. Since the daily email runs every hour and goes out once it's
// past email_hour in the gym's own zone, a zone Apps Script quietly read as GMT (a typo like
// "America/Austin" may not throw there) would send each day's email the evening before. So only
// these are taken; anything else is the gym's own zone from RES27_GYMS.
var RES27_TIME_ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];

/** A time zone typed on the Gyms tab, like America/Chicago (any case). '' if it isn't one of RES27_TIME_ZONES. */
function res27ValidTz_(tz) {
  var want = String(tz || '').trim().toLowerCase();
  for (var i = 0; i < RES27_TIME_ZONES.length; i++) {
    if (RES27_TIME_ZONES[i].toLowerCase() === want) return RES27_TIME_ZONES[i];
  }
  return '';
}

/**
 * What setup puts on a gym's row (and what a gym with no row gets): name, city, address and time
 * zone. Iron View's row also takes today's details from Settings, where they lived when Iron View
 * was the only gym. The other gyms start with no payment details and no coaches: Kevin fills them
 * in. Nothing falls back to Iron View's money.
 */
function res27GymSeed_(g, cfg) {
  var iv = g.id === RES27_DEFAULT_GYM;
  var from = function (key) {
    return iv && cfg[key] !== null && cfg[key] !== undefined ? cfg[key] : '';
  };
  return {
    'Gym': g.id,
    'Name': g.name,
    'City': g.city,
    'Address': g.address,
    'Time Zone': g.tz,
    'Contact Email': from('contact_email'),
    'Coaches': from('coaches'),
    'Coach Emails': from('coach_emails'),
    'Venmo': from('venmo'),
    'Zelle': from('zelle'),
    'Card URL': from('card_url'),
    'Remote Price': from('remote_price'),
    'Notes': '',
  };
}

/** The Gyms tab's rows by gym id, as text (cached a minute, like Settings). {} before setup makes the tab. */
function res27GymRows_() {
  if (RES27_REQ_.gymRows) return RES27_REQ_.gymRows;
  var cache = CacheService.getScriptCache();
  var hit = cache.get('res27:gyms');
  var out = hit ? JSON.parse(hit) : null;
  if (!out) {
    out = {};
    if (res27Book_().getSheetByName(RES27_TABS.gyms.name)) {
      res27AllRows_('gyms').forEach(function (r) {
        var id = res27GymId_(r['Gym']);
        if (!id || out[id]) return; // the first row for a gym wins
        var o = {};
        RES27_TABS.gyms.headers.forEach(function (h) {
          var v = r[h];
          // The tab is plain text, and a plain-text cell may keep as a real character the
          // apostrophe res27SafeCell_ puts before '@kevin-schuetz-5 (or one typed by hand), which
          // would break the Venmo link. Taken off here, so it's right either way.
          o[h] = v === null || v === undefined || res27IsDate_(v) ? '' : String(v).trim().replace(/^'(?=[=+\-@])/, '');
        });
        out[id] = o;
      });
    }
    try {
      cache.put('res27:gyms', JSON.stringify(out), 60);
    } catch (e) {}
  }
  RES27_REQ_.gymRows = out;
  return out;
}

/**
 * Every gym with its details from the Gyms tab, in RES27_GYMS order: { list, byId }. Per gym and no
 * fallback to another gym for money: a blank Venmo or Zelle means that way to pay isn't offered
 * there, and a blank Card URL means the card (offered at every gym) has no checkout link yet, so
 * card payers there are emailed a secure link. A blank Remote Price or Contact Email is the one in
 * Settings; a blank Name, City or Time Zone is the gym's own from RES27_GYMS. coachEmails stays on
 * the server.
 */
function res27Gyms_() {
  if (RES27_REQ_.gyms) return RES27_REQ_.gyms;
  var cfg = res27Settings_();
  var rows = res27GymRows_();
  var byId = {};
  var list = RES27_GYMS.map(function (g) {
    var r = rows[g.id] || res27GymSeed_(g, cfg);
    var cell = function (h) {
      var v = r[h];
      return v === null || v === undefined ? '' : String(v).trim();
    };
    var gym = {
      id: g.id,
      short: g.short,
      name: res27CleanText_(cell('Name'), 60) || g.name,
      city: res27CleanText_(cell('City'), 60) || g.city,
      address: res27CleanText_(cell('Address'), 160),
      tz: res27ValidTz_(cell('Time Zone')) || g.tz,
      contactEmail: cell('Contact Email') || String(cfg.contact_email || ''),
      coaches: res27Coaches_(cell('Coaches')),
      coachEmails: cell('Coach Emails'),
      venmo: cell('Venmo'),
      zelle: cell('Zelle'),
      cardUrl: cell('Card URL'),
      remotePrice: res27Price_(cell('Remote Price')) || res27Price_(cfg.remote_price) || 99,
      mail: g.mail,
    };
    byId[g.id] = gym;
    return gym;
  });
  RES27_REQ_.gyms = { list: list, byId: byId };
  return RES27_REQ_.gyms;
}

/** One gym's details (Iron View for an unknown id). */
function res27Gym_(id) {
  var all = res27Gyms_();
  return all.byId[id] || all.byId[RES27_DEFAULT_GYM];
}

/**
 * The ways to pay a gym offers, in the order the app shows them: its own Venmo and Zelle when it has
 * them, then a card at every gym. Kevin, 11/23/2026: "put a placeholder for the card link, we'll add
 * one later". With the gym's Card URL, card payers get a "Pay $99 by card" button; until then
 * they're told we'll email them a secure link, as Iron View's card payers were before it had one.
 */
function res27GymPayments_(gym) {
  var out = [];
  if (gym.venmo) out.push('venmo');
  if (gym.zelle) out.push('zelle');
  out.push('card');
  return out;
}

/** A coach ranking fits a gym when every coach in it is one of that gym's. */
function res27RankingFits_(coaches, gym) {
  return (coaches || []).every(function (c) {
    return gym.coaches.indexOf(c) >= 0;
  });
}

/**
 * A link into the app from an email: site_url, with ?gym=<id> for every gym but Iron View (the
 * app's own look), so the page opens in the gym's colors even before signing in, then the #/route.
 */
function res27SiteLink_(cfg, gymId, route, query) {
  var site = String(cfg.site_url || '');
  if (!site) return '';
  var q = [];
  if (query) q.push(query);
  if (gymId && gymId !== RES27_DEFAULT_GYM) q.push('gym=' + encodeURIComponent(gymId));
  if (q.length) site += (site.indexOf('?') >= 0 ? '&' : '?') + q.join('&');
  return site + (route || '');
}

/** The gym's Venmo link, as on the Hyrox pages: opens Venmo with the amount and a note filled in. */
function res27VenmoPayUrl_(gym, note) {
  var handle = String(gym.venmo || '').trim().replace(/^@/, '');
  if (!handle) return '';
  return 'https://venmo.com/?txn=pay&audience=private&recipients=' + encodeURIComponent(handle) +
    '&amount=' + encodeURIComponent(gym.remotePrice || 99) + '&note=' + encodeURIComponent(note || 'Koda Resolutions 2027');
}

/** What the app may know about a gym (never its coaches' email addresses). */
function res27PublicGym_(g) {
  return {
    id: g.id,
    name: g.name,
    short: g.short,
    city: g.city,
    address: g.address,
    coaches: g.coaches.slice(),
    venmo: g.venmo,
    zelle: g.zelle,
    cardUrl: g.cardUrl,
    remotePrice: g.remotePrice,
    contactEmail: g.contactEmail,
  };
}

function res27PublicConfig_(cfg) {
  var program = res27Program_(cfg, null, null);
  var beta = res27BetaOpen_(cfg);
  var gyms = res27Gyms_();
  var iv = gyms.byId[RES27_DEFAULT_GYM];
  return {
    programName: String(cfg.program_name || 'Koda Resolutions 2027'),
    startDate: program.start,
    endDate: program.end,
    lengthDays: program.length,
    registrationOpen: res27Truthy_(cfg.registration_open),
    // Each gym's own details. The six keys after it are Iron View's, as before there were gyms, so
    // a page cached from before 11/23/2026 still works.
    gyms: gyms.list.map(res27PublicGym_),
    remotePrice: iv.remotePrice,
    venmo: iv.venmo,
    zelle: iv.zelle,
    cardUrl: iv.cardUrl,
    coaches: iv.coaches.slice(),
    contactEmail: iv.contactEmail,
    siteUrl: String(cfg.site_url || ''),
    cookbookUrl: String(cfg.cookbook_url || ''),
    shirtChangesUntil: res27ParseDateKey_(cfg.shirt_changes_until) || '',
    sizes: RES27_SIZES,
    sleepChoices: RES27_SLEEP_CHOICES,
    finisherChoices: RES27_FINISHER_CHOICES,
    points: RES27_POINTS,
    // The beta test's dates, for the beta link's landing page (null when there's no beta). With
    // everyone (beta_everyone), every sign-up joins it, so the landing page shows it to everyone.
    beta: beta ? { start: beta.start, end: res27AddDays_(beta.start, beta.length - 1), days: beta.length, everyone: res27Truthy_(cfg.beta_everyone) } : null,
  };
}

/**
 * The beta test from Settings: a practice run that Test accounts go through on the real dates,
 * Day 1 on beta_start. Null when beta_start is blank (or isn't a date).
 */
function res27Beta_(cfg) {
  var start = res27ParseDateKey_(cfg.beta_start);
  if (!start) return null;
  return { start: start, length: Math.max(1, Math.min(42, parseInt(cfg.beta_days, 10) || 7)) };
}

/**
 * The beta test while people can still join it, through its last day. After that the beta link
 * signs people up for the real challenge, even if beta_start is never cleared (Test accounts
 * keep their beta calendar until it is).
 */
function res27BetaOpen_(cfg) {
  var beta = res27Beta_(cfg);
  return beta && res27TodayKey_() <= res27AddDays_(beta.start, beta.length - 1) ? beta : null;
}

/**
 * The 2026 video a day's plan reuses, from "2026 Video (not shown)": a YouTube link, or the video
 * id at the start of the cell ("AbCdEfGhIjK 'Day 1- 2026…' - re-record…"). Only the beta shows it.
 */
function res27StandInId_(cell) {
  var text = String(cell || '').trim();
  var m = /^([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/.exec(text);
  return res27YouTubeId_(text) || (m ? m[1] : '');
}

/** Day content keyed by day number, from the Days tab (cached a minute). */
function res27DaysContent_() {
  if (RES27_REQ_.days) return RES27_REQ_.days;
  var cache = CacheService.getScriptCache();
  var hit = cache.get('res27:days');
  if (hit) {
    RES27_REQ_.days = JSON.parse(hit);
    return RES27_REQ_.days;
  }
  var out = {};
  res27AllRows_('days').forEach(function (r) {
    var n = parseInt(r['Day'], 10);
    if (!n) return;
    out[n] = {
      week: parseInt(r['Week'], 10) || Math.ceil(n / 7),
      theme: res27CleanText_(r['Week Theme'], 80),
      title: res27CleanText_(r['Title'], 120),
      video: String(r['Video URL'] || '').trim().slice(0, 2000),
      category: res27CleanText_(r['Category'], 60),
      about: String(r['About'] || '').trim().slice(0, 1200),
      action: String(r['Action Item'] || '').trim().slice(0, 600),
      bonus: res27CleanText_(r['Bonus Task'], 160),
      bonusPoints: Math.max(0, Math.min(20, parseInt(r['Bonus Points'], 10) || RES27_POINTS.bonus)),
      presenter: res27CleanText_(r['Presenter'], 60),
      standIn: res27StandInId_(r['2026 Video (not shown)']),
    };
  });
  try {
    cache.put('res27:days', JSON.stringify(out), 60);
  } catch (e) {
    /* too big for the cache: fine, it's read each request */
  }
  RES27_REQ_.days = out;
  return out;
}

/**
 * One or more videos from the Video URL cell: a link per line, optionally "Label: link" or
 * "Label | link". Six at most, unless `all` (res27VideosFor_ picks a gym's lines out of them first).
 */
function res27ParseVideos_(cell, all) {
  var list = String(cell || '')
    .split(/\n+/)
    .map(function (line) {
      line = line.trim();
      if (!line) return null;
      var label = '';
      var url = line;
      var m = /^(.{1,60}?)\s*(?:\||:)\s*(https?:\/\/\S+)$/.exec(line);
      if (m) {
        label = m[1].trim();
        url = m[2].trim();
      }
      if (!/^https?:\/\//i.test(url)) return null;
      return { label: label, url: url, youtube: res27YouTubeId_(url) };
    })
    .filter(Boolean);
  return all ? list.slice(0, 40) : list.slice(0, 6);
}

/**
 * A day's videos for one gym. Kevin, 11/23/2026: same videos for all gyms, but they "might have
 * some slightly different ones". A line whose label names a gym ("OKC: link", "Koda Tulsa | link",
 * "OKC Fat Loss: link", "OKC, Tulsa: link") belongs to the gyms it names only: for their people it
 * replaces the day's shared lines (unlabeled and goal versions), keeping the rest of its label
 * ("Fat Loss") as its own version, and nobody else sees it. A gym with no line of its own gets the
 * shared ones. (Before the review a label had to be a gym's name and nothing else, so "OKC Fat
 * Loss" reached every gym.)
 */
function res27VideosFor_(cell, gymId) {
  var mine = gymId || RES27_DEFAULT_GYM;
  var own = [];
  var shared = [];
  res27ParseVideos_(cell, true).forEach(function (v) {
    var named = v.label ? res27VideoLabel_(v.label) : null;
    if (!named || !named.gyms.length) shared.push(v);
    else if (named.gyms.indexOf(mine) >= 0) own.push({ label: named.label, url: v.url, youtube: v.youtube });
  });
  return (own.length ? own : shared).slice(0, 6);
}

/**
 * The gyms a Video URL label names, wherever in the label (a gym's id, short or full name, 1 to 3
 * words, or its Name on the Gyms tab), and the label without them: "OKC Fat Loss" is { gyms:
 * ['okc'], label: 'Fat Loss' }, "Iron View & OKC" is both gyms with no label, "Fat Loss" names none.
 * Gyms joined by a hyphen or dash count too ("OKC-Tulsa", "OKC – Tulsa"; the 11/24/2026 review found
 * those shown at every gym), and a dash between two words of the rest stays ("OKC Fat-Loss" is
 * OKC's "Fat-Loss"). Any gym name counts, so there's no "not" form: "Not OKC" is OKC's.
 */
function res27VideoLabel_(label) {
  // Each word with what joined it to the one before (spaces, a dash, a comma), for the rest's label.
  var text = String(label || '');
  var words = [];
  var gaps = [];
  var re = /[^\s,&\/+;\-–—]+/g;
  var m;
  var end = 0;
  while ((m = re.exec(text))) {
    words.push(m[0]);
    gaps.push(text.slice(end, m.index));
    end = m.index + m[0].length;
  }
  // A gym renamed on the Gyms tab ("Koda Austin") is known by that name too.
  var names = res27Gyms_().list.map(function (g) {
    var key = res27Alnum_(g.name);
    return { id: g.id, key: key, bare: key.replace(/^koda(?:crossfit)?/, '') };
  });
  var byName = function (text) {
    var key = res27Alnum_(text);
    for (var n = 0; n < names.length; n++) {
      if (key && (key === names[n].key || (names[n].bare.length >= 3 && key === names[n].bare))) return names[n].id;
    }
    return '';
  };
  var gyms = [];
  var rest = []; // indexes of the words that aren't a gym's name
  var i = 0;
  while (i < words.length) {
    var hit = '';
    var size = 1;
    for (var k = Math.min(3, words.length - i); k >= 1; k--) {
      var name = words.slice(i, i + k).join(' ');
      hit = res27GymId_(name) || byName(name);
      if (hit) {
        size = k;
        break;
      }
    }
    if (hit && gyms.indexOf(hit) < 0) gyms.push(hit);
    if (!hit) rest.push(i);
    i += size;
  }
  if (!gyms.length) return { gyms: [], label: text.trim() };
  // What's left is that version's own label; joining words ("OKC and Tulsa", "OKC only") aren't one.
  // Two words that stood side by side keep the dash between them ("Fat-Loss"); others get a space.
  var kept = rest.filter(function (n) {
    return !/^(?:and|only)$/i.test(words[n]);
  });
  var out = '';
  kept.forEach(function (n, j) {
    if (j) {
      var gap = kept[j - 1] === n - 1 ? gaps[n].replace(/[,&\/+;]+/g, ' ').replace(/\s+/g, ' ') : ' ';
      out += gap.trim() ? gap : ' ';
    }
    out += words[n];
  });
  return { gyms: gyms, label: out };
}

function res27YouTubeId_(url) {
  var m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(String(url));
  return m ? m[1] : '';
}

/**
 * The first day that can still be filled in or changed (Kevin, 11/11/2026): each challenge week
 * (7 days from Day 1, Monday–Sunday) stays open until midnight on the first day after it, the
 * Monday. Kevin pulls the scores then and tallies them Tuesday morning. So on a week's first day
 * last week is still open; from its second day on, only this week.
 */
function res27OpenFrom_(start, today) {
  var yesterday = res27DiffDays_(start, today) - 1;
  if (yesterday < 0) return start;
  return res27AddDays_(start, Math.floor(yesterday / 7) * 7);
}

/** "Monday" for a yyyy-MM-dd key. */
function res27WeekdayName_(key) {
  return Utilities.formatDate(new Date(res27KeyToUtc_(key) + 12 * 3600000), 'UTC', 'EEEE');
}

/** Day 1 and the length of someone's own challenge: while a beta test is set, Test accounts go through it instead. */
function res27ProgramDates_(cfg, person) {
  var beta = person && person.type === 'Test' ? res27Beta_(cfg) : null;
  return {
    beta: beta,
    start: beta ? beta.start : res27ParseDateKey_(cfg.start_date) || '2027-01-18',
    length: beta ? beta.length : Math.max(1, Math.min(120, parseInt(cfg.length_days, 10) || 42)),
  };
}

function res27Program_(cfg, person, clientToday) {
  // While a beta test is set, Test accounts go through it instead, on the real dates.
  var dates = res27ProgramDates_(cfg, person);
  var beta = dates.beta;
  var start = dates.start;
  var length = dates.length;
  var end = res27AddDays_(start, length - 1);
  var serverToday = res27TodayKey_();
  var today = serverToday;
  var asked = res27ParseDateKey_(clientToday);
  if (asked && Math.abs(res27DiffDays_(serverToday, asked)) <= 1) today = asked;
  // preview_today moves every Test account, so it's off while a beta test runs: beta testers are
  // Test accounts too, and they must always be on the real date.
  var preview = beta ? null : res27ParseDateKey_(cfg.preview_today);
  if (person && person.type === 'Test' && preview) today = preview;
  var dayNumber = res27DiffDays_(start, today) + 1;
  var phase = dayNumber < 1 ? 'before' : dayNumber > length ? 'after' : 'during';
  // The week locks at midnight Mountain time (when Kevin pulls the scores) or at the phone's own
  // midnight, whichever comes first, so a phone that's a day behind Denver can't reopen last week.
  var lockDay = person && person.type === 'Test' && preview ? today : serverToday > today ? serverToday : today;
  var editFrom = res27OpenFrom_(start, lockDay);
  var editTo = today < end ? today : end;
  return {
    start: start,
    end: end,
    length: length,
    today: today,
    dayNumber: dayNumber,
    phase: phase,
    week: phase === 'during' ? Math.ceil(dayNumber / 7) : 0,
    editFrom: editFrom,
    editTo: editTo,
    preview: !!(person && person.type === 'Test' && preview),
    beta: !!beta,
  };
}

/** One day as the app shows it to someone at gymId (the videos can differ by gym). */
function res27DayPublic_(n, program, content, cfg, gymId) {
  var date = res27AddDays_(program.start, n - 1);
  var c = content[n] || {};
  var released = date <= program.today;
  var weekday = Utilities.formatDate(new Date(res27KeyToUtc_(date) + 12 * 3600000), 'UTC', 'EEE');
  var day = {
    n: n,
    date: date,
    weekday: weekday,
    week: c.week || Math.ceil(n / 7),
    theme: c.theme || '',
    released: released,
  };
  if (released) {
    day.title = c.title || '';
    day.videos = res27VideosFor_(c.video, gymId);
    // Beta test: a day with no video yet plays the 2026 video its plan reuses, marked as a stand-in.
    if (!day.videos.length && program.beta && c.standIn) {
      day.videos = [{ label: '', url: 'https://www.youtube.com/watch?v=' + c.standIn, youtube: c.standIn, standIn: true }];
    }
    day.category = c.category || '';
    day.about = c.about || '';
    day.action = c.action || '';
    day.bonus = c.bonus || '';
    day.bonusPoints = c.bonus ? c.bonusPoints || RES27_POINTS.bonus : 0;
    day.presenter = c.presenter || '';
  } else if (res27Truthy_(cfg.show_upcoming_titles)) {
    day.title = c.title || '';
  }
  return day;
}

/** The week's finisher workouts, with their videos for someone at gymId (a gym's own line, as on the Days tab). */
function res27FinishersFor_(program, gymId) {
  var week = program.phase === 'during' ? Math.ceil(program.dayNumber / 7) : program.phase === 'before' ? 1 : 0;
  if (!week) return [];
  return res27AllRows_('finishers')
    .filter(function (r) {
      return parseInt(r['Week'], 10) === week && (r['Name'] || r['Workout']);
    })
    .slice(0, 6)
    .map(function (r) {
      return {
        week: week,
        name: res27CleanText_(r['Name'], 80),
        workout: String(r['Workout'] || '').trim().slice(0, 1500),
        videos: res27VideosFor_(r['Video URL'], gymId),
      };
    });
}

/* ================================================================ people & setup ==== */

/**
 * A person from their Participants row and App Data row. The JSON on App Data carries the owner's
 * ID; if it doesn't match, nothing is read or written and the mismatch is logged for Kevin.
 */
function res27Person_(row, app) {
  if (!row) return null;
  var id = String(row['ID']).trim();
  var setup = res27ParseJson_(app && app['Setup'], {});
  var history = res27ParseJson_(app && app['History'], {});
  if ((setup.id && String(setup.id) !== id) || (history._id && String(history._id) !== id)) {
    throw new Error('App Data does not match ID ' + id + ' (App Data row ' + (app && app._row) + '). Was the App Data tab sorted? Undo the sort.');
  }
  delete setup.id;
  delete history._id;
  var shirtLabel = String(row['Shirt'] || '');
  var shirt = shirtLabel === RES27_SHIRTS.tank ? 'tank' : shirtLabel === RES27_SHIRTS.tee ? 'tee' : '';
  return {
    row: row._row,
    appRow: app ? app._row : 0,
    id: id,
    first: String(row['First Name'] || ''),
    last: String(row['Last Name'] || ''),
    email: String(row['Email'] || ''),
    type: String(row['Type'] || 'Member').trim() || 'Member',
    payment: String(row['Payment'] || ''),
    paid: row['Paid'],
    shirt: shirt,
    size: String(row['Size'] || ''),
    coach: String(row['Coach'] || ''),
    team: String(row['Team'] || ''),
    status: String(row['Status'] || 'Active'),
    // Blank is Iron View (everyone before 11/23/2026). Something that isn't a gym (a typo) is Iron
    // View too, and the summary lists it (gymCell) so Kevin can fix it.
    gym: res27GymId_(row['Gym']) || RES27_DEFAULT_GYM,
    gymCell: row['Gym'] === null || row['Gym'] === undefined ? '' : String(row['Gym']).trim(),
    dailyEmail: res27DailyOn_(row['Daily Email']),
    setup: setup,
    history: history,
  };
}

/**
 * The Daily Email cell: on only when it's blank (everyone before the column), TRUE, or On / Yes /
 * Y / 1 (any case). Anything else is off, so a stop written in Kevin's own words ("Off (asked
 * 1/20)", "Unsubscribed", "Stop emails") stops it, rather than only a few exact words doing so.
 */
function res27DailyOn_(cell) {
  if (cell === true) return true;
  if (cell === false) return false;
  var text = String(cell === null || cell === undefined ? '' : cell).trim();
  return !text || /^(?:on|yes|y|true|1)$/i.test(text);
}

function res27LoadPerson_(id) {
  var row = res27FindRow_('participants', 'ID', id);
  if (!row) return null;
  return res27Person_(row, res27FindRow_('appdata', 'ID', id));
}

function res27AllPeople_() {
  var apps = {};
  res27AllRows_('appdata').forEach(function (a) {
    apps[String(a['ID']).trim()] = a;
  });
  var out = [];
  res27AllRows_('participants').forEach(function (r) {
    if (!String(r['ID']).trim()) return;
    try {
      out.push(res27Person_(r, apps[String(r['ID']).trim()]));
    } catch (e) {
      /* a mismatched row is reported when that person opens the app */
    }
  });
  return out;
}

function res27SetupJson_(setup, id) {
  var o = { id: id };
  Object.keys(setup || {}).forEach(function (k) {
    if (k !== 'id') o[k] = setup[k];
  });
  return JSON.stringify(o);
}

function res27HistoryJson_(history, id) {
  var o = { _id: id };
  Object.keys(history || {}).forEach(function (k) {
    if (res27IsDayKey_(k)) o[k] = history[k];
  });
  return JSON.stringify(o);
}

function res27PublicPerson_(p) {
  var s = p.setup || {};
  var paid = null;
  if (p.type === 'Remote') paid = res27Truthy_(p.paid);
  return {
    id: p.id,
    first: p.first,
    last: p.last,
    email: p.email,
    type: p.type,
    payment: p.payment,
    paid: paid,
    shirt: p.shirt,
    size: p.size,
    coach: p.coach,
    team: p.team,
    gym: p.gym,
    dailyEmail: p.dailyEmail !== false,
    setup: {
      goal: s.goal || '',
      track: s.track || {},
      plan: s.plan || '',
      planOther: s.planOther || '',
      macros: s.macros || null,
      sleepHours: s.sleepHours || 7,
      proteinG: s.proteinG || 0,
      hydrationOz: s.hydrationOz || 0,
      finishersPerWeek: s.finishersPerWeek || 2,
      skill: s.skill || '',
      mobility: s.mobility || '',
      other: s.other || [],
      coaches: s.coaches || [],
    },
  };
}

function res27Num_(value, min, max) {
  if (value === '' || value === null || value === undefined) return null;
  var n = Number(value);
  if (!isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Validates and normalizes the goal / tracking / follow-up answers. Throws a friendly message.
 * The coach ranking keeps only coaches of the person's gym (none when the gym lists no coaches).
 */
function res27CleanSetup_(raw, cfg, gym) {
  raw = raw || {};
  var s = {};
  s.goal = String(raw.goal || '');
  if (!RES27_GOALS[s.goal]) res27Fail_('Pick your main focus for the challenge.');
  s.track = {};
  var rawTrack = raw.track || {};
  RES27_TRACK_KEYS.forEach(function (k) {
    s.track[k] = rawTrack[k] === true;
  });
  if (s.track.nutrition) {
    s.plan = String(raw.plan || '');
    if (!RES27_PLANS[s.plan]) res27Fail_('Choose the nutrition plan you will follow.');
    if (s.plan === 'other') {
      s.planOther = res27CleanText_(raw.planOther, 120);
      if (!s.planOther) res27Fail_('Tell us a little about the nutrition plan you will follow.');
    }
    if (s.plan === 'macros') {
      var m = raw.macros || {};
      s.macros = {
        protein: res27Num_(m.protein, 0, 600),
        carbs: res27Num_(m.carbs, 0, 1200),
        fat: res27Num_(m.fat, 0, 400),
        calories: res27Num_(m.calories, 0, 10000),
        wantHelp: m.wantHelp === true,
      };
    }
  }
  if (s.track.sleep) {
    var hours = Number(raw.sleepHours);
    s.sleepHours = RES27_SLEEP_CHOICES.indexOf(hours) >= 0 ? hours : 7;
  }
  if (s.track.protein) {
    var grams = Number(raw.proteinG);
    if (!isFinite(grams) || grams < 30 || grams > 400) res27Fail_('Set a daily protein goal between 30 and 400 grams.');
    s.proteinG = Math.round(grams);
  }
  if (s.track.hydration) {
    s.hydrationOz = res27Num_(raw.hydrationOz, 0, 400);
    if (!s.hydrationOz || s.hydrationOz < 24) res27Fail_('Set a daily water goal (in ounces).');
  }
  if (s.track.finishers) {
    var perWeek = Number(raw.finishersPerWeek);
    s.finishersPerWeek = RES27_FINISHER_CHOICES.indexOf(perWeek) >= 0 ? perWeek : 2;
  }
  if (s.track.skill) {
    s.skill = res27CleanText_(raw.skill, 60);
    if (!s.skill) res27Fail_('Tell us which skill you want to work on.');
  }
  if (s.track.mobility) {
    s.mobility = res27CleanText_(raw.mobility, 60);
    if (!s.mobility) res27Fail_('Tell us what mobility you want to work on.');
  }
  if (s.track.other) {
    s.other = (Array.isArray(raw.other) ? raw.other : [])
      .map(function (h) {
        return res27CleanText_(h, 60);
      })
      .filter(Boolean)
      .slice(0, 3);
    if (!s.other.length) res27Fail_('Add the other habit you want to track, or turn Other off.');
  }
  var known = (gym || res27Gym_(RES27_DEFAULT_GYM)).coaches;
  var seen = {};
  s.coaches = res27RawRanking_(raw).filter(function (c) {
    if (known.indexOf(c) < 0 || seen[c]) return false;
    seen[c] = true;
    return true;
  });
  return s;
}

/** The coach names a request ranked, cleaned, before checking them against a gym's coaches. */
function res27RawRanking_(raw) {
  return (raw && Array.isArray(raw.coaches) ? raw.coaches : [])
    .map(function (c) {
      return res27CleanText_(c, 40);
    })
    .filter(Boolean);
}

function res27PlanLabel_(s) {
  if (!s.track || !s.track.nutrition) return '';
  if (s.plan === 'other' && s.planOther) return 'Other: ' + s.planOther;
  return RES27_PLANS[s.plan] || '';
}

function res27PlanDetails_(s) {
  if (!s.track || !s.track.nutrition) return '';
  if (s.plan === 'macros' && s.macros) {
    var m = s.macros;
    var parts = [];
    if (m.protein) parts.push('P ' + m.protein + 'g');
    if (m.carbs) parts.push('C ' + m.carbs + 'g');
    if (m.fat) parts.push('F ' + m.fat + 'g');
    if (m.calories) parts.push(m.calories + ' cal');
    if (m.wantHelp) parts.push('WANTS HELP setting macros');
    return parts.join(' · ') || 'No targets yet';
  }
  if (s.plan === 'other') return s.planOther || '';
  return '';
}

function res27ChecklistText_(s) {
  var parts = [];
  var t = s.track || {};
  if (t.nutrition) parts.push('Nutrition (' + (RES27_PLANS[s.plan] || '') + ')');
  if (t.workout) parts.push('Workout');
  if (t.sleep) parts.push('Sleep ' + s.sleepHours + 'h');
  if (t.protein) parts.push('Protein ' + s.proteinG + ' g');
  if (t.hydration) parts.push('Water ' + s.hydrationOz + ' oz');
  if (t.finishers) parts.push('Finishers ' + s.finishersPerWeek + '/wk');
  if (t.skill) parts.push('Skill: ' + s.skill);
  if (t.mobility) parts.push('Mobility: ' + s.mobility);
  if (t.recovery) parts.push('Recovery');
  if (t.other) (s.other || []).forEach(function (h) {
    parts.push('Other: ' + h);
  });
  return parts.join(' · ');
}

/** The readable Participants columns that come from the setup. */
function res27SetupColumns_(s, gym) {
  return {
    'Goal': RES27_GOALS[s.goal] || '',
    'Nutrition Plan': res27PlanLabel_(s),
    'Plan Details': res27PlanDetails_(s),
    'Daily Checklist': res27ChecklistText_(s),
    'Coach Ranking': res27RankingText_(s, gym),
  };
}

/** "1. Maggie  2. Kevin", "No preference", or blank at a gym that lists no coaches (its sign-up skips the step). */
function res27RankingText_(s, gym) {
  var text = (s.coaches || []).map(function (c, i) {
    return i + 1 + '. ' + c;
  }).join('  ');
  if (text) return text;
  return (gym || res27Gym_(RES27_DEFAULT_GYM)).coaches.length ? 'No preference' : '';
}

/* ================================================================ the checklist ==== */

/**
 * The yes/no items for one person on one day. Each item has units: [key, weight, kind, label or goal].
 * A unit is one yes/no answer; key "item:sub" groups sub-answers under one item (meals).
 * kind 0 counts every day. kind 1 is the finisher: it counts on the days it's done, and missed
 * ones (goal in slot 4) count against the last day of the week. kind 2 is the bonus task, added
 * on top of the day's score out of 10.
 */
function res27Checklist_(person, day) {
  var s = (person && person.setup) || {};
  var t = s.track || {};
  var items = [];
  items.push({ id: 'video', label: 'Watched the daily video', sub: day && day.title ? day.title : '', icon: 'play', units: [['video', RES27_POINTS.video, 0]] });
  if (t.nutrition) {
    items.push({
      id: 'nutrition',
      label: 'Followed my nutrition plan',
      sub: res27PlanLabel_(s),
      icon: 'plate',
      kind: 'meals',
      units: RES27_MEALS.map(function (m) {
        return ['nutrition:' + m[0], RES27_POINTS.meal, 0, m[1]];
      }),
    });
  }
  if (t.workout) items.push({ id: 'workout', label: 'Daily workout', sub: 'Koda Workout, run, bike, swim, walk, hike, sports…', icon: 'dumbbell', units: [['workout', RES27_POINTS.workout, 0]] });
  if (t.sleep) items.push({ id: 'sleep', label: 'Slept ' + (s.sleepHours || 7) + '+ hours', sub: '', icon: 'moon', units: [['sleep', RES27_POINTS.sleep, 0]] });
  if (t.protein) items.push({ id: 'protein', label: 'Hit ' + (s.proteinG || 0) + ' g of protein', sub: 'Your daily minimum', icon: 'protein', units: [['protein', RES27_POINTS.protein, 0]] });
  if (t.hydration) items.push({ id: 'hydration', label: 'Drank ' + (s.hydrationOz || 0) + ' oz of water', sub: '', icon: 'drop', units: [['hydration', RES27_POINTS.hydration, 0]] });
  if (t.finishers) {
    var goal = s.finishersPerWeek || 2;
    items.push({ id: 'finisher', label: 'Finisher workout', sub: 'Goal: ' + goal + ' a week · counts on the days you do one', icon: 'bolt', units: [['finisher', RES27_POINTS.finisher, 1, goal]] });
  }
  if (t.skill) items.push({ id: 'skill', label: 'Skill work', sub: s.skill || '', icon: 'target', units: [['skill', RES27_POINTS.skill, 0]] });
  if (t.mobility) items.push({ id: 'mobility', label: 'Mobility', sub: s.mobility || '', icon: 'stretch', units: [['mobility', RES27_POINTS.mobility, 0]] });
  if (t.recovery) items.push({ id: 'recovery', label: 'Recovery session', sub: 'Cold plunge, sauna, massage or similar', icon: 'recovery', units: [['recovery', RES27_POINTS.recovery, 0]] });
  if (t.other) {
    (s.other || []).forEach(function (h, i) {
      items.push({ id: 'other' + (i + 1), label: h, sub: '', icon: 'star', units: [['other' + (i + 1), RES27_POINTS.other, 0]] });
    });
  }
  if (day && day.bonus) {
    var bp = day.bonusPoints || RES27_POINTS.bonus;
    items.push({ id: 'bonus', label: day.bonus, sub: 'Today only · +' + bp + ' bonus point' + (bp === 1 ? '' : 's'), icon: 'spark', bonus: true, units: [['bonus', bp, 2]] });
  }
  return items;
}

/** What gets saved with a day: [key, weight, kind], plus the weekly goal on the finisher unit. */
function res27UnitsOf_(items) {
  var units = [];
  items.forEach(function (item) {
    item.units.forEach(function (u) {
      var unit = [u[0], Number(u[1]) || 0, Number(u[2]) || 0];
      if (u[0] === 'finisher') unit.push(Number(u[3]) || 0);
      units.push(unit);
    });
  });
  return units;
}

/** A saved day's units follow the Days tab's current bonus for that day (added, changed or removed). */
function res27SyncBonus_(units, day) {
  var out = (units || []).filter(function (u) {
    return u[0] !== 'bonus';
  });
  if (day && day.bonus) out.push(['bonus', day.bonusPoints || RES27_POINTS.bonus, 2]);
  return out;
}

/**
 * A day's score out of 10: 10 x (weight answered yes) / (weight on the list), to one decimal.
 * kind 0 units always count, kind 1 (finisher) only when done, kind 2 (bonus) goes on top.
 * shortfall (missed finishers x their weight, last day of a week only) is added to the list.
 * done/of count the everyday items, so "4 of 6 done" ignores the finisher and the bonus.
 */
function res27Score_(units, answers, shortfall) {
  var items = {};
  var earned = 0;
  var max = 0;
  var bonus = 0;
  (units || []).forEach(function (u) {
    var itemId = String(u[0]).split(':')[0];
    var weight = Number(u[1]) || 0;
    var kind = Number(u[2]) || 0;
    var yes = answers[u[0]] === 1;
    if (!items[itemId]) items[itemId] = { all: true, kind: kind };
    if (!yes) items[itemId].all = false;
    if (kind === 2) {
      if (yes) bonus += weight;
      return;
    }
    if (kind === 1) {
      if (yes) {
        earned += weight;
        max += weight;
      }
      return;
    }
    max += weight;
    if (yes) earned += weight;
  });
  max += Math.max(0, Number(shortfall) || 0);
  var done = 0;
  var of = 0;
  Object.keys(items).forEach(function (id) {
    if (items[id].kind) return;
    of += 1;
    if (items[id].all) done += 1;
  });
  var score = max ? Math.round((earned / max) * 100) / 10 : 0;
  return { done: done, of: of, earned: earned, max: max, score: score, bonus: bonus, points: Math.round((score + bonus) * 10) / 10 };
}

/** The last day of the challenge week that date falls in ('' if the final week is cut short). */
function res27WeekEnd_(program, date) {
  var n = res27DiffDays_(program.start, date) + 1;
  if (n < 1) return '';
  var last = Math.ceil(n / 7) * 7;
  return last <= program.length ? res27AddDays_(program.start, last - 1) : '';
}

/** On the last day of a week: finishers short of that day's weekly goal, times their weight. */
function res27Shortfall_(history, program, date, units) {
  if (res27WeekEnd_(program, date) !== date) return 0;
  var f = (units || []).filter(function (u) {
    return u[0] === 'finisher';
  })[0];
  var goal = f ? Number(f[3]) || 0 : 0;
  if (!goal) return 0;
  var done = 0;
  for (var i = 0; i < 7; i++) {
    var e = history[res27AddDays_(date, -i)];
    if (e && e.a && e.a.finisher === 1) done += 1;
  }
  return Math.max(0, goal - done) * (Number(f[1]) || 0);
}

/** units with the finisher unit replaced by f (or removed when f is null), kept in checklist order. */
function res27SetFinisher_(units, f) {
  var out = (units || []).filter(function (u) {
    return u[0] !== 'finisher';
  });
  if (!f) return out;
  var at = out.length;
  for (var i = 0; i < out.length; i++) {
    var key = String(out[i][0]);
    if (key === 'skill' || key === 'mobility' || key === 'recovery' || key === 'bonus' || /^other\d/.test(key)) {
      at = i;
      break;
    }
  }
  out.splice(at, 0, f.slice());
  return out;
}

/**
 * A finished week keeps the finisher goal it really had. When one of its days is first filled in
 * after the week is over (caught up on the Monday), its finisher comes from that week's entries
 * saved while the week was on (the latest one), else from its nearest earlier logged day in that
 * week, else today's setup. So a setup change made since can't add, drop or move that week's
 * finishers or its Sunday penalty. Days of the current week follow the setup as usual.
 */
function res27WeekEndUnits_(person, program, date, units) {
  var index = res27DiffDays_(program.start, date);
  if (index < 0) return units;
  var from = res27AddDays_(program.start, Math.floor(index / 7) * 7);
  var last = res27AddDays_(from, 6);
  if (last >= program.today) return units;
  var finisherOf = function (e) {
    return e.u.filter(function (u) {
      return u[0] === 'finisher';
    })[0] || null;
  };
  var during = null;
  var duringT = -1;
  for (var i = 0; i < 7; i++) {
    var d = res27AddDays_(from, i);
    var e = d === date ? null : person.history[d];
    if (!e || !e.u || !e.u.length) continue;
    var t = Number(e.t) || 0;
    if (t > duringT && Utilities.formatDate(new Date(t), RES27_TZ, 'yyyy-MM-dd') <= last) {
      during = e;
      duringT = t;
    }
  }
  if (during) return res27SetFinisher_(units, finisherOf(during));
  for (var j = 1; j < 7; j++) {
    var before = res27AddDays_(date, -j);
    if (before < from) break;
    var p = person.history[before];
    if (p && p.u && p.u.length) return res27SetFinisher_(units, finisherOf(p));
  }
  return units;
}

/** The saved form of a day. p (score + bonus) is what totals add up. */
function res27Entry_(units, answers, shortfall, time) {
  var sc = res27Score_(units, answers, shortfall);
  return { a: answers, u: units, d: sc.done, n: sc.of, s: sc.score, b: sc.bonus, p: sc.points, e: sc.earned, m: sc.max, f: shortfall || 0, t: time || res27Now_() };
}

/** Points (daily scores plus bonuses) and days logged, counting only real days inside the challenge. */
function res27Totals_(history, program) {
  var points = 0;
  var days = 0;
  Object.keys(history || {}).forEach(function (date) {
    if (!res27IsDayKey_(date)) return;
    if (program && (date < program.start || date > program.end)) return;
    var e = history[date];
    if (!e || !e.a || !Object.keys(e.a).length) return;
    points += Number(e.p) || 0;
    days += 1;
  });
  return { points: Math.round(points * 10) / 10, days: days };
}

function res27AnswersText_(items, answers) {
  return items
    .map(function (item) {
      if (item.kind === 'meals') {
        var yes = item.units.filter(function (u) {
          return answers[u[0]] === 1;
        }).length;
        // Meals are checkboxes since 11/12: unchecked means not on plan, so always a count ("Meals 0/4").
        return 'Meals ' + yes + '/' + item.units.length;
      }
      var a = answers[item.units[0][0]];
      var mark = a === 1 ? '✓' : a === 0 ? '✗' : '–';
      var name = item.id === 'video' ? 'Video' : item.id === 'bonus' ? 'Bonus' : item.label;
      return name + ' ' + mark;
    })
    .join(' · ');
}

/** Rebuilds item labels for a saved day: that day's labels where the key still exists, simple names otherwise. */
function res27ItemsForUnits_(person, day, units) {
  var current = res27Checklist_(person, day);
  var byKey = {};
  current.forEach(function (item) {
    item.units.forEach(function (u) {
      byKey[u[0]] = item;
    });
  });
  var seen = {};
  var items = [];
  units.forEach(function (u) {
    var itemId = String(u[0]).split(':')[0];
    if (seen[itemId]) return;
    seen[itemId] = true;
    var match = byKey[u[0]];
    var own = units.filter(function (v) {
      return String(v[0]).split(':')[0] === itemId;
    });
    // The finisher keeps the weekly goal it was saved with (slot 4), not today's.
    var finisherSub = itemId === 'finisher' && own[0] && own[0][3] ? 'Goal: ' + own[0][3] + ' a week · counts on the days you do one' : '';
    if (match) {
      items.push({ id: match.id, label: match.label, sub: finisherSub || match.sub, icon: match.icon, kind: match.kind, bonus: match.bonus, units: own.map(function (v) {
        var sub = match.units.filter(function (w) {
          return w[0] === v[0];
        })[0];
        return [v[0], v[1], v[2], v[0] === 'finisher' ? v[3] : sub && sub[3]];
      }) });
    } else {
      var fallback = { video: 'Watched the daily video', nutrition: 'Followed my nutrition plan', workout: 'Daily workout', sleep: 'Sleep', protein: 'Protein goal', hydration: 'Hydration', finisher: 'Finisher workout', skill: 'Skill work', mobility: 'Mobility', recovery: 'Recovery session', bonus: 'Bonus task' };
      var icons = { video: 'play', nutrition: 'plate', workout: 'dumbbell', sleep: 'moon', protein: 'protein', hydration: 'drop', finisher: 'bolt', skill: 'target', mobility: 'stretch', recovery: 'recovery', bonus: 'spark' };
      items.push({ id: itemId, label: fallback[itemId] || 'Habit', sub: finisherSub, icon: icons[itemId] || 'star', kind: itemId === 'nutrition' ? 'meals' : undefined, bonus: itemId === 'bonus' || undefined, units: own.map(function (v) {
        var meal = RES27_MEALS.filter(function (m) {
          return 'nutrition:' + m[0] === v[0];
        })[0];
        return [v[0], v[1], v[2], v[0] === 'finisher' ? v[3] : meal ? meal[1] : undefined];
      }) });
    }
  });
  return items;
}

/** The checklist for every day people can still edit, from the saved snapshot when there is one. */
function res27EditableChecklists_(person, program, content, cfg) {
  var out = {};
  if (program.phase === 'before') return out;
  for (var date = program.editFrom; date <= program.editTo; date = res27AddDays_(date, 1)) {
    var n = res27DiffDays_(program.start, date) + 1;
    if (n < 1 || n > program.length) continue;
    var day = res27DayPublic_(n, program, content, cfg, person.gym);
    var saved = person.history[date];
    if (saved && saved.u && saved.u.length) {
      out[date] = res27ItemsForUnits_(person, day, res27SyncBonus_(saved.u, day));
    } else {
      // A day of a finished week shows the finisher that week really had (see res27WeekEndUnits_).
      var fresh = res27Checklist_(person, day);
      var units = res27UnitsOf_(fresh);
      var kept = res27WeekEndUnits_(person, program, date, units);
      out[date] = kept === units ? fresh : res27ItemsForUnits_(person, day, kept);
    }
  }
  return out;
}

function res27PublicHistory_(person, program) {
  var out = {};
  Object.keys(person.history || {}).forEach(function (date) {
    if (!res27IsDayKey_(date)) return;
    if (program && (date < program.start || date > program.end)) return;
    var e = person.history[date];
    if (!e) return;
    out[date] = { a: e.a || {}, u: e.u || [], d: e.d || 0, n: e.n || 0, s: e.s || 0, b: e.b || 0, p: e.p || 0, e: e.e || 0, m: e.m || 0, f: e.f || 0, t: e.t || 0 };
  });
  return out;
}

/* ================================================================ bootstrap ==== */

function res27Bootstrap_(person, clientToday) {
  var cfg = res27Settings_();
  var program = res27Program_(cfg, person, clientToday);
  var content = res27DaysContent_();
  var gym = res27Gym_(person.gym);
  var days = [];
  for (var n = 1; n <= program.length; n++) days.push(res27DayPublic_(n, program, content, cfg, person.gym));
  var checklists = res27EditableChecklists_(person, program, content, cfg);
  return {
    person: Object.assign(res27PublicPerson_(person), { askToCoach: !!res27CoachEmail_(gym.coachEmails, person.coach) }),
    program: program,
    config: res27PublicConfig_(cfg),
    days: days,
    history: res27PublicHistory_(person, program),
    checklists: checklists,
    preview: program.phase === 'before' ? res27Checklist_(person, { title: '', bonus: '' }) : null,
    finishers: res27FinishersFor_(program, person.gym),
    totals: res27Totals_(person.history, program),
    payUrl: person.type === 'Remote' ? res27VenmoPayUrl_(gym, 'Koda Resolutions 2027 - ' + person.first + ' ' + person.last) : '',
    serverTime: res27Now_(),
  };
}

/* ================================================================ auth ==== */

function res27Auth_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 4) res27Fail_('Please sign in again.', 'auth');
  var payload = parts.slice(0, 3).join('.');
  if (res27Sign_(payload) !== parts[3]) res27Fail_('Please sign in again.', 'auth');
  var issued = parseInt(parts[2], 36);
  if (!issued || res27Now_() - issued > RES27_TOKEN_MAX_DAYS * 86400000) res27Fail_('Please sign in again.', 'auth');
  // A phone still signed in to an account that's gone (beta and test accounts are deleted after the
  // beta) is told so, instead of a sign-in that then says there's no such account.
  var gone = 'This account no longer exists (beta and test accounts are deleted after the beta). Sign up again to join the challenge.';
  var acct = res27FindRow_('accounts', 'ID', parts[0]);
  if (!acct) res27Fail_(gone, 'auth');
  if (String(Number(acct['Token Version']) || 1) !== parts[1]) res27Fail_('Please sign in again.', 'auth');
  // An account with no Participants row wasn't purged (the purge takes both): signing in again
  // leads to "We couldn't find your sign-up… we'll fix it", not to a sign-up that starts over.
  var person = res27LoadPerson_(parts[0]);
  if (!person) res27Fail_('Please sign in again.', 'auth');
  if (/removed/i.test(person.status)) res27Fail_('This account is no longer active. Questions? Email ' + res27Gym_(person.gym).contactEmail + '.', 'inactive');
  return { acct: acct, person: person, id: parts[0] };
}

function res27TouchSeen_(person) {
  var cache = CacheService.getScriptCache();
  var key = 'res27:seen:' + person.id;
  if (cache.get(key)) return;
  cache.put(key, '1', 1800);
  res27AssertRow_('participants', person.row, 'ID', person.id);
  res27UpdateRow_('participants', person.row, { 'Last Seen': new Date(res27Now_()) });
}

/* ================================================================ public actions ==== */

function res27ConfigAction_(d) {
  return { ok: true, config: res27PublicConfig_(res27Settings_()) };
}

function res27EmailStatus_(d) {
  var email = res27LookupEmail_(d.email);
  if (!email) return { ok: true, valid: false, exists: false };
  // valid: whether a sign-up would take it; exists: an account has it (even one from before the
  // stricter check). Each answer uses one of the hour's RES27_EMAIL_HINTS_PER_HOUR (review,
  // 11/24/2026); past them, exists is null (not known): the sign-up still says so when it's sent,
  // so all that's lost is the early hint.
  var valid = !!res27CleanEmail_(email);
  if (res27Bump_('res27:eh:' + res27HourKey_(), 3700) > RES27_EMAIL_HINTS_PER_HOUR) return { ok: true, valid: valid, exists: null };
  return { ok: true, valid: valid, exists: !!res27FindRow_('accounts', 'Email', email) };
}

function res27Register_(d) {
  var cfg = res27Settings_();
  if (!res27Truthy_(cfg.registration_open)) {
    res27Fail_('Sign-ups are closed right now. Questions? Email ' + cfg.contact_email + '.', 'closed');
  }
  // The person's gym (11/23/2026) picks their payment details, coaches, colors and leaderboards.
  // A request with no gym at all comes from a page cached from before the gyms, which has no gym
  // step and only ever showed Iron View's details and coaches: that's an Iron View sign-up. Today's
  // page always sends one, so a blank or unknown gym from it is still refused.
  var gymId = d.gym === undefined ? RES27_DEFAULT_GYM : res27GymId_(d.gym);
  if (!gymId) res27Fail_('Pick your gym.', 'gym');
  var gym = res27Gym_(gymId);
  // Until setup has added the Gym column, a gym other than Iron View couldn't be stored (the row
  // would read as Iron View, and setup would then write Iron View in). Only if the order of a
  // deploy slips: setup runs before the front end goes out.
  if (gymId !== RES27_DEFAULT_GYM && res27Headers_('participants').indexOf('Gym') < 0) {
    res27Fail_('We’re still setting up sign-ups for ' + gym.name + '. Please try again in a few minutes.', 'not_ready');
  }
  var type = d.memberType === 'remote' ? 'Remote' : d.memberType === 'member' ? 'Member' : '';
  if (!type) res27Fail_('Choose Current Koda Member or Remote Participant.');
  // Only the ways to pay that gym offers: its own Venmo and Zelle, and a card at any gym (Kevin,
  // 11/23/2026: "put a placeholder for the card link, we'll add one later"; until the gym's Card URL
  // is in, the app and the welcome email say we'll email them a secure link). So every remote
  // sign-up picks one, and none is written as "Email them how to pay" (RES27_PAY_LATER) any more.
  var offered = res27GymPayments_(gym);
  var pay = type === 'Remote' ? String(d.payment || '') : '';
  if (type === 'Remote' && offered.indexOf(pay) < 0) res27Fail_('Choose how you’d like to pay the $' + gym.remotePrice + '.');
  var first = res27CleanText_(d.first, 40);
  var last = res27CleanText_(d.last, 40);
  if (!first || !last) res27Fail_('Please enter your first and last name.');
  var email = res27CleanEmail_(d.email);
  if (!email) res27Fail_('Please enter a valid email address.');
  var password = String(d.password || '');
  if (password.length < 6) res27Fail_('Your password needs at least 6 characters.');
  if (password.length > 128) res27Fail_('That password is too long.');
  var shirt = String(d.shirt || '');
  if (!RES27_SHIRTS[shirt]) res27Fail_('Choose a T-Shirt or a Ladies Tank.');
  var size = String(d.size || '');
  if (RES27_SIZES[shirt].indexOf(size) < 0) res27Fail_('Choose your ' + RES27_SHIRTS[shirt] + ' size.');
  var setup = res27CleanSetup_(d.setup, cfg, gym);
  // Through the beta link while a beta test is open (or any sign-up then, with beta_everyone on,
  // even from a page loaded before it was): a Test account (no payment, left out of the summary,
  // cleared before launch). A beta page sent after the beta ended is stopped, so a practice
  // sign-up never quietly turns into a real one that owes $99; the app reloads and asks again.
  var beta = d.beta === true || res27Truthy_(cfg.beta_everyone) ? res27BetaOpen_(cfg) : null;
  if (d.beta === true && !beta) {
    res27Fail_('The beta test is over, so this would be a real sign-up for the challenge. Check your details, then tap Create my account again.', 'beta_over');
  }
  var payLabel = RES27_PAYMENTS[pay] || '';
  var chose = type === 'Remote' ? 'Remote · ' + payLabel : 'Koda Member';

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var id;
  try {
    RES27_REQ_.headers = {};
    var now = new Date(res27Now_());
    var salt = res27RandomHex_(16);
    var hash = res27HashPassword_(password, salt, RES27_HASH_ROUNDS);
    var existing = res27FindRow_('accounts', 'Email', email);
    if (existing) {
      // A sign-up that died between its writes left an account with no participant: finish it.
      if (res27FindRow_('participants', 'ID', existing['ID'])) res27Fail_('That email already has an account. Sign in instead.', 'exists');
      id = String(existing['ID']);
      res27AssertRow_('accounts', existing._row, 'Email', email);
      res27UpdateRow_('accounts', existing._row, {
        'Password Hash': hash,
        'Salt': salt,
        'Rounds': RES27_HASH_ROUNDS,
        'Token Version': (Number(existing['Token Version']) || 1) + 1,
        'Failed Logins': 0,
        'Locked Until': '',
        'Last Login': now,
      });
    } else {
      id = res27NewId_();
      res27AppendRow_('accounts', {
        'ID': id,
        'Email': email,
        'Password Hash': hash,
        'Salt': salt,
        'Rounds': RES27_HASH_ROUNDS,
        'Token Version': 1,
        'Failed Logins': 0,
        'Reset Tries': 0,
        'Last Login': now,
        'Created': now,
      });
    }
    var oldApp = res27FindRow_('appdata', 'ID', id);
    if (oldApp) res27Sheet_('appdata').deleteRow(oldApp._row);
    res27AppendRow_('appdata', { 'ID': id, 'Setup': res27SetupJson_(setup, id), 'History': res27HistoryJson_({}, id), 'Updated': now });
    var row = {
      'ID': id,
      'Signed Up': now,
      'First Name': first,
      'Last Name': last,
      'Email': email,
      'Type': beta ? 'Test' : type,
      'Gym': gym.short,
      'Payment': !beta && type === 'Remote' ? payLabel : '',
      'Paid': !beta && type === 'Remote' ? '' : 'n/a',
      'Shirt': RES27_SHIRTS[shirt],
      'Size': size,
      'Status': 'Active',
      'Points': 0,
      'Days Logged': 0,
      'Last Seen': now,
      'Daily Email': 'On',
    };
    if (beta) row['Notes'] = 'Beta test sign-up (chose ' + chose + ')';
    var cols = res27SetupColumns_(setup, gym);
    Object.keys(cols).forEach(function (k) {
      row[k] = cols[k];
    });
    res27AppendRow_('participants', row);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  try {
    res27Log_(email, 'Signed up', (beta ? 'Beta test (chose ' + chose + ')' : type + (type === 'Remote' ? ' · pays by ' + payLabel : '')) + ' · ' + RES27_GOALS[setup.goal] + ' · ' + gym.short);
  } catch (e) {}
  var emailed = false;
  try {
    emailed = res27SendWelcome_(cfg, { id: id, first: first, last: last, email: email, type: beta ? 'Test' : type, beta: !!beta, pay: pay, gym: gymId, setup: setup, shirt: RES27_SHIRTS[shirt], size: size });
  } catch (e) {
    try {
      console.error('res27 welcome email: ' + e);
    } catch (ignore) {}
  }
  RES27_REQ_ = {};
  var person = res27LoadPerson_(id);
  var account = res27FindRow_('accounts', 'ID', id);
  return { ok: true, token: res27IssueToken_(id, Number(account && account['Token Version']) || 1), emailed: emailed, me: res27Bootstrap_(person, d.today) };
}

var RES27_BAD_PASSWORD_MSG = 'That password doesn’t match. Try again, or reset it.';
var RES27_DUMMY_SALT = '0123456789abcdef0123456789abcdef'; // hashing for an email with no account (res27LoginWork_)

function res27Login_(d) {
  var t0 = Date.now();
  return res27EvenOut_(t0, function () { return res27LoginWork_(d); });
}

function res27LoginWork_(d) {
  var cfg = res27Settings_();
  var email = res27LookupEmail_(d.email);
  var password = String(d.password || '');
  if (!email || !password) res27Fail_('Enter your email and password.');
  // No password is longer (sign-up, the reset and Change password all refuse one), and a huge one
  // would make an account's hashing outlast RES27_EVEN_ANSWER_MS (third check, 11/24/2026).
  if (password.length > 128) res27Fail_('That password is too long.');
  var acct = res27FindRow_('accounts', 'Email', email);
  // Every answer but a sign-in uses one of the hour's lookups, an email with an account or not;
  // past them, an email with none gets a wrong password's answer (res27LookupAllowed_). It does an
  // account's hashing too, so the floor in res27EvenOut_ has less to even out.
  if (!acct) {
    res27HashPassword_(password, RES27_DUMMY_SALT, RES27_HASH_ROUNDS);
    if (!res27LookupAllowed_()) res27Fail_(RES27_BAD_PASSWORD_MSG, 'bad_password');
    res27Fail_('We couldn’t find an account with that email. Check the spelling, or sign up first.', 'no_account');
  }
  var now = res27Now_();
  var lockedUntil = res27Time_(acct['Locked Until']);
  if (lockedUntil > now) {
    res27LookupAllowed_();
    res27Fail_('Too many tries. Wait ' + Math.max(1, Math.ceil((lockedUntil - now) / 60000)) + ' minutes, or reset your password.', 'locked');
  }
  var hash = res27HashPassword_(password, String(acct['Salt']), Number(acct['Rounds']) || RES27_HASH_ROUNDS);
  if (hash !== String(acct['Password Hash'])) {
    res27LookupAllowed_();
    var fails = (Number(acct['Failed Logins']) || 0) + 1;
    var update = { 'Failed Logins': fails };
    if (fails >= RES27_MAX_FAILED_LOGINS) {
      update['Failed Logins'] = 0;
      update['Locked Until'] = new Date(now + RES27_LOCK_MINUTES * 60000);
    }
    res27AssertRow_('accounts', acct._row, 'Email', email);
    res27UpdateRow_('accounts', acct._row, update);
    res27Fail_(RES27_BAD_PASSWORD_MSG, 'bad_password');
  }
  res27AssertRow_('accounts', acct._row, 'Email', email);
  res27UpdateRow_('accounts', acct._row, { 'Failed Logins': 0, 'Locked Until': '', 'Last Login': new Date(now) });
  var person = res27LoadPerson_(acct['ID']);
  if (!person) res27Fail_('We couldn’t find your sign-up. Email ' + cfg.contact_email + ' and we’ll fix it.', 'missing');
  if (/removed/i.test(person.status)) res27Fail_('This account is no longer active. Questions? Email ' + res27Gym_(person.gym).contactEmail + '.', 'inactive');
  return { ok: true, token: res27IssueToken_(person.id, Number(acct['Token Version']) || 1), me: res27Bootstrap_(person, d.today) };
}

function res27ResetCodeHash_(code, id) {
  return res27Sign_('reset|' + code + '|' + id);
}

function res27ResetStart_(d) {
  var cfg = res27Settings_();
  var email = res27LookupEmail_(d.email);
  if (!email) res27Fail_('Enter the email you signed up with.');
  var now = res27Now_();
  var hour = res27HourKey_();
  var busy = 'Lots of password resets right now. Try again in an hour, or email ' + cfg.contact_email + '.';
  var noMail = 'We couldn’t send the email right now. Email ' + cfg.contact_email + ' and we’ll reset it for you.';
  // Answers that don't depend on the email come before the account is looked up (review,
  // 11/24/2026), so they're the same for every email: the hour's resets used up, or no way to send
  // a code at all right now.
  if (res27Count_('res27:rs:' + hour) >= RES27_RESET_STARTS_PER_HOUR) res27Fail_(busy, 'busy');
  if (!res27CanMail_(cfg, 3)) {
    try {
      if (res27Bump_('res27:nm:' + hour, 3700) === 1) {
        var problem = res27ProviderProblem_(cfg);
        res27Log_('(password reset)', 'Email not sent', 'Reset codes can’t go out right now (' + (problem ? problem + '; ' : '') + 'Gmail has fewer than 3 sends left today). Logged once an hour.');
      }
    } catch (ignore) {}
    res27Fail_(noMail, 'mail');
  }
  // Each request uses one of the hour's lookups, an email with an account or not; past them, an
  // email with none gets what one with an account gets, "we sent a code", and nothing is sent.
  var allowed = res27LookupAllowed_();
  var acct = res27FindRow_('accounts', 'Email', email);
  if (!acct) {
    if (!allowed) return { ok: true };
    res27Fail_('We couldn’t find an account with that email. Check the spelling.', 'no_account');
  }
  if (res27Count_('res27:rf:' + acct['ID']) >= RES27_RESET_BAD_BUDGET) {
    res27Fail_('Too many wrong codes. Email ' + cfg.contact_email + ' and we’ll reset it for you.', 'too_many');
  }
  var expires = res27Time_(acct['Reset Expires']);
  if (expires && expires - RES27_RESET_MINUTES * 60000 + 60000 > now) {
    res27Fail_('We just sent you a code. Check your inbox (and spam), or try again in a minute.', 'wait');
  }
  if (res27Bump_('res27:rs:' + hour, 3700) > RES27_RESET_STARTS_PER_HOUR) res27Fail_(busy, 'busy');
  var code = res27RandomCode_();
  var name = String(cfg.program_name || 'Koda Resolutions 2027');
  // In the colors of the person's gym (their Participants row says which).
  var owner = res27FindRow_('participants', 'ID', acct['ID']);
  var gym = res27Gym_(owner ? res27GymId_(owner['Gym']) || RES27_DEFAULT_GYM : RES27_DEFAULT_GYM);
  var html = res27EmailFrame_(cfg, 'Your sign-in code',
    '<p style="margin:0 0 16px">Use this code to set a new password for ' + res27Html_(name) + ':</p>' +
    '<p style="margin:0 0 20px;font-size:34px;letter-spacing:8px;font-weight:700;color:' + gym.mail.ink + '">' + code + '</p>' +
    '<p style="margin:0;color:#5F6B7A">It works for ' + RES27_RESET_MINUTES + ' minutes. If you didn’t ask for it, you can ignore this email.</p>', gym);
  var sent = res27Mail_(cfg, email, 'Your ' + name + ' code: ' + code, html, 'Your code is ' + code + '. It works for ' + RES27_RESET_MINUTES + ' minutes.', 3, gym.contactEmail, res27FromName_(gym));
  if (!sent) {
    // Past the hour's lookups, the answer a sent code gets, so a send that fails says nothing about
    // whether the email has an account (third check, 11/24/2026). res27Mail_ put it on the Log.
    if (!allowed) return { ok: true };
    res27Fail_(noMail, 'mail');
  }
  res27AssertRow_('accounts', acct._row, 'Email', email);
  res27UpdateRow_('accounts', acct._row, {
    'Reset Code': res27ResetCodeHash_(code, acct['ID']),
    'Reset Expires': new Date(now + RES27_RESET_MINUTES * 60000),
    'Reset Tries': 0,
  });
  return { ok: true };
}

var RES27_CODE_EXPIRED_MSG = 'That code has expired. Ask for a new one.';

function res27ResetFinish_(d) {
  var t0 = Date.now();
  // The wait comes after the script lock below is let go, so it holds up nobody else.
  return res27EvenOut_(t0, function () { return res27ResetFinishWork_(d); });
}

function res27ResetFinishWork_(d) {
  var cfg = res27Settings_();
  var email = res27LookupEmail_(d.email);
  var code = String(d.code || '').replace(/\D/g, '');
  var password = String(d.password || '');
  if (!email) res27Fail_('Enter the email you signed up with.');
  if (code.length !== 6) res27Fail_('Enter the 6-digit code from the email.');
  if (password.length < 6) res27Fail_('Your new password needs at least 6 characters.');
  if (password.length > 128) res27Fail_('That password is too long.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var acct;
  try {
    acct = res27FindRow_('accounts', 'Email', email);
    // Every answer but a new password uses one of the hour's lookups, an email with an account or
    // not; past them, an email with none gets what an account with no code waiting gets
    // (res27LookupAllowed_).
    if (!acct) {
      if (!res27LookupAllowed_()) res27Fail_(RES27_CODE_EXPIRED_MSG, 'expired');
      res27Fail_('We couldn’t find an account with that email.', 'no_account');
    }
    var budgetKey = 'res27:rf:' + acct['ID'];
    if (res27Count_(budgetKey) >= RES27_RESET_BAD_BUDGET) {
      res27LookupAllowed_();
      res27Fail_('Too many wrong codes. Email ' + cfg.contact_email + ' and we’ll reset it for you.', 'too_many');
    }
    var now = res27Now_();
    var tries = Number(acct['Reset Tries']) || 0;
    if (!acct['Reset Code'] || res27Time_(acct['Reset Expires']) < now || tries >= RES27_RESET_MAX_TRIES) {
      res27LookupAllowed_();
      res27Fail_(RES27_CODE_EXPIRED_MSG, 'expired');
    }
    if (res27ResetCodeHash_(code, acct['ID']) !== String(acct['Reset Code'])) {
      res27LookupAllowed_();
      res27Bump_(budgetKey, 21600);
      res27AssertRow_('accounts', acct._row, 'Email', email);
      res27UpdateRow_('accounts', acct._row, { 'Reset Tries': tries + 1 });
      SpreadsheetApp.flush();
      res27Fail_('That code doesn’t match. Check the email and try again.', 'bad_code');
    }
    var salt = res27RandomHex_(16);
    var version = (Number(acct['Token Version']) || 1) + 1;
    res27AssertRow_('accounts', acct._row, 'Email', email);
    res27UpdateRow_('accounts', acct._row, {
      'Password Hash': res27HashPassword_(password, salt, RES27_HASH_ROUNDS),
      'Salt': salt,
      'Rounds': RES27_HASH_ROUNDS,
      'Token Version': version,
      'Reset Code': '',
      'Reset Expires': '',
      'Reset Tries': 0,
      'Failed Logins': 0,
      'Locked Until': '',
      'Last Login': new Date(now),
    });
    SpreadsheetApp.flush();
    acct['Token Version'] = version;
  } finally {
    lock.releaseLock();
  }
  var person = res27LoadPerson_(acct['ID']);
  if (!person) res27Fail_('We couldn’t find your sign-up.', 'missing');
  return { ok: true, token: res27IssueToken_(person.id, acct['Token Version']), me: res27Bootstrap_(person, d.today) };
}

/* ================================================================ signed-in actions ==== */

function res27Me_(d, auth) {
  try {
    res27TouchSeen_(auth.person);
  } catch (e) {}
  return { ok: true, me: res27Bootstrap_(auth.person, d.today) };
}

/**
 * Saves one day's answers. With patch: true (what the app sends) only the answers in the request
 * change, so two phones editing the same day don't erase each other. Null clears an answer.
 */
function res27Save_(d, auth) {
  var cfg = res27Settings_();
  var date = res27ParseDateKey_(d.date);
  var program = res27Program_(cfg, auth.person, d.today);
  if (!date) res27Fail_('Missing the day to save.');
  var n = res27DiffDays_(program.start, date) + 1;
  if (date < program.start || n < 1) res27Fail_('The challenge hasn’t started yet.', 'locked_day');
  if (date > program.today) res27Fail_('You can’t check in for a day that hasn’t happened yet.', 'locked_day');
  if (date > program.end || n > program.length) res27Fail_('That day is after the challenge ended.', 'locked_day');
  if (date < program.editFrom) {
    res27Fail_('That week is locked. Each week stays open until midnight on the ' + res27WeekdayName_(program.start) + ' after it.', 'locked_day');
  }
  var raw = d.answers && typeof d.answers === 'object' ? d.answers : {};
  var patch = d.patch === true;
  var content = res27DaysContent_();

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var entry;
  var totals;
  try {
    RES27_REQ_.headers = {};
    var person = res27LoadPerson_(auth.id);
    if (!person || !person.appRow) res27Fail_('Please sign in again.', 'auth');
    var day = res27DayPublic_(n, program, content, cfg, person.gym);
    var prior = person.history[date];
    var units = prior && prior.u && prior.u.length ? res27SyncBonus_(prior.u, day) : res27WeekEndUnits_(person, program, date, res27UnitsOf_(res27Checklist_(person, day)));
    var answers = {};
    if (patch && prior && prior.a) {
      Object.keys(prior.a).forEach(function (k) {
        answers[k] = prior.a[k];
      });
    }
    units.forEach(function (u) {
      if (patch && !Object.prototype.hasOwnProperty.call(raw, u[0])) return;
      var v = raw[u[0]];
      if (v === 1 || v === true || v === 'yes') answers[u[0]] = 1;
      else if (v === 0 || v === false || v === 'no') answers[u[0]] = 0;
      else delete answers[u[0]];
    });
    var keep = {};
    units.forEach(function (u) {
      keep[u[0]] = true;
    });
    Object.keys(answers).forEach(function (k) {
      if (!keep[k]) delete answers[k];
    });
    // The new answers go in first so this day's own finisher counts toward its week.
    person.history[date] = { a: answers, u: units };
    entry = res27Entry_(units, answers, res27Shortfall_(person.history, program, date, units));
    person.history[date] = entry;
    // A finisher changed earlier in a week moves that week's last day, if it's already logged.
    // Its Check-ins row is always rewritten, so one that failed to write before gets repaired.
    var end = res27WeekEnd_(program, date);
    var endDay = null;
    if (end && end !== date && person.history[end] && person.history[end].u && person.history[end].u.length) {
      var was = person.history[end];
      endDay = res27DayPublic_(res27DiffDays_(program.start, end) + 1, program, content, cfg, person.gym);
      var endUnits = res27SyncBonus_(was.u, endDay);
      person.history[end] = res27Entry_(endUnits, was.a || {}, res27Shortfall_(person.history, program, end, endUnits), was.t);
    }
    totals = res27Totals_(person.history, program);
    var stamp = new Date(res27Now_());
    res27AssertRow_('appdata', person.appRow, 'ID', person.id);
    res27UpdateRow_('appdata', person.appRow, { 'History': res27HistoryJson_(person.history, person.id), 'Updated': stamp });
    res27AssertRow_('participants', person.row, 'ID', person.id);
    res27UpdateRow_('participants', person.row, { 'Points': totals.points, 'Days Logged': totals.days, 'Last Seen': stamp });
    res27WriteCheckin_(person, date, n, day, entry, stamp);
    if (endDay) res27WriteCheckin_(person, end, endDay.n, endDay, person.history[end], stamp);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, date: date, entry: entry, totals: totals };
}

/** One person-day on the Check-ins tab: added the first time, updated after. */
function res27WriteCheckin_(person, date, n, day, entry, stamp) {
  var items = res27ItemsForUnits_(person, day, entry.u);
  var key = person.id + '|' + date;
  var log = {
    'Key': key,
    'ID': person.id,
    'Name': person.first + ' ' + person.last,
    'Team': person.team,
    'Gym': res27GymDef_(person.gym).short,
    'Date': date,
    'Day': n,
    'Done': entry.d,
    'Of': entry.n,
    'Score': entry.s,
    'Bonus': entry.b,
    'Points': entry.p,
    'Answers': res27AnswersText_(items, entry.a || {}),
    'Updated': stamp,
  };
  // Only the columns the tab has: a tab not yet updated by setup can't make a save fail.
  var have = res27Headers_('checkins');
  Object.keys(log).forEach(function (h) {
    if (have.indexOf(h) < 0) delete log[h];
  });
  var existing = res27FindRow_('checkins', 'Key', key);
  if (existing && String(existing['ID']).trim() === person.id) {
    res27AssertRow_('checkins', existing._row, 'Key', key);
    res27UpdateRow_('checkins', existing._row, log);
  } else {
    res27AppendRow_('checkins', log);
  }
}

/**
 * The Profile's changes, whichever the request has: setup (goal, habits, coach ranking), shirt,
 * gym and daily email. Six gyms (11/23/2026): the gym can change only before Day 1 of the real
 * challenge (at their gym, on their phone, and at the gym they'd move to), after which it's Kevin's
 * call (adminSetGym), since it moves the person between gym and team standings. The daily email
 * can be turned on or off any time.
 * A gym change also clears Team and Coach: Kevin set those for the old gym (teams belong to a gym,
 * so the mover would be a team of one at the new one), and the Log line says what was cleared.
 */
function res27UpdateSetup_(d, auth) {
  var cfg = res27Settings_();
  var me = auth.person;
  var gymId = me.gym;
  var program = res27Program_(cfg, me, d.today);
  if (d.gym !== undefined && d.gym !== null) {
    gymId = res27GymId_(d.gym);
    if (!gymId) res27Fail_('Pick your gym.', 'gym');
    if (gymId !== me.gym) {
      // Day 1 has started for them once it has by their own gym's clock (12:30 AM in Oklahoma is
      // Day 1 there, and its days can be logged, while it's still the day before in Denver), or on
      // their phone: its date (program.today, within a day of Denver's) is the one their days are
      // logged by, and a phone east of the gym reaches Day 1 first. Either way their Day 1 points
      // would move with them (11/24/2026 review, Kevin's call: any of the three locks it).
      if (res27GymLocked_(cfg, res27Gym_(me.gym)) || program.today >= (res27ParseDateKey_(cfg.start_date) || '2027-01-18')) {
        res27Fail_('Your gym can’t change once the challenge has started. Ask Kevin.', 'locked_gym');
      }
      // ...or once it has at the gym they'd move to: they'd join it in the middle of its Day 1, and
      // then couldn't move back (their old gym would be locked by then).
      var target = res27Gym_(gymId);
      if (res27GymLocked_(cfg, target)) {
        res27Fail_('Day 1 has already started at ' + target.name + ', so you can’t move there now. Ask Kevin.', 'locked_gym');
      }
      // Until setup has added the Gym column, a move can't be stored: only Team, Coach and the coach
      // ranking would be cleared, with "Saved" in the app (11/24/2026 review). The same wait as a
      // sign-up at another gym (res27Register_), if the order of a deploy slips.
      if (res27Headers_('participants').indexOf('Gym') < 0) {
        res27Fail_('We’re still setting up sign-ups for ' + target.name + '. Please try again in a few minutes.', 'not_ready');
      }
    }
  }
  var gym = res27Gym_(gymId);
  var setup = d.setup === undefined || d.setup === null ? null : res27CleanSetup_(d.setup, cfg, gym);
  // Each gym ranks its own coaches: a ranking with a coach who isn't at the new gym is cleared.
  var rankingCleared = false;
  if (setup && gymId !== me.gym && !res27RankingFits_(res27RawRanking_(d.setup), gym)) {
    rankingCleared = true;
    setup.coaches = [];
  }
  var daily = d.dailyEmail === true ? 'On' : d.dailyEmail === false ? 'Off' : null;
  var shirt = d.shirt === undefined ? null : String(d.shirt || '');
  var size = d.size === undefined ? null : String(d.size || '');
  if (shirt !== null && !RES27_SHIRTS[shirt]) res27Fail_('Choose a T-Shirt or a Ladies Tank.');
  if (shirt !== null && RES27_SIZES[shirt].indexOf(size) < 0) res27Fail_('Choose your size.');
  var shirtChanged = shirt !== null && (shirt !== me.shirt || size !== me.size);
  if (shirtChanged) {
    var until = res27ParseDateKey_(cfg.shirt_changes_until);
    if (until && res27TodayKey_() > until) res27Fail_('Shirts are already ordered, so sizes are locked. Email ' + res27Gym_(me.gym).contactEmail + ' if you need a swap.', 'locked_shirt');
  }
  var content = res27DaysContent_();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var old = { shirt: me.shirt, size: me.size, gym: me.gym, daily: me.dailyEmail, team: me.team, coach: me.coach };
  var gymChanged = false;
  try {
    RES27_REQ_.headers = {};
    var person = res27LoadPerson_(auth.id);
    if (!person || !person.appRow) res27Fail_('Please sign in again.', 'auth');
    old = { shirt: person.shirt, size: person.size, gym: person.gym, daily: person.dailyEmail, team: person.team, coach: person.coach };
    gymChanged = gymId !== person.gym;
    var update = {};
    var appUpdate = null;
    if (setup) {
      person.setup = setup;
      update = res27SetupColumns_(setup, gym);
      appUpdate = { 'Setup': res27SetupJson_(setup, person.id), 'Updated': new Date(res27Now_()) };
    } else if (gymChanged) {
      var kept = person.setup || {};
      if ((kept.coaches || []).length && !res27RankingFits_(kept.coaches, gym)) {
        kept.coaches = [];
        rankingCleared = true;
        appUpdate = { 'Setup': res27SetupJson_(kept, person.id), 'Updated': new Date(res27Now_()) };
      }
      update['Coach Ranking'] = res27RankingText_(kept, gym);
    }
    if (gymChanged) {
      update['Gym'] = gym.short;
      // Kevin's Team and Coach were for the old gym.
      if (String(old.team).trim()) update['Team'] = '';
      if (String(old.coach).trim()) update['Coach'] = '';
    }
    if (daily !== null) update['Daily Email'] = daily;
    if (shirt !== null) {
      update['Shirt'] = RES27_SHIRTS[shirt];
      update['Size'] = size;
    }
    // Today's saved check-in follows the new checklist (keeping answers that still apply). Earlier days keep theirs.
    var today = program.today;
    var todayDay = null;
    if (setup && program.phase === 'during' && person.history[today]) {
      todayDay = res27DayPublic_(res27DiffDays_(program.start, today) + 1, program, content, cfg, person.gym);
      var units = res27UnitsOf_(res27Checklist_(person, todayDay));
      // On a week's last day the finisher stays as it was, so turning finishers off (or changing the
      // goal) can't erase that week's missed ones. Finisher changes start with the next week.
      if (res27WeekEnd_(program, today) === today) {
        units = res27SetFinisher_(units, (person.history[today].u || []).filter(function (u) {
          return u[0] === 'finisher';
        })[0] || null);
      }
      var oldAnswers = person.history[today].a || {};
      var answers = {};
      units.forEach(function (u) {
        if (oldAnswers[u[0]] === 1 || oldAnswers[u[0]] === 0) answers[u[0]] = oldAnswers[u[0]];
      });
      person.history[today] = { a: answers, u: units };
      person.history[today] = res27Entry_(units, answers, res27Shortfall_(person.history, program, today, units));
      var totals = res27Totals_(person.history, program);
      appUpdate['History'] = res27HistoryJson_(person.history, person.id);
      update['Points'] = totals.points;
      update['Days Logged'] = totals.days;
    }
    if (appUpdate) {
      res27AssertRow_('appdata', person.appRow, 'ID', person.id);
      res27UpdateRow_('appdata', person.appRow, appUpdate);
    }
    // (Gym and Daily Email only once setup has added those columns.)
    update = res27OnlyHave_('participants', update);
    if (!Object.prototype.hasOwnProperty.call(update, 'Daily Email')) daily = null;
    if (Object.keys(update).length) {
      res27AssertRow_('participants', person.row, 'ID', person.id);
      res27UpdateRow_('participants', person.row, update);
    }
    if (todayDay) res27WriteCheckin_(person, today, todayDay.n, todayDay, person.history[today], new Date(res27Now_()));
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  var cleared = gymChanged ? { ranking: rankingCleared, team: String(old.team).trim(), coach: String(old.coach).trim() } : null;
  try {
    var who = me.email;
    if (setup) res27Log_(who, 'Changed setup', res27ChecklistText_(setup));
    if (shirtChanged) res27Log_(who, 'Changed shirt', (RES27_SHIRTS[old.shirt] || '?') + ' ' + old.size + ' → ' + RES27_SHIRTS[shirt] + ' ' + size);
    if (gymChanged) res27Log_(who, 'Changed gym', res27GymMoveText_(old.gym, gym, cleared));
    if (daily !== null && (daily === 'On') !== old.daily) res27Log_(who, 'Daily email', (old.daily ? 'On' : 'Off') + ' → ' + daily + ' (Profile)');
  } catch (e) {}
  RES27_REQ_ = {};
  var out = { ok: true, me: res27Bootstrap_(res27LoadPerson_(auth.id), d.today) };
  // On a gym change, what went with the old gym: { ranking: true/false, team: 'Thunder', coach: 'Sam' } ('' when there was none).
  if (cleared) out.cleared = cleared;
  return out;
}

/** Whether Day 1 of the real challenge (start_date) has started at a gym, by that gym's own date: no moves out of it, or into it (res27UpdateSetup_). */
function res27GymLocked_(cfg, gym) {
  return res27GymNow_(gym).date >= (res27ParseDateKey_(cfg.start_date) || '2027-01-18');
}

/** The Log line for a gym move: "Iron View → OKC · coach ranking cleared · Team Thunder and Coach Sam cleared". */
function res27GymMoveText_(fromId, gym, cleared) {
  var c = cleared || {};
  var people = [c.team ? 'Team ' + c.team : '', c.coach ? 'Coach ' + c.coach : ''].filter(Boolean);
  return res27GymDef_(fromId).short + ' → ' + gym.short + (c.by ? ' (by ' + c.by + ')' : '') + (c.ranking ? ' · coach ranking cleared' : '') +
    (people.length ? ' · ' + people.join(' and ') + ' cleared' : '');
}

/** obj without the columns the tab doesn't have yet (a column setup adds can't make a save fail before setup runs). */
function res27OnlyHave_(tabKey, obj) {
  var have = res27Headers_(tabKey);
  var out = {};
  Object.keys(obj).forEach(function (h) {
    if (have.indexOf(h) >= 0) out[h] = obj[h];
  });
  return out;
}

function res27ChangePassword_(d, auth) {
  var current = String(d.current || '');
  var next = String(d.password || '');
  if (!current) res27Fail_('Enter your current password. Forgot it? Sign out and use Forgot password.', 'bad_password');
  // No password is longer, and hashing a huge one would tie the script up (final check, 11/24/2026).
  if (current.length > 128) res27Fail_('Your current password doesn’t match.', 'bad_password');
  if (next.length < 6) res27Fail_('Your new password needs at least 6 characters.');
  if (next.length > 128) res27Fail_('That password is too long.');
  var acct = auth.acct;
  if (res27HashPassword_(current, String(acct['Salt']), Number(acct['Rounds']) || RES27_HASH_ROUNDS) !== String(acct['Password Hash'])) {
    res27Fail_('Your current password doesn’t match.', 'bad_password');
  }
  var salt = res27RandomHex_(16);
  var version = (Number(acct['Token Version']) || 1) + 1;
  res27AssertRow_('accounts', acct._row, 'ID', auth.id);
  res27UpdateRow_('accounts', acct._row, {
    'Password Hash': res27HashPassword_(next, salt, RES27_HASH_ROUNDS),
    'Salt': salt,
    'Rounds': RES27_HASH_ROUNDS,
    'Token Version': version,
  });
  return { ok: true, token: res27IssueToken_(auth.id, version) };
}

function res27SignOutAll_(d, auth) {
  var version = (Number(auth.acct['Token Version']) || 1) + 1;
  res27AssertRow_('accounts', auth.acct._row, 'ID', auth.id);
  res27UpdateRow_('accounts', auth.acct._row, { 'Token Version': version });
  return { ok: true };
}

/* ================================================================ ask your coach ==== */

var RES27_ASK_MAX = 2000;
var RES27_ASK_PER_HOUR = 5;
var RES27_ASK_PER_DAY = 20;
var RES27_ASK_ALL_PER_HOUR = 40; // the whole app, so questions can't use up the shared daily email allowance

/** A gym's Coach Emails cell ("Riley: riley@x.com, Maggie: maggie@x.com" or one per line) as { riley: 'riley@x.com' }. */
function res27CoachEmails_(text) {
  var out = {};
  String(text || '').split(/[\n,;]+/).forEach(function (part) {
    var m = /^\s*(.+?)\s*[:=]\s*<?(\S+@[^\s>]+)>?\s*$/.exec(part) || /^\s*(.+?)\s+<?(\S+@[^\s>]+)>?\s*$/.exec(part);
    if (!m) return;
    var name = res27CleanText_(m[1], 60).toLowerCase();
    var email = res27CleanEmail_(m[2]);
    if (name && email) out[name] = email;
  });
  return out;
}

/** The email for a person's coach (Participants Coach column) in their gym's Coach Emails: the full name, else a unique first-name match. '' if none. */
function res27CoachEmail_(coachEmails, coach) {
  var map = res27CoachEmails_(coachEmails);
  var key = res27CleanText_(coach, 60).toLowerCase();
  if (!key) return '';
  if (map[key]) return map[key];
  // A first-name match only when one side is just a first name ("Riley" vs "Riley Smith"); two
  // different last names ("Riley Jones" vs "Riley Smith") are different coaches.
  var first = key.split(' ')[0];
  var bare = key.indexOf(' ') < 0;
  var hits = Object.keys(map).filter(function (k) {
    return k.split(' ')[0] === first && (bare || k.indexOf(' ') < 0);
  });
  return hits.length === 1 ? map[hits[0]] : '';
}

/**
 * "Ask a question" on the FAQs page (Kevin, 11/11/2026): the question is emailed to the person's
 * coach, with Reply-To set to the person so the coach just answers it. No coach yet (or no email
 * for that coach): it goes to the gym's contact email. Every question is also kept on the
 * Questions tab. The coach's address never goes back to the app. Since 11/23/2026 both come from
 * the person's gym (Gyms tab: Coach Emails, Contact Email; a blank Contact Email is Settings').
 */
function res27Ask_(d, auth) {
  var cfg = res27Settings_();
  var p = auth.person;
  var gym = res27Gym_(p.gym);
  var q = String(d.question || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (q.length < 3) res27Fail_('Type your question first.', 'bad_question');
  if (q.length > RES27_ASK_MAX) res27Fail_('That’s a long one. Please keep it under ' + RES27_ASK_MAX + ' characters.', 'bad_question');
  var hour = Utilities.formatDate(new Date(res27Now_()), RES27_TZ, 'yyyy-MM-dd-HH');
  var dayAgo = res27Now_() - 86400000;
  var lastDay = 0;
  try {
    lastDay = res27AllRows_('questions').filter(function (r) {
      return String(r['ID']).trim() === p.id && res27Time_(r['When']) > dayAgo;
    }).length;
  } catch (e) {
    /* no Questions tab yet (setup adds it): no daily count */
  }
  if (res27Count_('res27:ask:h:' + p.id + ':' + hour) >= RES27_ASK_PER_HOUR || lastDay >= RES27_ASK_PER_DAY) {
    res27Fail_('That’s a lot of questions for one day. Please wait a little, or email ' + gym.contactEmail + '.', 'busy_asks');
  }
  if (res27Count_('res27:ask:all:' + hour) >= RES27_ASK_ALL_PER_HOUR) {
    res27Fail_('Lots of questions are coming in right now. Please try again in a little while, or email ' + gym.contactEmail + '.', 'busy_asks');
  }
  res27Bump_('res27:ask:h:' + p.id + ':' + hour, 3700);
  res27Bump_('res27:ask:all:' + hour, 3700);
  var coach = res27CleanText_(p.coach, 60);
  var coachEmail = res27CoachEmail_(gym.coachEmails, coach);
  var to = coachEmail || res27CleanEmail_(gym.contactEmail) || res27CleanEmail_(cfg.contact_email);
  var name = p.first + ' ' + p.last;
  var program = res27Program_(cfg, p, d.today);
  var when = program.phase === 'during' ? 'Day ' + program.dayNumber + ' of ' + program.length : program.phase === 'before' ? 'before Day 1' : 'after the challenge';
  var note = coachEmail ? '' : coach ? 'Coach ' + coach + ' has no email in Coach Emails on the Gyms tab (' + gym.short + ') yet, so this came to the gym.' : 'No coach is assigned yet, so this came to the gym.';
  // Reply-To is the person, so the coach just hits Reply. An address from before the stricter check
  // ("jess@gmail.com.") can't be a Reply-To (res27Mail_ would put Settings' contact, Iron View's, in
  // its place), so replies go to the person's own gym, and the email says so instead of promising
  // that Reply reaches them (11/24/2026 review).
  var replyTo = res27CleanEmail_(p.email);
  var replyLine = replyTo ? 'Reply to this email to answer ' + p.first + ' directly.'
    : p.first + '’s email address on file (' + p.email + ') isn’t one we can send to, so replies go to ' + gym.name + ', not to ' + p.first + '.';
  var html = res27EmailFrame_(cfg, 'A question from ' + name,
    '<div style="background:#F0F2F5;border-radius:12px;padding:14px 16px;margin:0 0 16px;font-size:15px;color:#0F1925">' + res27Html_(q).replace(/\n/g, '<br>') + '</div>' +
    '<p style="margin:0 0 6px"><b>' + res27Html_(name) + '</b> · ' + res27Html_(p.email) + (p.team ? ' · Team ' + res27Html_(p.team) : '') + ' · ' + res27Html_(gym.name) + ' · ' + res27Html_(when) + '</p>' +
    (note ? '<p style="margin:0 0 6px;color:#5F6B7A">' + res27Html_(note) + '</p>' : '') +
    '<p style="margin:12px 0 0;color:#5F6B7A">' + res27Html_(replyLine) + '</p>', gym);
  var text = q + '\n\n- ' + name + ' (' + p.email + ')' + (note ? '\n' + note : '') + '\n' + replyLine;
  var subject = (p.type === 'Test' ? '[Beta] ' : '') + 'Resolutions question from ' + name;
  var sent = to ? res27Mail_(cfg, to, subject, html, text, RES27_MAIL_RESERVE, replyTo || gym.contactEmail) : false;
  var kept = true;
  try {
    res27AppendRow_('questions', { 'When': new Date(res27Now_()), 'ID': p.id, 'Name': name, 'Email': p.email, 'Team': p.team, 'Coach': coach, 'Sent To': to, 'Question': q, 'Emailed': sent ? 'Sent' : 'NOT SENT' });
  } catch (e) {
    kept = false;
  }
  if (!sent && !kept) res27Fail_('That didn’t go through. Please try again in a minute, or email ' + gym.contactEmail + '.', 'server');
  return { ok: true, sent: sent, to: coachEmail ? 'coach' : 'gym', coach: coachEmail && sent ? coach : '' };
}

/* ================================================================ leaderboard ==== */

var RES27_BOARD_SECONDS = 120;
// A team's average is only shown once it has this many people: with 1 or 2, it would give away
// someone's own score (Kevin's rule: nobody sees anyone else's).
var RES27_BOARD_MIN_PEOPLE = 3;

/** A team as typed on Participants (Team column). */
function res27TeamName_(team) {
  return res27CleanText_(team, 40);
}

/** The key that makes "Iron", "iron " and "Team Iron" one team. */
function res27TeamKey_(team) {
  return res27TeamName_(team).replace(/^team\s+/i, '').toLowerCase();
}

/**
 * Team standings (Kevin, 11/10/2026): every team's average points per person, for the whole
 * challenge and for this challenge week, so team size doesn't matter. Only team numbers leave the
 * server: no one sees anyone else's own score. Beta testers see the beta testers' teams, everyone
 * else the real teams. Cached two minutes per group and day, so a change on the Team column shows
 * within a couple of minutes.
 * Six gyms (Kevin, 11/23/2026: "overall leaderboards between gyms along with leaderboards within
 * the gyms"): teams belong to a gym ("Iron" at OKC and "Iron" at Tulsa are two teams), and people
 * see their own gym's teams plus the gym standings, every gym's average per person. The cached
 * board holds every gym's teams; each answer keeps the asker's gym's.
 */
function res27Leaderboard_(d, auth) {
  var cfg = res27Settings_();
  var program = res27Program_(cfg, auth.person, d.today);
  var test = auth.person.type === 'Test';
  // board2: the six-gym board (a board cached by 1.7 has no gyms and would be read wrong).
  var key = 'res27:board2:' + (test ? 'test' : 'real') + ':' + program.start + ':' + program.length + ':' + program.today;
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  var board = hit ? JSON.parse(hit) : res27BuildBoard_(test, program);
  if (!hit) {
    try {
      cache.put(key, JSON.stringify(board), RES27_BOARD_SECONDS);
    } catch (e) {
      /* too big to cache: fine, it's built each time */
    }
  }
  var myGym = auth.person.gym;
  var myTeam = res27TeamKey_(auth.person.team);
  return {
    ok: true,
    board: {
      teams: board.teams.filter(function (t) {
        return t.gym === myGym;
      }).map(function (t) {
        return { key: t.key, name: t.name, people: t.people, overall: t.overall, week: t.week };
      }),
      gyms: board.gyms,
      week: board.week,
      weeks: board.weeks,
      weekFrom: board.weekFrom,
      weekTo: board.weekTo,
      minPeople: board.minPeople,
      updated: board.updated,
    },
    myTeam: myTeam ? myGym + ':' + myTeam : '',
    myGym: myGym,
  };
}

/** A group's average per person, to one decimal, or null when the group is too small to show (Kevin's rule). */
function res27BoardAverage_(points, people) {
  return people >= RES27_BOARD_MIN_PEOPLE ? Math.round((points / people) * 10) / 10 : null;
}

function res27BuildBoard_(test, program) {
  // Days that count: from Day 1 through today (the last day once it's over). "This week" is the
  // challenge week today falls in.
  var last = program.today < program.end ? program.today : program.end;
  var index = res27DiffDays_(program.start, last);
  var week = index < 0 ? 0 : Math.floor(index / 7) + 1;
  var weekFrom = week ? res27AddDays_(program.start, (week - 1) * 7) : '';
  var weekTo = week ? res27AddDays_(weekFrom, 6) : '';
  if (weekTo > program.end) weekTo = program.end;
  var gyms = res27Gyms_();
  var teams = {};
  var byGym = {};
  RES27_GYMS.forEach(function (g) {
    byGym[g.id] = { people: 0, points: 0, week: 0 };
  });
  res27AllPeople_().forEach(function (p) {
    if (!p || !p.id || /removed/i.test(p.status) || (p.type === 'Test') !== test) return;
    var points = 0;
    var inWeek = 0;
    Object.keys(p.history || {}).forEach(function (date) {
      if (!res27IsDayKey_(date) || date < program.start || date > last) return;
      var e = p.history[date];
      if (!e || !e.a || !Object.keys(e.a).length) return;
      var pts = Number(e.p) || 0;
      points += pts;
      if (week && date >= weekFrom && date <= weekTo) inWeek += pts;
    });
    // Everyone at a gym counts toward its standing, with a team or not.
    var g = byGym[p.gym] || byGym[RES27_DEFAULT_GYM];
    g.people += 1;
    g.points += points;
    g.week += inWeek;
    var name = res27TeamName_(p.team);
    var k = res27TeamKey_(p.team);
    if (!k) return;
    var key = p.gym + ':' + k;
    var t = teams[key] || (teams[key] = { key: key, gym: p.gym, name: name.replace(/^team\s+/i, ''), people: 0, points: 0, week: 0 });
    t.people += 1;
    t.points += points;
    t.week += inWeek;
  });
  var covered = {}; // per gym, how many people are on a team whose numbers are shown
  var list = Object.keys(teams).map(function (k) {
    var t = teams[k];
    if (t.people >= RES27_BOARD_MIN_PEOPLE) covered[t.gym] = (covered[t.gym] || 0) + t.people;
    return { key: t.key, gym: t.gym, name: t.name, people: t.people, overall: res27BoardAverage_(t.points, t.people), week: res27BoardAverage_(t.week, t.people) };
  });
  // Every gym is listed, even with no one yet; ranked by the whole challenge, those without a
  // number last, in the usual gym order. Kevin's rule covers subtraction too: if only 1 or 2 of a
  // gym's people aren't on a team with numbers (no team, or a team under 3), the gym's average
  // minus its teams' would be their own score, so that gym's numbers are withheld.
  var standings = RES27_GYMS.map(function (def, i) {
    var g = byGym[def.id];
    var rest = g.people - (covered[def.id] || 0);
    var withheld = g.people >= RES27_BOARD_MIN_PEOPLE && rest > 0 && rest < RES27_BOARD_MIN_PEOPLE;
    return {
      id: def.id,
      name: gyms.byId[def.id].name,
      short: def.short,
      people: g.people,
      overall: withheld ? null : res27BoardAverage_(g.points, g.people),
      week: withheld ? null : res27BoardAverage_(g.week, g.people),
      withheld: withheld,
      order: i,
    };
  });
  standings.sort(function (a, b) {
    if (a.overall === null || b.overall === null) return a.overall === b.overall ? a.order - b.order : a.overall === null ? 1 : -1;
    return b.overall - a.overall || a.order - b.order;
  });
  standings.forEach(function (g) {
    delete g.order;
  });
  return { teams: list, gyms: standings, week: week, weeks: Math.ceil(program.length / 7), weekFrom: weekFrom, weekTo: weekTo, minPeople: RES27_BOARD_MIN_PEOPLE, updated: res27Now_() };
}

/* ================================================================ email ==== */

function res27Html_(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The frame every email goes in: the gym's colors and name across the top, its address and contact
 * email along the bottom (six gyms, 11/23/2026). Iron View's is the frame its emails always had.
 * footerHtml goes at the end of the footer (the daily email's "Stop these daily emails" link).
 */
function res27EmailFrame_(cfg, heading, bodyHtml, gym, footerHtml) {
  gym = gym || res27Gym_(RES27_DEFAULT_GYM);
  var m = gym.mail;
  var label = res27Html_(m.label || gym.name);
  var name = res27Html_(cfg.program_name || 'Koda Resolutions 2027');
  var contact = gym.contactEmail;
  return '<div style="background:#F4F6F8;padding:24px 12px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#0F1925">' +
    '<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E8ED;border-radius:16px;overflow:hidden">' +
    '<div style="background:' + m.head + ';padding:22px 28px;color:#FFFFFF' + (m.bar ? ';border-bottom:4px solid ' + m.bar : '') + '">' +
    '<div style="font-size:12px;letter-spacing:2px;color:' + m.headSub + ';text-transform:uppercase">' + label + '</div>' +
    '<div style="font-size:24px;font-weight:800;letter-spacing:.5px;margin-top:4px">' + name + '</div></div>' +
    '<div style="padding:26px 28px;font-size:15px;line-height:1.55">' +
    '<h1 style="font-size:20px;margin:0 0 14px;color:' + m.ink + '">' + res27Html_(heading) + '</h1>' + bodyHtml + '</div>' +
    '<div style="padding:16px 28px;border-top:1px solid #E4E8ED;font-size:12px;color:#8B95A3">' + label + (gym.address ? ' · ' + res27Html_(gym.address) : '') +
    (contact ? ' · ' + res27Html_(contact) : '') + (footerHtml || '') + '</div></div></div>';
}

/** A button link in the gym's colors: the main one, or `small` (the payment buttons). label is HTML. */
function res27MailButton_(gym, href, label, small) {
  var m = gym.mail;
  return '<a href="' + res27Html_(href) + '" style="display:inline-block;background:' + m.button + ';color:' + m.buttonText + ';text-decoration:none;padding:' + (small ? '10px 16px' : '12px 20px') +
    ';border-radius:10px;font-weight:600' + (small ? ';margin-top:10px' : '') + '">' + label + '</a>';
}

/**
 * Whether res27Mail_ could send at all right now, in its own order: an email provider that's set
 * up, else Gmail with at least `reserve` sends left today. (The reset asks first, so "can't send"
 * is the same answer for every email: review, 11/24/2026.) A provider that's set up counts even
 * right after a failure, as res27Mail_ tries it first anyway: a send that still fails is handled
 * where it happens (res27ResetStart_), not by turning resets away for a while.
 */
function res27CanMail_(cfg, reserve) {
  var provider = res27Provider_(cfg);
  if ((provider === 'resend' || provider === 'brevo') && !res27ProviderProblem_(cfg)) return true;
  try {
    return MailApp.getRemainingDailyQuota() >= (reserve || 3);
  } catch (e) {
    return false;
  }
}

/**
 * Sends one email. With an email provider set (email_provider resend or brevo, 11/23/2026) it goes
 * through it, so 400 sign-ups, codes and questions don't use up the Gmail account's ~100 sends a
 * day, which Koda's other pages share. Otherwise, or if the provider fails, it goes from the script
 * owner's Gmail: `reserve` keeps that many of the day's sends for the other pages. Anything not
 * sent is written to the Log tab, so it can be resent.
 */
function res27Mail_(cfg, to, subject, htmlBody, textBody, reserve, replyTo, fromName) {
  if (!to) return false;
  var why = '';
  // A Reply-To that isn't a real address (a typo in a gym's Contact Email) would get the email
  // turned down, so it falls back to Settings' contact_email.
  var reply = res27CleanEmail_(replyTo) || res27CleanEmail_(cfg.contact_email);
  var provider = res27Provider_(cfg);
  if ((provider === 'resend' || provider === 'brevo') && !res27ProviderProblem_(cfg)) {
    var res = res27SendOne_(cfg, provider, { to: to, subject: subject, html: htmlBody, text: textBody || '', replyTo: reply, fromName: fromName });
    if (res.ok) return true;
    why = provider + ' failed (' + res.error + '); ';
    // Once an hour on the Log, so a bad key or sender shows up without a line per email.
    try {
      if (res27Bump_('res27:pf:' + Utilities.formatDate(new Date(res27Now_()), RES27_TZ, 'yyyy-MM-dd-HH'), 3700) === 1) {
        res27Log_('(email)', 'Email provider failed', provider + ': ' + res.error + ' · sending with Gmail instead');
      }
    } catch (ignore) {}
  }
  try {
    var left = MailApp.getRemainingDailyQuota();
    if (left < (reserve || 3)) {
      why += 'daily email limit (' + left + ' left)';
    } else {
      var message = { to: to, subject: subject, htmlBody: htmlBody, body: textBody || '', name: fromName || 'Koda Resolutions' };
      if (reply) message.replyTo = reply;
      MailApp.sendEmail(message);
      return true;
    }
  } catch (e) {
    why += String(e && e.message || e).slice(0, 200);
  }
  try {
    res27Log_(to, 'Email not sent', subject + ' · ' + why);
  } catch (ignore) {}
  return false;
}

/** "Monday, November 9" for a yyyy-MM-dd key. */
function res27DayText_(key) {
  return Utilities.formatDate(new Date(res27KeyToUtc_(key) + 12 * 3600000), 'UTC', 'EEEE, MMMM d');
}

/** The welcome email, in the person's gym's colors, with that gym's payment details for a remote spot. */
function res27SendWelcome_(cfg, p) {
  var gym = res27Gym_(p.gym);
  var program = res27Program_(cfg, null, null);
  var startText = res27DayText_(program.start);
  var site = res27SiteLink_(cfg, gym.id, '');
  var price = gym.remotePrice;
  var beta = p.beta ? res27Beta_(cfg) : null;
  var payHtml = '';
  if (p.type === 'Remote') {
    // p.pay is always one of the gym's ways to pay (register checks): its Venmo or Zelle, or a card.
    var venmo = res27VenmoPayUrl_(gym, 'Koda Resolutions 2027 - ' + p.first + ' ' + p.last);
    var how = p.pay === 'venmo' ? 'pay on Venmo to <b>' + res27Html_(gym.venmo) + '</b>' + (venmo ? '<br>' + res27MailButton_(gym, venmo, 'Pay $' + price + ' on Venmo', true) : '')
      : p.pay === 'zelle' ? 'pay with Zelle to <b>' + res27Html_(gym.zelle) + '</b>, with your name in the memo'
      : gym.cardUrl ? 'pay by card:<br>' + res27MailButton_(gym, gym.cardUrl, 'Pay $' + price + ' by card', true)
      // No card link at the gym yet (Kevin, 11/23/2026: "put a placeholder for the card link, we'll
      // add one later"): the line Iron View's welcome email had before it had one.
      : 'pay by card. We’ll email you a secure link within a day';
    payHtml = '<div style="background:#F0F2F5;border-radius:12px;padding:14px 16px;margin:0 0 18px"><b>Your $' + price + ' remote spot:</b> ' + how + '. We’ll mark you paid in the app.</div>';
  }
  var sent = false;
  if (res27Truthy_(cfg.welcome_email) && beta) {
    var betaEnd = res27AddDays_(beta.start, beta.length - 1);
    var betaLink = res27SiteLink_(cfg, gym.id, '', 'beta=1');
    var betaBody = '<p style="margin:0 0 14px">Hi ' + res27Html_(p.first) + ', you’re in the <b>beta test</b> of the Resolutions app. It runs <b>' + res27DayText_(beta.start) + ' – ' + res27DayText_(betaEnd) +
      '</b> on the real dates, so you can try ' + (beta.length === 7 ? 'a week' : beta.length === 1 ? 'a day' : beta.length + ' days') + ' of check-ins before the challenge.</p>' +
      '<p style="margin:0 0 14px">Each day, open the app, watch the video and tap Yes or No on your list. ' +
      'A day you miss shows up as <b>Overdue</b>, and you can still fill it in until midnight on ' + res27WeekdayName_(beta.start) + ', when the week’s scores are pulled.</p>' +
      (betaLink ? '<p style="margin:0 0 18px">' + res27MailButton_(gym, betaLink, 'Open the app') + '</p>' : '') +
      '<p style="margin:0;color:#5F6B7A">Everything in the beta is practice. Beta accounts are deleted before the real challenge starts ' + startText + ', so you’ll sign up again for that one.</p>';
    sent = res27Mail_(cfg, p.email, 'You’re in the beta: ' + String(cfg.program_name || 'Koda Resolutions 2027'), res27EmailFrame_(cfg, 'Welcome to the beta test', betaBody, gym),
      'Hi ' + p.first + ', you are in the beta test of the Resolutions app, ' + res27DayText_(beta.start) + ' to ' + res27DayText_(betaEnd) + '. Open the app: ' + betaLink, RES27_MAIL_RESERVE, gym.contactEmail, res27FromName_(gym));
  } else if (res27Truthy_(cfg.welcome_email)) {
    var body = '<p style="margin:0 0 14px">Hi ' + res27Html_(p.first) + ', you’re signed up! Day 1 is <b>' + startText + '</b>.</p>' + payHtml +
      '<p style="margin:0 0 14px">Every day you’ll open the app, watch a short video, and check off your own daily list. Your checklist is already built from your answers, and you can change it any time on the Profile tab.</p>' +
      (site ? '<p style="margin:0 0 18px">' + res27MailButton_(gym, site, 'Open the app') + '</p>' : '') +
      '<p style="margin:0;color:#5F6B7A">Tip: open the link on your phone and add it to your home screen, then sign in once there. It remembers you after that.</p>';
    sent = res27Mail_(cfg, p.email, 'You’re in: ' + String(cfg.program_name || 'Koda Resolutions 2027'), res27EmailFrame_(cfg, 'Welcome to the challenge', body, gym),
      'Hi ' + p.first + ', you are signed up! Day 1 is ' + startText + '. Open the app: ' + site, RES27_MAIL_RESERVE, gym.contactEmail, res27FromName_(gym));
  }
  try {
    var row = res27FindRow_('participants', 'ID', p.id);
    if (row) res27UpdateRow_('participants', row._row, { 'Welcome Email': sent ? 'Sent' : res27Truthy_(cfg.welcome_email) ? 'NOT SENT (see Log)' : 'Off' });
  } catch (e) {}
  var notify = res27CleanEmail_(cfg.notify_email);
  if (notify) {
    res27Mail_(cfg, notify, 'New Resolutions sign-up: ' + p.first + ' ' + p.last + ' (' + p.type + ', ' + gym.short + ')',
      res27EmailFrame_(cfg, 'New sign-up', '<p style="margin:0">' + res27Html_(p.first + ' ' + p.last) + ' · ' + res27Html_(p.email) + '<br>' + res27Html_(gym.name) + ' · ' + res27Html_(p.type) +
        (p.type === 'Remote' ? ' · paying by ' + res27Html_(RES27_PAYMENTS[p.pay]) : '') + '<br>' + res27Html_(RES27_GOALS[p.setup.goal] || '') +
        ' · ' + res27Html_(p.shirt + ' ' + p.size) + '<br>' + res27Html_(res27ChecklistText_(p.setup)) + '</p>', gym),
      p.first + ' ' + p.last + ' signed up (' + p.type + ', ' + gym.name + ').', RES27_MAIL_RESERVE);
  }
  return sent;
}

/* ================================================================ email providers ==== */

// The provider's API key lives only in Script Properties (Kevin pastes it in the Apps Script
// project settings): never on the sheet, never in a log line or a reply.
var RES27_EMAIL_KEY_PROP = 'RES27_EMAIL_API_KEY';
var RES27_RESEND_URL = 'https://api.resend.com/emails';
var RES27_RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
var RES27_BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
var RES27_RESEND_BATCH = 100; // Resend takes up to 100 emails in one batch request
var RES27_BREVO_CHUNK = 50; // Brevo takes one email per request: 50 at a time through fetchAll
// UrlFetchApp has no timeout option (a request can take up to about a minute), and Apps Script
// stops a run at 6 minutes, so no new send starts after 4.5. ~400 emails take a few seconds.
var RES27_DAILY_BUDGET_MS = 270000;

/** email_provider: 'resend', 'brevo', 'mailapp', or '' (off, or anything else). */
function res27Provider_(cfg) {
  var p = String(cfg.email_provider || '').trim().toLowerCase();
  return p === 'resend' || p === 'brevo' || p === 'mailapp' ? p : '';
}

function res27EmailKey_() {
  return String(res27Prop_(RES27_EMAIL_KEY_PROP) || '').trim();
}

/**
 * The name members see on their emails (Kevin, 11/23/2026: "I'm good with all emails coming from
 * resolutions@kodacrossfitironview.com but I think the reply to should be different for each gym"):
 * one address for everyone, each gym's own name ("Koda OKC Resolutions") and its own Reply-To.
 */
function res27FromName_(gym) {
  return gym && gym.name ? res27CleanText_(gym.name + ' Resolutions', 60) : 'Koda Resolutions';
}

/**
 * The From line, "Koda OKC Resolutions <resolutions@…>". A name with a comma, period or another
 * mark that means something in an address line goes in quotes: unquoted, "Koda OKC, Oklahoma City
 * Resolutions <…>" reads as two addresses, and the provider would turn down every email that gym sends.
 */
function res27FromLine_(name, email) {
  var n = String(name || '').replace(/["\\\r\n]+/g, '').trim();
  if (!n) return email;
  return (/[()<>\[\]:;@,.]/.test(n) ? '"' + n + '"' : n) + ' <' + email + '>';
}

/** email_from as { name, email }: "Koda Resolutions <resolutions@x.com>" or a bare address. Null without an address. */
function res27Sender_(cfg) {
  var text = String(cfg.email_from || '').trim();
  var m = /^"?([^"<]*?)"?\s*<\s*([^<>\s]+)\s*>$/.exec(text);
  var email = res27CleanEmail_(m ? m[2] : text);
  if (!email) return null;
  var name = m ? res27CleanText_(m[1], 60) : '';
  return { name: name || 'Koda Resolutions', email: email };
}

/** Why emails can't go out through email_provider right now, in words for the Log ('' when they can). */
function res27ProviderProblem_(cfg) {
  var provider = res27Provider_(cfg);
  if (!provider) return 'email_provider is off';
  if (provider === 'mailapp') return '';
  if (!res27Sender_(cfg)) return 'email_from is blank (it needs an address, like Koda Resolutions <resolutions@kodacrossfitironview.com>)';
  if (!res27EmailKey_()) return 'no API key (add ' + RES27_EMAIL_KEY_PROP + ' in the Apps Script project’s Script Properties)';
  return '';
}

/** Text that came back from a provider (or UrlFetchApp), with the API key taken out, so it can be logged. */
function res27Scrub_(text, key) {
  text = String(text === null || text === undefined ? '' : text);
  return key ? text.split(key).join('[key]') : text;
}

function res27JsonPost_(headers, body) {
  return { method: 'post', contentType: 'application/json', headers: headers, payload: JSON.stringify(body), muteHttpExceptions: true };
}

/** A provider's answer as { ok, code, error, text }: 2xx is ok (text: its body); anything else carries the provider's own message. */
function res27FetchResult_(response, key) {
  var code = Number(response.getResponseCode()) || 0;
  var text = '';
  try {
    text = String(response.getContentText() || '');
  } catch (e) {}
  if (code >= 200 && code < 300) return { ok: true, code: code, error: '', text: text };
  var json = res27ParseJson_(text, null);
  var why = json ? json.message || json.error || json.name || json.code || text : text;
  if (typeof why !== 'string') why = JSON.stringify(why);
  return { ok: false, code: code, error: res27Scrub_(code + ' ' + why.replace(/\s+/g, ' ').trim(), key).slice(0, 300) };
}

/** One request; a network failure (no answer at all) comes back as { ok: false } too. */
function res27Fetch_(url, params, key) {
  try {
    return res27FetchResult_(UrlFetchApp.fetch(url, params), key);
  } catch (e) {
    return { ok: false, code: 0, error: res27Scrub_(String((e && e.message) || e), key).slice(0, 300) };
  }
}

/** One email (welcome, code, question) through Resend or Brevo: { ok, error }. */
function res27SendOne_(cfg, provider, m) {
  var key = res27EmailKey_();
  var sender = res27Sender_(cfg);
  if (provider === 'resend') {
    var item = { from: res27FromLine_(m.fromName || sender.name, sender.email), to: [m.to], subject: m.subject, html: m.html, text: m.text };
    if (m.replyTo) item.reply_to = m.replyTo;
    return res27Fetch_(RES27_RESEND_URL, res27JsonPost_({ Authorization: 'Bearer ' + key }, item), key);
  }
  var brevo = { sender: { name: m.fromName || sender.name, email: sender.email }, to: [{ email: m.to }], subject: m.subject, htmlContent: m.html };
  if (m.text) brevo.textContent = m.text;
  if (m.replyTo) brevo.replyTo = { email: m.replyTo };
  return res27Fetch_(RES27_BREVO_URL, res27JsonPost_({ 'api-key': key, accept: 'application/json' }, brevo), key);
}

/**
 * The emails a permissive Resend batch turned down, from its 2xx answer ({ data: [...], errors:
 * [{ index, message }] }), as { index: 'its error' }. Indexes that aren't a place in the batch are
 * left out; an answer that isn't JSON means none were turned down (the request itself went through).
 */
function res27BatchRefused_(text, size, key) {
  var out = {};
  var json = res27ParseJson_(text, null);
  var errors = json && Array.isArray(json.errors) ? json.errors : [];
  errors.forEach(function (e) {
    var at = e ? Number(e.index) : NaN;
    if (!(at >= 0 && at < size && Math.floor(at) === at)) return;
    var why = String((e && (e.message || e.name)) || 'turned down by Resend').replace(/\s+/g, ' ').trim();
    out[at] = res27Scrub_('refused: ' + why, key).slice(0, 300);
  });
  return out;
}

/**
 * A request whose answer never came, so its emails may well have gone out (the 11/24/2026 review):
 * no answer at all (UrlFetchApp threw: a timeout, a dropped connection), or a gateway's 502 or 504
 * (the gateway lost Resend's answer, not Resend the emails). From Resend also a 409: that batch's
 * Idempotency-Key was used before, so an earlier send of the very same batch reached Resend.
 */
function res27NoAnswer_(res, resend) {
  return !res.ok && (res.code === 0 || res.code === 502 || res.code === 504 || (resend === true && res.code === 409));
}

/**
 * The Idempotency-Key on one Resend batch of a gym's daily email: the gym, the date, and a hash of
 * the batch's people (sorted, so the same people make the same key; Resend takes 256 characters,
 * too few for 100 IDs). Resend keeps a key for 24 hours and answers the same key with the same
 * emails with its first answer, sending nothing again. So a batch whose answer was lost, or turned
 * down after Resend had taken it, can't reach anyone twice when it goes again whole (Kevin's 11/24
 * decision on the review). A forced send (email-send --force) is meant as a second copy, so its
 * keys are new ones: with the day's own keys Resend would hand back the first answer and send nothing.
 */
function res27BatchKey_(gymId, date, ids, force) {
  var hash = res27Hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, res27Bytes_(ids.slice().sort().join(',')))).slice(0, 32);
  return 'res27/' + gymId + '/' + date + '/' + (force ? 'again-' + res27RandomHex_(4) + '/' : '') + hash;
}

/**
 * A send's batches (up to size emails each), with their Idempotency-Keys when opts has the gym and
 * date: [{ messages, key }]. opts.groups sends those groups as they are (each in batches of size): an
 * unconfirmed batch that goes again whole keeps the key it had (res27SendDay_), so Resend can tell
 * it's the same batch; anything else gets the key of its own people.
 */
function res27DailyChunks_(messages, opts, size) {
  var o = opts || {};
  var out = [];
  (o.groups || [{ messages: messages }]).forEach(function (g) {
    for (var i = 0; i < g.messages.length; i += size) {
      var part = g.messages.slice(i, i + size);
      var key = '';
      if (o.gymId && o.date) {
        key = g.key && part.length === g.messages.length ? g.key : res27BatchKey_(o.gymId, o.date, part.map(function (m) {
          return m.id || m.to;
        }), o.force === true);
      }
      out.push({ messages: part, key: key });
    }
  });
  return out;
}

/**
 * Sends a day's emails (from res27DailyBatch_) through email_provider: Resend in batches of up to
 * 100, Brevo one request per person, 50 at a time through fetchAll, mailapp one by one (tests only).
 * Resend's batches are "permissive" (the 11/23/2026 review): by default Resend turns down a whole
 * batch, a whole gym, for one bad address in it; permissive sends the rest and lists the ones it
 * refused by their place in the batch (errors[].index), and only those count as failed.
 * A request that comes back with an error counts its emails as failed (the provider's own error),
 * and they're sent again later. Except when no answer came (res27NoAnswer_: a timeout, a 502 or
 * 504; the 11/24/2026 review): those emails may have gone out, so they're "unconfirmed", never sent
 * again on their own (a second copy for a whole batch is worse than Kevin looking at Resend's log
 * first), and the Log row and the alarm name them.
 * started: when the run began (the time budget is for the whole run).
 * opts (the daily email's own sends; a send to one address has none): gymId and date put an
 * Idempotency-Key on each Resend batch (res27BatchKey_), force makes them new, and groups sends
 * batches as they went before (res27DailyChunks_).
 * { sent, failed, failures: [{ email, error }], failedIds: [person IDs, for the retry],
 *   unconfirmed, unconfirmedTo: [{ email, error }], unconfirmedChunks: [{ key, ids }] (each batch,
 *   to go again as it was) }.
 */
function res27DeliverDaily_(cfg, messages, started, opts) {
  var o = opts || {};
  var provider = res27Provider_(cfg);
  var key = res27EmailKey_();
  var sender = res27Sender_(cfg);
  var out = { sent: 0, failed: 0, failures: [], failedIds: [], unconfirmed: 0, unconfirmedTo: [], unconfirmedChunks: [] };
  var fail = function (list, error) {
    list.forEach(function (m) {
      out.failed += 1;
      out.failures.push({ email: m.to, error: error });
      if (m.id) out.failedIds.push(m.id);
    });
  };
  var unsure = function (list, batchKey, error) {
    if (!list.length) return;
    out.unconfirmed += list.length;
    list.forEach(function (m) {
      out.unconfirmedTo.push({ email: m.to, error: error });
    });
    out.unconfirmedChunks.push({ key: batchKey || '', ids: list.map(function (m) {
      return m.id;
    }).filter(Boolean) });
  };
  var t0 = started || Date.now();
  var late = function () {
    return Date.now() - t0 > RES27_DAILY_BUDGET_MS;
  };
  // Mail apps show an unsubscribe button from this header; it opens the same page as the link.
  var headers = function (m) {
    return { 'List-Unsubscribe': '<' + m.unsubscribe + '>' };
  };
  var problem = res27ProviderProblem_(cfg);
  if (problem) {
    fail(messages, problem);
  } else if (provider === 'resend') {
    var chunks = res27DailyChunks_(messages, o, RES27_RESEND_BATCH);
    for (var i = 0; i < chunks.length; i++) {
      var chunk = chunks[i].messages;
      if (late()) {
        fail(chunk, 'ran out of time');
        continue;
      }
      if (i) Utilities.sleep(600); // Resend takes 2 requests a second
      var head = { Authorization: 'Bearer ' + key, 'x-batch-validation': 'permissive' };
      if (chunks[i].key) head['Idempotency-Key'] = chunks[i].key;
      var params = res27JsonPost_(head, chunk.map(function (m) {
        var item = { from: res27FromLine_(m.fromName || sender.name, sender.email), to: [m.to], subject: m.subject, html: m.html, text: m.text, headers: headers(m) };
        if (m.replyTo) item.reply_to = m.replyTo;
        return item;
      }));
      var res = res27Fetch_(RES27_RESEND_BATCH_URL, params, key);
      if (res.code === 429) {
        Utilities.sleep(2000);
        res = res27Fetch_(RES27_RESEND_BATCH_URL, params, key);
      }
      if (res27NoAnswer_(res, true)) {
        unsure(chunk, chunks[i].key, res.error);
        continue;
      }
      if (!res.ok) {
        fail(chunk, res.error);
        continue;
      }
      var refused = res27BatchRefused_(res.text, chunk.length, key);
      chunk.forEach(function (m, k) {
        if (Object.prototype.hasOwnProperty.call(refused, k)) fail([m], refused[k]);
        else out.sent += 1;
      });
    }
  } else if (provider === 'brevo') {
    // (Brevo has no Idempotency-Key: an unconfirmed one there is resent as a new email.)
    var parts = res27DailyChunks_(messages, null, RES27_BREVO_CHUNK);
    for (var j = 0; j < parts.length; j++) {
      var part = parts[j].messages;
      if (late()) {
        fail(part, 'ran out of time');
        continue;
      }
      var requests = part.map(function (m) {
        var body = { sender: { name: m.fromName || sender.name, email: sender.email }, to: [m.name ? { email: m.to, name: m.name } : { email: m.to }], subject: m.subject, htmlContent: m.html, textContent: m.text, headers: headers(m) };
        if (m.replyTo) body.replyTo = { email: m.replyTo };
        var request = res27JsonPost_({ 'api-key': key, accept: 'application/json' }, body);
        request.url = RES27_BREVO_URL;
        return request;
      });
      var responses = null;
      try {
        responses = UrlFetchApp.fetchAll(requests);
      } catch (e) {
        // No answer for any of them, though Brevo may have taken some (fetchAll gives none back).
        unsure(part, '', res27Scrub_(String((e && e.message) || e), key).slice(0, 300));
        continue;
      }
      var lost = [];
      var lostWhy = '';
      responses.forEach(function (r, k) {
        var one = res27FetchResult_(r, key);
        if (one.ok) {
          out.sent += 1;
        } else if (res27NoAnswer_(one, false)) {
          lost.push(part[k]);
          lostWhy = lostWhy || one.error;
        } else {
          fail([part[k]], one.error);
        }
      });
      unsure(lost, '', lostWhy);
    }
  } else {
    messages.forEach(function (m) {
      if (late()) return fail([m], 'ran out of time');
      try {
        var left = MailApp.getRemainingDailyQuota();
        if (left < RES27_MAIL_RESERVE) return fail([m], 'Gmail daily email limit (' + left + ' left)');
        var message = { to: m.to, subject: m.subject, htmlBody: m.html, body: m.text, name: m.fromName || 'Koda Resolutions' };
        if (m.replyTo) message.replyTo = m.replyTo;
        MailApp.sendEmail(message);
        out.sent += 1;
      } catch (e) {
        fail([m], String((e && e.message) || e).slice(0, 200));
      }
    });
  }
  return out;
}

/* ================================================================ the daily email ==== */

/*
 * Kevin, 11/23/2026: "I'd like to do an automated email each day for each person with the details
 * of that day and a link to the website to log the previous days scores. It would be the same
 * email for all participants if they are doing a good job logging their scores, but could say if
 * they are overdue on entering their scores from previous day. I would like the email to go out at
 * 3am each day. and it should say that they are overdue if they haven't entered their points for
 * the day 2 days before. Like 3am on a wednesday would say they are overdue if they didn't enter
 * monday's points."
 * Each gym's email goes at email_hour (3 AM) in that gym's own time zone: Iron View's at 3 AM
 * Denver, the other five at 3 AM Chicago. adminEmailTriggers puts in one trigger that runs every
 * hour (11/23/2026 review: a daily trigger per zone gave Iron View no second chance when Google
 * skipped its run, and an email_hour change silently stopped every email until the triggers were
 * made again). Each run sends for every gym whose own clock is past email_hour and before noon
 * and whose day hasn't gone out yet, so the first run after 3:00 sends it (between 3 and 4 AM),
 * a missed run is made up by the next one, and the extra runs do nothing (res27DailyEmails).
 * Whoever it fails for is sent it again by the next runs that morning. Whoever it may have reached
 * (no answer came back: res27NoAnswer_) isn't sent it again on its own, and Kevin is told to check
 * Resend's log first (11/24/2026 review: a lost answer had made the next run send the whole gym a
 * second copy). Each Resend batch also carries an Idempotency-Key (res27BatchKey_), so a batch sent
 * again within 24 hours goes out once. A forced send by hand (--force) is the only deliberate second copy.
 */

/** The hour the daily email goes out, 0 to 11 (it's only ever sent before noon). */
function res27EmailHour_(cfg) {
  var h = parseInt(cfg.email_hour, 10);
  return h >= 0 && h <= 11 ? h : 3;
}

/** A gym's own date and hour at ms (default now). */
function res27GymNow_(gym, ms) {
  var at = new Date(ms === undefined ? res27Now_() : ms);
  return { date: Utilities.formatDate(at, gym.tz, 'yyyy-MM-dd'), hour: Number(Utilities.formatDate(at, gym.tz, 'H')) };
}

/**
 * Where someone's own challenge is on a date (the beta for Test accounts while one is set), or null
 * when there's no email for them that day: before Day 1, and after the last day except the Monday
 * right after it (the last week can still be filled in until that midnight).
 */
function res27DailyProgram_(cfg, person, date) {
  var dates = res27ProgramDates_(cfg, person);
  var n = res27DiffDays_(dates.start, date) + 1;
  var lastOpen = 7 * Math.ceil(dates.length / 7) + 1;
  if (n < 1 || (n > dates.length && n !== lastOpen)) return null;
  return { start: dates.start, length: dates.length, n: n, after: n > dates.length, beta: !!dates.beta };
}

/**
 * The day for someone's Overdue box, or null. Kevin: overdue "if they haven't entered their points
 * for the day 2 days before", so the day two before today with nothing logged at all (no answers).
 * Only a day of their challenge that can still be filled in: on a Tuesday that's Sunday, locked at
 * Monday midnight, so Tuesday emails never have one.
 */
function res27DailyOverdue_(person, prog, date) {
  var day = res27AddDays_(date, -2);
  var n = res27DiffDays_(prog.start, day) + 1;
  if (n < 1 || n > prog.length) return null;
  if (day < res27OpenFrom_(prog.start, date)) return null;
  var e = person.history && person.history[day];
  if (e && e.a && Object.keys(e.a).length) return null;
  // Its week locks at midnight on the first day after that week (a Monday).
  var locks = res27AddDays_(prog.start, Math.ceil(n / 7) * 7);
  return { date: day, n: n, locksToday: locks === date };
}

/** About, cut to a couple of lines for the email (the whole thing is in the app). */
function res27Short_(text, max) {
  text = String(text || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  var cut = text.slice(0, max);
  var space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '') + '…';
}

/** The parts of a day's email that are the same for everyone at a gym on one program (the real challenge, or the beta). */
function res27DailyShared_(cfg, gym, prog, date, content) {
  var m = gym.mail;
  var n = prog.n;
  var weeks = Math.ceil(prog.length / 7);
  var tag = prog.beta ? '[Beta] ' : '';
  var box = 'background:#F0F2F5;border-radius:12px;padding:12px 16px;margin:0 0 12px';
  var kicker = 'font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#5F6B7A;margin:0 0 4px';
  var top = '';
  var rest = '';
  var textTop = [];
  var textRest = [];
  var subject;
  var heading;
  if (!prog.after) {
    var c = content[n] || {};
    var title = c.title || '';
    var where = 'Day ' + n + ' of ' + prog.length + ' · Week ' + (c.week || Math.ceil(n / 7)) + (c.theme ? ': ' + c.theme : '');
    subject = tag + 'Day ' + n + (title ? ' · ' + title : '') + ' · Koda Resolutions';
    heading = title || 'Day ' + n;
    top = '<p style="' + kicker + ';margin-bottom:14px">' + res27Html_(where) + '</p>';
    textTop.push(where, heading);
    var about = res27Short_(c.about, 280);
    if (about) {
      rest += '<p style="margin:0 0 14px">' + res27Html_(about) + '</p>';
      textRest.push(about);
    }
    if (c.action) {
      rest += '<div style="' + box + '"><p style="' + kicker + '">Today’s action</p>' + res27Html_(c.action).replace(/\n/g, '<br>') + '</div>';
      textRest.push('Today’s action: ' + c.action);
    }
    if (c.bonus) {
      var bp = c.bonusPoints || RES27_POINTS.bonus;
      var bonusLabel = 'Bonus task (+' + bp + ' point' + (bp === 1 ? '' : 's') + ')';
      rest += '<div style="' + box + '"><p style="' + kicker + '">' + bonusLabel + '</p>' + res27Html_(c.bonus) + '</div>';
      textRest.push(bonusLabel + ': ' + c.bonus);
    }
    // The button opens Today in the app, where the gym's own video plays (or a beta stand-in).
    var hasVideo = res27VideosFor_(c.video, gym.id).length > 0 || !!(prog.beta && c.standIn);
    var todayUrl = res27SiteLink_(cfg, gym.id, '#/today');
    var watch = hasVideo ? 'Watch today’s video' : 'Open today in the app';
    if (todayUrl) {
      rest += '<p style="margin:18px 0 12px">' + res27MailButton_(gym, todayUrl, watch) + '</p>';
      textRest.push(watch + ': ' + todayUrl);
    }
  } else {
    subject = tag + 'Last day to log week ' + weeks + ' · Koda Resolutions';
    heading = 'Last day to log week ' + weeks;
    var ended = prog.beta ? 'The beta test ended yesterday.' : 'The challenge ended yesterday: great work!';
    top = '<p style="margin:0 0 14px">' + ended + '</p>';
    textTop.push(heading, ended);
  }
  // Day 1 has no yesterday to log.
  var logUrl = n > 1 ? res27SiteLink_(cfg, gym.id, '#/day/' + res27AddDays_(date, -1)) : '';
  if (logUrl) {
    rest += '<p style="margin:0 0 12px"><a href="' + res27Html_(logUrl) + '" style="display:inline-block;background:#FFFFFF;color:' + m.ink + ';border:2px solid ' + m.button +
      ';text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">Log yesterday’s points</a></p>';
    textRest.push('Log yesterday’s points: ' + logUrl);
  }
  // Each Monday from the second one (and the Monday after the end), the week before locks at midnight.
  if (n > 1 && (n - 1) % 7 === 0) {
    var line = 'Last week locks tonight at midnight: make sure every day is filled in.';
    rest += '<p style="margin:16px 0 0;padding:10px 14px;border-radius:10px;background:#F0F2F5;font-weight:600">' + line + '</p>';
    textRest.push(line);
  }
  return { subject: subject, heading: heading, top: top, rest: rest, textTop: textTop.join('\n'), textRest: textRest.join('\n\n'), weekday: res27WeekdayName_(prog.start) };
}

/** One person's email: the shared parts, their own Overdue box (if any), and their own stop link. */
function res27DailyMessage_(cfg, gym, shared, p, email, late) {
  var off = res27SiteLink_(cfg, gym.id, '#/email-off?u=' + encodeURIComponent(p.id) + '&s=' + res27EmailOffSig_(p.id));
  var box = '';
  var boxText = '';
  if (late) {
    var dayUrl = res27SiteLink_(cfg, gym.id, '#/day/' + late.date);
    var weekday = res27WeekdayName_(late.date);
    var line1 = 'You haven’t logged ' + res27DayText_(late.date) + ' (Day ' + late.n + ') yet.';
    var line2 = 'You can still fill it in until ' + (late.locksToday ? 'tonight' : shared.weekday) + ' at midnight.';
    box = '<div style="background:#FFF4E0;border:1px solid #F2C57C;border-radius:12px;padding:14px 16px;margin:0 0 16px;color:#7A4B00"><b>' + res27Html_(line1) + '</b> ' + res27Html_(line2) +
      (dayUrl ? '<br>' + res27MailButton_(gym, dayUrl, 'Log ' + res27Html_(weekday), true) : '') + '</div>';
    boxText = line1 + ' ' + line2 + (dayUrl ? '\nLog ' + weekday + ': ' + dayUrl : '');
  }
  var foot = off ? '<br><a href="' + res27Html_(off) + '" style="color:#5F6B7A;text-decoration:underline">Stop these daily emails</a>' : '';
  var html = res27EmailFrame_(cfg, shared.heading, shared.top + box + shared.rest, gym, foot);
  var text = [shared.textTop, boxText, shared.textRest].filter(Boolean).join('\n\n') +
    '\n\n--\n' + [gym.mail.label || gym.name, gym.address, gym.contactEmail].filter(Boolean).join(' · ') + (off ? '\nStop these daily emails: ' + off : '');
  return {
    to: email,
    name: res27CleanText_((p.first || '') + ' ' + (p.last || ''), 80),
    id: p.id,
    subject: shared.subject,
    html: html,
    text: text,
    overdue: !!late,
    overdueDate: late ? late.date : '',
    // A gym Contact Email with a typo would get every one of that gym's emails turned down, so
    // replies then go to Settings' contact_email instead.
    replyTo: res27CleanEmail_(gym.contactEmail) || res27CleanEmail_(cfg.contact_email),
    fromName: res27FromName_(gym),
    unsubscribe: off,
  };
}

/**
 * Everything for one gym's daily email on one date (the gym's own date), from one read of the
 * sheet: who gets it and each person's message. Everyone on Participants at that gym, not Removed,
 * Daily Email not Off, whose own challenge is on that day (res27DailyProgram_), and whose address an
 * email service takes. Someone whose address it wouldn't take (one from before the stricter check,
 * like "jess@gmail.com.", or a typo on the sheet) is left out, so their address can't put the
 * gym's batch at risk, and listed in skipped: the day's Log row and `live.js gyms` name them, so
 * Kevin can fix it (11/24/2026 review: they used to drop out with nothing said).
 * { gym, date, messages, overdue (how many have the box), subject, shared (the common parts),
 *   skipped: [{ id, email, name }] }.
 */
function res27DailyBatch_(cfg, gym, date, people) {
  var content = res27DaysContent_();
  var groups = {};
  var first = null;
  var messages = [];
  var skipped = [];
  var overdue = 0;
  (people || []).forEach(function (p) {
    if (!p || !p.id || p.gym !== gym.id) return;
    if (/removed/i.test(p.status) || !p.dailyEmail) return;
    var prog = res27DailyProgram_(cfg, p, date);
    if (!prog) return;
    var email = res27CleanEmail_(p.email);
    if (!email) {
      skipped.push({ id: p.id, email: String(p.email || '').trim(), name: res27CleanText_((p.first || '') + ' ' + (p.last || ''), 80) });
      return;
    }
    var key = prog.start + ':' + prog.length;
    var shared = groups[key] || (groups[key] = res27DailyShared_(cfg, gym, prog, date, content));
    first = first || shared;
    var late = res27DailyOverdue_(p, prog, date);
    if (late) overdue += 1;
    messages.push(res27DailyMessage_(cfg, gym, shared, p, email, late));
  });
  return { gym: gym.id, date: date, messages: messages, overdue: overdue, subject: first ? first.subject : '', shared: first, skipped: skipped };
}

/** Up to max addresses for a Log line or the alarm: "a@x.com, b@x.com and 3 more". */
function res27Names_(emails, max) {
  var list = (emails || []).filter(Boolean);
  if (list.length <= max) return list.join(', ');
  return list.slice(0, max).join(', ') + ' and ' + (list.length - max) + ' more';
}

/**
 * The hourly trigger (adminEmailTriggers puts it in; it can also be run from the script editor).
 * Sends for every gym whose own clock is past email_hour and before noon and whose day hasn't gone
 * out yet, so the first run after 3:00 there sends it, and a run Google skipped is made up by the
 * next one that morning. If none of a gym's emails went out, its day is given back and the next
 * run sends it again; if some did, the people it failed for are kept and the next runs that
 * morning send to just them. A run sends a day again only to people it failed for, never to people
 * it may have reached: those whose batch got no answer are only named (res27DeliverDaily_). Any failure, any
 * unconfirmed batch, or an error makes the run fail once its Log rows are written, so Google
 * emails Kevin about it, with the command (and --date) to see and send it by hand.
 * Does nothing unless daily_email is TRUE and a provider is set: then it logs one "Daily email
 * skipped" line per gym per day instead (when someone would have got it).
 */
function res27DailyEmails() {
  RES27_REQ_ = {};
  try {
    return res27RunDaily_(Date.now());
  } catch (err) {
    var detail = String((err && err.stack) || err);
    try {
      console.error('res27 daily email: ' + detail);
    } catch (ignore) {}
    try {
      res27Log_('(daily email)', 'Error in the daily email', detail.slice(0, 1500));
    } catch (ignore) {}
    throw err; // so the trigger shows as failed (Google emails the script owner about those)
  } finally {
    RES27_REQ_ = {};
  }
}

function res27RunDaily_(started) {
  var cfg = res27Settings_();
  var props = PropertiesService.getScriptProperties();
  var hour = res27EmailHour_(cfg);
  var blocked = res27Truthy_(cfg.daily_email) ? res27ProviderProblem_(cfg) : 'daily_email is FALSE in Settings';
  var people = null;
  var out = [];
  var errors = [];
  res27Gyms_().list.forEach(function (gym) {
    var row = { gym: gym.id, date: '', status: '' };
    out.push(row);
    // One gym's trouble (a lock that won't come free, say) doesn't stop the others.
    try {
      res27RunDailyGym_(cfg, props, hour, blocked, gym, row, started, function () {
        people = people || res27AllPeople_();
        return people;
      });
    } catch (err) {
      row.status = 'error';
      row.error = String((err && err.message) || err).slice(0, 300);
      errors.push(gym.short + ': ' + row.error);
    }
  });
  // Then the run fails, so it's on the Log (res27DailyEmails) and Google tells the script owner: a
  // gym that hit an error, and a gym whose emails didn't all go out (its Log row says who). Each
  // command names the day (--date), so it still means that day when Kevin reads it the next
  // morning (11/24/2026 review: without it, the next day's send answered "already sent").
  out.forEach(function (row) {
    if (!(row.failed > 0) && !(row.unconfirmed > 0) && !row.problem) return;
    var g = res27GymDef_(row.gym).short;
    var cmd = 'node dev/live.js email-send ' + row.gym + ' --date=' + row.date;
    var total = (row.sent || 0) + (row.failed || 0) + (row.unconfirmed || 0);
    if (row.problem) {
      errors.push(g + ': ' + ((row.failed || 0) + (row.unconfirmed || 0)) + ' of ' + total + ' not sent (couldn’t note it for the next run: ' + row.problem + '; see ' + cmd + '; the Log tab lists them)');
      return;
    }
    if (row.failed > 0) {
      var next = row.lastRun ? 'that was the last run before noon, so send it by hand: ' + cmd + ' --yes sends it to ' + (row.status === 'failed' ? 'everyone' : 'them')
        : row.status === 'failed' ? 'nothing went out, so the next run sends it again' : 'the next runs until noon send it to them again';
      errors.push(g + ': ' + row.failed + ' of ' + total + ' not sent (' + next + '; the Log tab lists them)');
    }
    if (row.unconfirmed > 0) {
      errors.push(g + ': ' + row.unconfirmed + ' of ' + total + ' got no answer from Resend, so they may have it, and nothing sends it to them again on its own (check Resend’s log, then ' + cmd +
        ' --yes sends it again; within 24 hours Resend skips anyone that batch already reached): ' + row.unconfirmedNames);
    }
  });
  if (errors.length) throw new Error('The daily email failed for ' + errors.join('; ') + '. The other gyms: ' + JSON.stringify(out));
  return { ok: true, gyms: out };
}

/**
 * One gym's part of a daily run (row says what happened): 'not due', 'already sent', 'nobody',
 * 'skipped', 'sent' (some may have failed: row.failed, or got no answer: row.unconfirmed),
 * 'retried' (sent to the people the morning's send failed for), or 'failed' (nothing went out, so
 * the day was given back for the next run). row.skipped: how many were left out for their address.
 */
function res27RunDailyGym_(cfg, props, hour, blocked, gym, row, started, everyone) {
  var now = res27GymNow_(gym);
  row.date = now.date;
  // Lists of people waiting for a resend that nobody can use any more go first, at any hour.
  res27ExpireRetries_(cfg, props, gym, now.date, everyone);
  if (now.hour < hour || now.hour >= 12) return (row.status = 'not due');
  // Gone out already, unless some of it failed: then it goes again to the people it failed for
  // (never on its own to the unconfirmed ones: they may have it).
  var done = props.getProperty('RES27_DAILY_' + gym.id) === now.date;
  var retry = done ? res27Retry_(props, gym.id, now.date) : null;
  if (done && !(retry && retry.ids.length)) return (row.status = 'already sent');
  var batch = res27DailyBatch_(cfg, gym, now.date, everyone());
  var waiting = done ? res27OnlyIds_(batch.messages, retry.ids) : batch.messages;
  if (!waiting.length) {
    if (done) {
      res27TakeRetry_(gym.id, now.date, false); // they've turned it off or left since: nobody to resend to
      return (row.status = 'already sent');
    }
    // Nobody to send it to. If some were left out for their address, the day still gets its Log
    // row naming them, once (the day is marked); otherwise there's nothing to note.
    if (blocked || !batch.skipped.length) return (row.status = 'nobody');
  }
  if (blocked) {
    row.status = 'skipped';
    row.why = blocked;
    if (props.getProperty('RES27_DAILY_SKIP_' + gym.id) !== now.date) {
      props.setProperty('RES27_DAILY_SKIP_' + gym.id, now.date);
      res27Log_('(daily email)', 'Daily email skipped: ' + gym.short + ' · ' + now.date, blocked + ' (' + waiting.length + ' would have got it)');
    }
    return row.status;
  }
  // The runs come every hour, so one before 11 there has another after it before noon.
  var nextRun = now.hour < 11;
  var result = res27SendDay_(cfg, gym, now.date, batch, { mode: done ? 'retry' : 'all', claim: true, started: started, nextRun: nextRun });
  if (!result) return (row.status = 'already sent'); // another run got there first
  row.status = result.released ? 'failed' : done ? 'retried' : 'sent';
  row.sent = result.sent;
  // A forced send by hand that went to everyone meanwhile covers whoever this one missed.
  row.failed = result.superseded ? 0 : result.failed;
  row.unconfirmed = result.superseded ? 0 : result.unconfirmed;
  if (row.unconfirmed) {
    row.unconfirmedNames = res27Names_(result.unconfirmedTo.map(function (u) {
      return u.email;
    }), 10);
  }
  row.overdue = result.overdue;
  if (!done && batch.skipped.length) row.skipped = batch.skipped.length;
  if (result.superseded) row.superseded = true;
  if (result.problem) row.problem = result.problem;
  if (row.failed && !nextRun) row.lastRun = true; // no run after this one sends it today
  return row.status;
}

/**
 * Sends one gym's emails for a date and keeps the books, for the hourly run and a send by hand:
 *   mode 'all': everyone on the list. With claim (it's the gym's today) the day is marked as sent
 *     first (res27ClaimDay_; refused if it already was, unless force), and if none of it went out
 *     (and none of it may have) the day is given back (res27SettleDay_), so the next run sends it again.
 *   mode 'retry': only the people waiting on that day's list, taken under the lock
 *     (res27TakeRetry_) so two runs can't both send to them: the hourly run takes the ones it
 *     failed for; a send by hand (opts.hand) the unconfirmed ones too, each batch as it went, so its
 *     Idempotency-Key is the one Resend saw (if that batch did go out, Resend sends nothing again).
 * Whoever it fails for, or gets no answer for, is kept on that date's list (res27SettleDay_) for the
 * next run or `email-send <gym> --date=<day> --yes`. Writes the day's Log row, even when that
 * bookkeeping fails once the emails are out (result.problem says why). opts.nextRun: an hourly run
 * still comes this morning for whoever it fails for (the Log row says so, or to send it by hand).
 * { sent, failed, failures, failedIds, unconfirmed, unconfirmedTo, unconfirmedChunks, overdue,
 *   released, superseded, mode, problem }, or null when another run took the day or the people to
 * resend to first.
 */
function res27SendDay_(cfg, gym, date, batch, opts) {
  var claim = null;
  var token = null; // the day's claim when this send began (res27SettleDay_)
  var groups = null;
  var again = false; // unconfirmed ones in this resend
  var messages = batch.messages;
  if (opts.mode === 'retry') {
    var took = res27TakeRetry_(gym.id, date, opts.hand === true);
    if (!took) return null;
    token = took.token;
    groups = [{ messages: res27OnlyIds_(batch.messages, took.ids) }];
    took.unconfirmed.forEach(function (u) {
      var part = res27OnlyIds_(batch.messages, u.ids);
      again = again || part.length > 0;
      // Its own key only if it's the very same batch (someone who left the list since makes it another).
      if (part.length) groups.push({ messages: part, key: part.length === u.ids.length ? u.key : '' });
    });
    messages = [];
    groups.forEach(function (g) {
      messages = messages.concat(g.messages);
    });
  } else {
    if (opts.claim) {
      claim = res27ClaimDay_(gym.id, date, opts.force === true);
      if (!claim) return null;
      token = claim.token;
    }
    // Everyone is getting it now: the ones waiting for a resend too, unconfirmed or not.
    res27TakeRetry_(gym.id, date, true);
  }
  var result = res27DeliverDaily_(cfg, messages, opts.started || Date.now(), { gymId: gym.id, date: date, force: opts.mode === 'all' && opts.force === true, groups: groups });
  result.mode = opts.mode;
  result.overdue = messages.filter(function (m) {
    return m.overdue;
  }).length;
  result.released = false;
  result.superseded = false;
  result.problem = '';
  // The emails are out: from here on, trouble (the lock busy, say) is reported, not thrown, so the
  // Log row below is still written.
  try {
    var how = res27SettleDay_(gym.id, date, claim, token, messages.length, result);
    result.released = how === 'released';
    result.superseded = how === 'superseded';
  } catch (err) {
    result.problem = String((err && err.message) || err).slice(0, 200);
  }
  // Each note's command names the day (--date): a list waits for its own day's send by hand.
  var byHand = 'email-send ' + gym.id + ' --date=' + date + ' --yes';
  var notes = [];
  if (opts.note) notes.push(opts.note);
  if (opts.mode === 'retry') notes.push('sent again to the ones it failed for' + (again ? ' and the unconfirmed ones' : ''));
  if (result.superseded) {
    notes.push('a forced send by hand went to everyone meanwhile, so nobody is kept for a resend');
  } else if (!result.problem) {
    if (result.released) notes.push(opts.nextRun ? 'nothing went out, so the next run sends it again' : 'nothing went out: send it by hand (' + byHand + ')');
    else if (result.failed) notes.push('the ' + result.failed + ' it failed for are kept: ' + (opts.nextRun ? 'the next run before noon sends it to them' : 'send it by hand (' + byHand + ')'));
    if (result.unconfirmed) notes.push('the ' + result.unconfirmed + ' unconfirmed got no answer from Resend, so they may have it: check Resend’s log, then ' + byHand);
  }
  if (result.problem) notes.push('couldn’t note who to send it to again (' + result.problem + '): see email-send ' + gym.id + ' --date=' + date);
  var skipped = opts.mode === 'all' ? batch.skipped || [] : [];
  if (skipped.length) notes.push(skipped.length + ' skipped, address not valid');
  res27LogDaily_(gym, date, result, result.overdue, notes.join(' · '), skipped);
  return result;
}

// Next to the mark (RES27_DAILY_<gym>, the date), the token of the send that claimed that day.
var RES27_CLAIM_PROP = 'RES27_DAILY_CLAIM_';

/**
 * Marks a gym's day as sent (Script Properties RES27_DAILY_<gym> = its date) under the script lock,
 * before anything is sent: a second trigger, or a run from the editor, that starts meanwhile sees
 * it and stops. Each claim also gets a random token (RES27_DAILY_CLAIM_<gym>), so a send can tell
 * whether the day is still its own claim when it's done (res27SettleDay_). Null if it was already
 * marked (unless force), else { prev: what the mark was before, token }.
 */
function res27ClaimDay_(gymId, date, force) {
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var prev = props.getProperty('RES27_DAILY_' + gymId);
    if (!force && prev === date) return null;
    var token = res27RandomHex_(8);
    props.setProperty('RES27_DAILY_' + gymId, date);
    props.setProperty(RES27_CLAIM_PROP + gymId, token);
    return { prev: prev, token: token };
  } finally {
    lock.releaseLock();
  }
}

/**
 * After a send, under the script lock: gives the day back if nothing went out on its first send
 * (and nothing may have: none unconfirmed), or keeps whoever it failed for, or got no answer for,
 * on that date's list. Unless a forced send by hand claimed the day after this one began (token:
 * the claim then; null for an earlier day's send, which claims nothing): that one went to everyone
 * on the day's list, so this one's misses have it, and its mark mustn't be given back (11/24/2026
 * review: a failed run's release undid a forced send's mark, and the next run sent the gym a
 * second copy). A day given back keeps everyone it failed for on its list, so a send by hand on a
 * later day still reaches just them. 'released', 'superseded' or 'kept'.
 */
function res27SettleDay_(gymId, date, claim, token, tried, result) {
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var markKey = 'RES27_DAILY_' + gymId;
    var marked = props.getProperty(markKey) === date;
    if (token !== null && marked && (props.getProperty(RES27_CLAIM_PROP + gymId) || '') !== token) return 'superseded';
    if (claim && tried && marked && !result.sent && !result.unconfirmed && claim.prev !== date) {
      if (claim.prev) props.setProperty(markKey, claim.prev);
      else props.deleteProperty(markKey);
      props.deleteProperty(RES27_CLAIM_PROP + gymId);
      res27AddRetry_(props, gymId, date, result.failedIds, []);
      return 'released';
    }
    if (result.failedIds.length || result.unconfirmedChunks.length) res27AddRetry_(props, gymId, date, result.failedIds, result.unconfirmedChunks);
    return 'kept';
  } finally {
    lock.releaseLock();
  }
}

// The people a gym's send for one date failed for, or got no answer for: Script Properties
// RES27_DAILY_RETRY_<gym>_<date> = {"ids":["R…"],"unconfirmed":[{"key":"res27/…","ids":["R…"]}]}.
// One list per gym per date (11/24/2026 review: one list per gym, the latest day's, let the next
// morning's send delete the day before's without a word), so `email-send <gym> --date=<day> --yes`
// reaches just them on any later day. ids: sent again by the hourly runs that morning;
// unconfirmed: each batch that got no answer, only ever sent again by hand.
var RES27_RETRY_PROP = 'RES27_DAILY_RETRY_';
// A list waits this many days for a send by hand, then it's dropped, with a Log line (res27ExpireRetries_).
var RES27_RETRY_DAYS = 7;

function res27RetryKey_(gymId, date) {
  return RES27_RETRY_PROP + gymId + '_' + date;
}

/** A gym's list for a date, { date, ids, unconfirmed: [{ key, ids }] }, or null when nobody is on it. */
function res27Retry_(props, gymId, date) {
  var r = res27ParseJson_(props.getProperty(res27RetryKey_(gymId, date)), null);
  if (!r || typeof r !== 'object') return null;
  var ids = Array.isArray(r.ids) ? r.ids.map(String) : [];
  var unconfirmed = (Array.isArray(r.unconfirmed) ? r.unconfirmed : []).filter(function (u) {
    return u && Array.isArray(u.ids) && u.ids.length;
  }).map(function (u) {
    return { key: String(u.key || ''), ids: u.ids.map(String) };
  });
  if (!ids.length && !unconfirmed.length) return null;
  return { date: date, ids: ids, unconfirmed: unconfirmed };
}

/** Everyone on a list's unconfirmed batches. */
function res27UnconfirmedIds_(list) {
  var out = [];
  ((list && list.unconfirmed) || []).forEach(function (u) {
    out = out.concat(u.ids);
  });
  return out;
}

/** Every list a gym has, oldest day first. */
function res27Retries_(props, gymId) {
  var prefix = RES27_RETRY_PROP + gymId + '_';
  return props.getKeys().filter(function (k) {
    return k.indexOf(prefix) === 0 && res27IsDayKey_(k.slice(prefix.length));
  }).map(function (k) {
    return k.slice(prefix.length);
  }).sort().map(function (date) {
    return res27Retry_(props, gymId, date);
  }).filter(Boolean);
}

/**
 * Takes a gym's list for date under the script lock, so two sends can't both resend to it: all of
 * it (whole), or only the ones it failed for (the hourly run; the unconfirmed ones stay). Returns
 * { ids, unconfirmed, token } (token: the day's claim, when the day is marked as sent; null for an
 * earlier day), or null when there's nobody to take.
 */
function res27TakeRetry_(gymId, date, whole) {
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var r = res27Retry_(props, gymId, date);
    if (!r || (!whole && !r.ids.length)) return null;
    var token = props.getProperty('RES27_DAILY_' + gymId) === date ? props.getProperty(RES27_CLAIM_PROP + gymId) || '' : null;
    if (whole || !r.unconfirmed.length) props.deleteProperty(res27RetryKey_(gymId, date));
    else props.setProperty(res27RetryKey_(gymId, date), JSON.stringify({ ids: [], unconfirmed: r.unconfirmed }));
    return { ids: r.ids, unconfirmed: whole ? r.unconfirmed : [], token: token };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Adds to a gym's list for date (under the script lock, which the caller holds): ids to send it to
 * again, and unconfirmed batches ({ key, ids }). Someone in an unconfirmed batch is left out of ids:
 * they may have it, so only a send by hand goes to them.
 */
function res27AddRetry_(props, gymId, date, ids, unconfirmed) {
  var r = res27Retry_(props, gymId, date) || { ids: [], unconfirmed: [] };
  var batches = r.unconfirmed.concat(unconfirmed || []);
  var seen = {};
  batches.forEach(function (u) {
    u.ids.forEach(function (id) {
      seen[id] = true;
    });
  });
  var all = r.ids.concat(ids || []).filter(function (id) {
    if (seen[id]) return false;
    seen[id] = true;
    return true;
  });
  if (all.length || batches.length) props.setProperty(res27RetryKey_(gymId, date), JSON.stringify({ ids: all, unconfirmed: batches }));
  else props.deleteProperty(res27RetryKey_(gymId, date));
}

/**
 * Why a list for date can't be used any more on today (the gym's date), or '' while it can: the
 * challenge (or the beta) its day belongs to is over (past the Monday after its last day: nothing
 * can be logged any more, and no email goes out), or it has waited RES27_RETRY_DAYS days.
 */
function res27RetryOver_(cfg, date, today) {
  var real = res27ProgramDates_(cfg, null);
  var realLast = res27AddDays_(real.start, 7 * Math.ceil(real.length / 7));
  var beta = res27BetaDates_(cfg);
  var inReal = date >= real.start && date <= realLast;
  var inBeta = !!beta && date >= beta.start && date <= beta.lastOpen;
  if (!inReal && !inBeta) return 'that day isn’t part of the challenge or a beta any more';
  var last = inReal && (!inBeta || realLast >= beta.lastOpen) ? realLast : beta.lastOpen;
  if (today > last) return inReal ? 'the challenge is over' : 'the beta is over';
  if (res27DiffDays_(date, today) > RES27_RETRY_DAYS) return 'it waited ' + RES27_RETRY_DAYS + ' days and nobody sent it by hand';
  return '';
}

/**
 * Drops a gym's lists that can't be used any more (res27RetryOver_), each with a Log line naming
 * who never got that day (11/24/2026 review: a list used to disappear without a word). Every hourly
 * run does this for every gym, so the lists end with the challenge (and the beta).
 */
function res27ExpireRetries_(cfg, props, gym, today, everyone) {
  res27Retries_(props, gym.id).forEach(function (r) {
    var why = res27RetryOver_(cfg, r.date, today);
    if (!why) return;
    var took = res27TakeRetry_(gym.id, r.date, true); // (a send by hand may have just taken it)
    if (!took) return;
    var emails = {};
    everyone().forEach(function (p) {
      if (p && p.id) emails[p.id] = p.email;
    });
    var name = function (id) {
      return emails[id] || id;
    };
    var unsure = res27UnconfirmedIds_(took);
    var n = took.ids.length + unsure.length;
    var detail = [took.ids.length ? 'never got it: ' + took.ids.map(name).join(', ') : '', unsure.length ? 'unconfirmed (no answer from Resend, so they may have it): ' + unsure.map(name).join(', ') : ''];
    try {
      res27Log_('(daily email)', 'Daily email · ' + gym.short + ' · ' + r.date + ' · dropped the list of ' + n + ' waiting for a resend: ' + why, detail.filter(Boolean).join(' | ').slice(0, 1500));
    } catch (ignore) {}
  });
}

/** The messages for the people with these IDs. */
function res27OnlyIds_(messages, ids) {
  var want = {};
  (ids || []).forEach(function (id) {
    want[id] = true;
  });
  return messages.filter(function (m) {
    return want[m.id] === true;
  });
}

/**
 * One Log row per gym per run ("Daily email · OKC · 2027-01-20 · 63 sent, 0 failed, 4 overdue";
 * "…, 3 unconfirmed, …" when some got no answer), with the addresses in Detail: the failed ones by
 * their error, the unconfirmed ones, and the people skipped for an address that isn't valid
 * (skipped: from res27DailyBatch_). No row per person.
 */
function res27LogDaily_(gym, date, result, overdue, note, skipped) {
  var counts = result.sent + ' sent, ' + result.failed + ' failed' + (result.unconfirmed ? ', ' + result.unconfirmed + ' unconfirmed' : '') + ', ' + overdue + ' overdue';
  var what = 'Daily email · ' + gym.short + ' · ' + date + ' · ' + counts + (note ? ' · ' + note : '');
  var byError = {};
  var order = [];
  var add = function (label, email) {
    if (!byError[label]) {
      byError[label] = [];
      order.push(label);
    }
    byError[label].push(email);
  };
  result.failures.forEach(function (f) {
    add(f.error, f.email);
  });
  (result.unconfirmedTo || []).forEach(function (u) {
    add('unconfirmed, no answer (' + u.error + ')', u.email);
  });
  (skipped || []).forEach(function (s) {
    add('skipped, address not valid (fix Email on Participants and Accounts)', s.email || s.name + ' (no address)');
  });
  var detail = order.map(function (e) {
    return e + ': ' + byError[e].join(', ');
  }).join(' | ');
  if (detail.length > 1500) detail = detail.slice(0, 1499) + '…';
  try {
    res27Log_('(daily email)', what, detail);
  } catch (ignore) {}
}

/**
 * Run this once from the script editor (and click Allow) after `clasp push` and before deploying
 * 1.8.0 (the editor only asks for what the pushed code uses): the daily email needs two new
 * permissions for the hyrox project, connecting to an outside service (UrlFetchApp: the email
 * provider) and managing its triggers (ScriptApp: the hourly run). It sends nothing and changes
 * nothing. If 1.8.0 was ever deployed first, running this fixes it (no new deployment needed).
 */
function res27AuthorizeEmail() {
  var triggers = ScriptApp.getProjectTriggers().length;
  UrlFetchApp.getRequest(RES27_RESEND_URL); // builds a request without sending it
  return 'Email permissions are on (' + triggers + ' trigger' + (triggers === 1 ? '' : 's') + ' in this project).';
}

/* ================================================================ stop the daily emails ==== */

var RES27_EMAIL_OFF_PER_HOUR = 120; // the whole app, like the other public actions' limits

/** The signature in someone's "Stop these daily emails" link: the first 24 hex of HMAC-SHA256(secret, 'email-off:' + id). */
function res27EmailOffSig_(id) {
  return res27Hex_(Utilities.computeHmacSha256Signature(res27Bytes_('email-off:' + id), res27Bytes_(res27Secret_()))).slice(0, 24);
}

/**
 * "Stop these daily emails" (no sign-in). The link in each email opens a page with a button (so an
 * email scanner that opens links can't turn them off), and the button sends { u: id, s: signature }.
 * A wrong signature and an ID that isn't anyone's get the same answer, so it can't be used to find
 * out who has an account. Turned back on from the Profile.
 */
function res27EmailOff_(d) {
  var hour = Utilities.formatDate(new Date(res27Now_()), RES27_TZ, 'yyyy-MM-dd-HH');
  if (res27Bump_('res27:off:' + hour, 3700) > RES27_EMAIL_OFF_PER_HOUR) {
    res27Fail_('Lots of people are doing this right now. Please try again in a little while, or turn the emails off in your Profile.', 'busy');
  }
  var bad = 'That link didn’t work. You can turn the daily emails off in your Profile instead.';
  var id = String(d.u || '').trim();
  var sig = String(d.s || '').trim().toLowerCase();
  if (!/^R[A-Z0-9]{6}$/.test(id) || !/^[0-9a-f]{24}$/.test(sig) || sig !== res27EmailOffSig_(id)) res27Fail_(bad, 'bad_link');
  var row = res27FindRow_('participants', 'ID', id);
  if (!row || res27Headers_('participants').indexOf('Daily Email') < 0) res27Fail_(bad, 'bad_link');
  var first = String(row['First Name'] || '');
  if (!res27DailyOn_(row['Daily Email'])) return { ok: true, first: first };
  res27AssertRow_('participants', row._row, 'ID', id);
  res27UpdateRow_('participants', row._row, { 'Daily Email': 'Off' });
  try {
    res27Log_(String(row['Email'] || id), 'Daily email', 'On → Off (the link in the email)');
  } catch (e) {}
  return { ok: true, first: first };
}

/* ================================================================ admin ==== */

function res27EnsureTab_(book, tabKey) {
  var def = RES27_TABS[tabKey];
  var sheet = book.getSheetByName(def.name);
  if (!sheet) sheet = book.insertSheet(def.name);
  var lastColumn = sheet.getLastColumn();
  var existing = lastColumn ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (h) {
    return String(h).trim();
  }) : [];
  // A tab that still has a retired column (Check-ins' Max Points) and no rows yet takes the current
  // layout, keeping any column Kevin added after it. Every other tab only ever gains columns.
  var retired = def.retired || [];
  if (lastColumn && sheet.getLastRow() <= 1 && existing.some(function (h) { return retired.indexOf(h) >= 0; })) {
    var extra = existing.filter(function (h) {
      return h && retired.indexOf(h) < 0 && def.headers.indexOf(h) < 0;
    });
    var layout = def.headers.concat(extra);
    sheet.getRange(1, 1, 1, lastColumn).clearContent();
    if (lastColumn > 1) sheet.showColumns(1, lastColumn);
    sheet.getRange(1, 1, 1, layout.length).setValues([layout]);
    existing = layout;
  }
  // A new column with a neighbor (Participants Gym after Type and Daily Email after Welcome Email,
  // Check-ins Gym after Team) is put in right after it on a sheet that already has columns; every
  // other new column goes at the end. The app reads columns by header, so the place only matters
  // to Kevin.
  var after = def.after || {};
  def.headers.forEach(function (h) {
    if (existing.indexOf(h) >= 0 || !after[h]) return;
    var at = existing.indexOf(after[h]);
    if (at < 0) return;
    sheet.insertColumnsAfter(at + 1, 1);
    sheet.getRange(1, at + 2).setValue(h);
    // An inserted column takes on its left neighbor's dropdown, if Kevin gave it one (Type's
    // Member/Remote/Test would flag every "Iron View" in Gym): the new column starts without.
    if (sheet.getMaxRows() > 1) sheet.getRange(2, at + 2, sheet.getMaxRows() - 1, 1).clearDataValidations();
    existing.splice(at + 1, 0, h);
  });
  var missing = def.headers.filter(function (h) {
    return existing.indexOf(h) < 0;
  });
  if (missing.length) {
    // After the last column in use, blank headers included: counting only the filled-in headers
    // (as before 11/23/2026) put the first new header over one of Kevin's own columns whenever row 1
    // had a blank cell (a spacer, or a cleared header).
    var start = existing.length + 1;
    var need = start + missing.length - 1;
    if (need > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), need - sheet.getMaxColumns());
    sheet.getRange(1, start, 1, missing.length).setValues([missing]);
  }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) {
    return String(h).trim();
  });
  // A few empty columns after the last one, so there's room for a column Kevin adds (a new tab
  // has 26, and Participants uses 25 since the gyms).
  var room = headers.length + 4;
  if (sheet.getMaxColumns() < room) sheet.insertColumnsAfter(sheet.getMaxColumns(), room - sheet.getMaxColumns());
  // Formats only reach rows that exist, so make room for the whole challenge up front
  // (about 200 people x 42 days of check-ins).
  var wantRows = { checkins: 12000, log: 4000 }[tabKey] || 1000;
  if (sheet.getMaxRows() < wantRows) sheet.insertRowsAfter(sheet.getMaxRows(), wantRows - sheet.getMaxRows());
  var maxRows = Math.max(sheet.getMaxRows(), 2);
  headers.forEach(function (h, i) {
    var col = i + 1;
    // Only the tab's own columns: a column Kevin added (dates of his own, say) keeps his format.
    if (def.headers.indexOf(h) < 0) return;
    if (def.dates.indexOf(h) >= 0) sheet.getRange(2, col, maxRows - 1, 1).setNumberFormat('m/d/yyyy h:mm am/pm');
    else if (def.numbers.indexOf(h) >= 0) sheet.getRange(2, col, maxRows - 1, 1).setNumberFormat('0');
    else if ((def.decimals || []).indexOf(h) >= 0) sheet.getRange(2, col, maxRows - 1, 1).setNumberFormat('0.0');
    else if (!(tabKey === 'settings' && h === 'Value') && !(tabKey === 'days' && h === 'Date')) sheet.getRange(2, col, maxRows - 1, 1).setNumberFormat('@');
    if (def.widths[h]) sheet.setColumnWidth(col, def.widths[h]);
  });
  var head = sheet.getRange(1, 1, 1, headers.length);
  head.setFontWeight('bold').setBackground('#0C1A2B').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  def.hidden.forEach(function (h) {
    var col = headers.indexOf(h) + 1;
    if (col) sheet.hideColumns(col);
  });
  if (def.hiddenTab) sheet.hideSheet();
  return sheet;
}

/** v1.0 kept Setup/History on Participants. Move any of it to App Data and drop the old columns. */
function res27MigrateAppData_(book) {
  var people = book.getSheetByName(RES27_TABS.participants.name);
  var app = book.getSheetByName(RES27_TABS.appdata.name);
  var lastColumn = people.getLastColumn();
  if (!lastColumn) return 0;
  var headers = people.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (h) {
    return String(h).trim();
  });
  var setupCol = headers.indexOf('Setup (app data)') + 1;
  var historyCol = headers.indexOf('History (app data)') + 1;
  if (!setupCol && !historyCol) return 0;
  var moved = 0;
  if (people.getLastRow() > 1) {
    var rows = people.getRange(2, 1, people.getLastRow() - 1, lastColumn).getValues();
    var have = {};
    if (app.getLastRow() > 1) app.getRange(2, 1, app.getLastRow() - 1, 1).getValues().forEach(function (r) {
      have[String(r[0]).trim()] = true;
    });
    rows.forEach(function (r) {
      var id = String(r[headers.indexOf('ID')]).trim();
      if (!id || have[id]) return;
      var setup = res27ParseJson_(setupCol ? r[setupCol - 1] : '', {});
      var history = res27ParseJson_(historyCol ? r[historyCol - 1] : '', {});
      app.appendRow([id, res27SetupJson_(setup, id), res27HistoryJson_(history, id), new Date(res27Now_())]);
      moved += 1;
    });
  }
  [historyCol, setupCol].filter(Boolean).sort(function (a, b) {
    return b - a;
  }).forEach(function (col) {
    people.deleteColumn(col);
  });
  return moved;
}

function res27AdminSetup_(d) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty(RES27_SHEET_PROP);
    var book = null;
    var created = false;
    if (id) {
      try {
        book = SpreadsheetApp.openById(id);
      } catch (e) {
        book = null;
      }
    }
    if (!book) {
      book = SpreadsheetApp.create(String(d.sheetName || 'Koda Resolutions 2027'));
      props.setProperty(RES27_SHEET_PROP, book.getId());
      created = true;
    }
    RES27_REQ_ = { book: book };
    try {
      book.setSpreadsheetTimeZone(RES27_TZ);
    } catch (e) {}
    var newFinishers = !book.getSheetByName(RES27_TABS.finishers.name);
    ['participants', 'checkins', 'days', 'finishers', 'settings', 'gyms', 'accounts', 'questions', 'log', 'appdata'].forEach(function (k) {
      res27EnsureTab_(book, k);
    });
    var migrated = res27MigrateAppData_(book);
    var blank = book.getSheetByName('Sheet1');
    if (blank && book.getSheets().length > 1 && blank.getLastRow() === 0) book.deleteSheet(blank);

    // Settings: add any missing keys (never overwrite Kevin's values unless asked), drop retired ones.
    var settings = book.getSheetByName(RES27_TABS.settings.name);
    var values = settings.getDataRange().getValues();
    for (var r = values.length - 1; r >= 1; r--) {
      if (RES27_RETIRED_SETTINGS.indexOf(String(values[r][0]).trim()) >= 0) settings.deleteRow(r + 1);
    }
    values = settings.getDataRange().getValues();
    var have = {};
    for (var i = 1; i < values.length; i++) have[String(values[i][0]).trim()] = i + 1;
    var overrides = d.settings && typeof d.settings === 'object' ? d.settings : {};
    // A misspelled setting is reported back (dev/live.js setting fails on it) instead of quietly ignored.
    var unknown = Object.keys(overrides).filter(function (k) {
      return !RES27_SETTINGS_DEFAULTS.some(function (row) {
        return row[0] === k;
      });
    });
    RES27_SETTINGS_DEFAULTS.forEach(function (row) {
      var value = Object.prototype.hasOwnProperty.call(overrides, row[0]) ? overrides[row[0]] : row[1];
      if (!have[row[0]]) settings.appendRow([row[0], res27SafeCell_(value), row[2]]);
      else {
        settings.getRange(have[row[0]], 3).setValue(row[2]);
        if (Object.prototype.hasOwnProperty.call(overrides, row[0])) settings.getRange(have[row[0]], 2).setValue(res27SafeCell_(value));
      }
    });

    // Finishers: a sample row so the format is obvious, only on a brand-new tab (setup runs again
    // with every settings change, e.g. `live.js beta off`: a tab Kevin emptied stays empty).
    var fin = book.getSheetByName(RES27_TABS.finishers.name);
    if (newFinishers && fin.getLastRow() < 2) fin.appendRow([1, 'Example finisher (replace me)', 'e.g. 3 rounds: 10 burpees, 15 KB swings, 200m run', '']);

    res27Secret_();
    if (d.adminKey && String(d.adminKey).length >= 12) props.setProperty(RES27_ADMIN_PROP, String(d.adminKey));
    var bonusFixed = res27MigrateBonusPoints_(book, props);
    CacheService.getScriptCache().removeAll(['res27:settings', 'res27:days', 'res27:gyms']);
    // After the settings above, so Iron View's row starts from the values just stored.
    RES27_REQ_ = { book: book };
    var gymsSeeded = res27SeedGyms_();
    var gymsFilled = res27FillBlankGyms_();
    CacheService.getScriptCache().removeAll(['res27:settings', 'res27:days', 'res27:gyms']);
    SpreadsheetApp.flush();
    var seeded = 0;
    if (Array.isArray(d.days) && d.days.length) {
      seeded = res27WriteDays_(book, d.days, d.overwriteDays === true);
    }
    return { ok: true, created: created, sheetId: book.getId(), url: book.getUrl(), seededDays: seeded, migrated: migrated, bonusFixed: bonusFixed, unknown: unknown, gymsSeeded: gymsSeeded, gymsFilled: gymsFilled };
  } finally {
    lock.releaseLock();
  }
}

/**
 * The Gyms tab gets a row for each gym that has none: name, city, address and time zone, and for
 * Iron View also its details from Settings, where they were before there were six gyms (Kevin
 * fills in the other gyms). A row that's there is never changed, so typed values stay. Returns
 * how many rows were added (six the first time).
 */
function res27SeedGyms_() {
  var cfg = res27Settings_();
  var have = {};
  res27AllRows_('gyms').forEach(function (r) {
    var id = res27GymId_(r['Gym']);
    if (id) have[id] = true;
  });
  var added = 0;
  RES27_GYMS.forEach(function (g) {
    if (have[g.id]) return;
    res27AppendRow_('gyms', res27GymSeed_(g, cfg));
    added += 1;
  });
  return added;
}

/**
 * Blank Gym cells on Participants become "Iron View": everyone who signed up before 11/23/2026
 * did so at Iron View, the only gym then. Written as one column, under setup's lock. Logged.
 */
function res27FillBlankGyms_() {
  var sheet = res27Sheet_('participants');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var idCol = res27Col_('participants', 'ID');
  var gymCol = res27Col_('participants', 'Gym');
  var ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  var range = sheet.getRange(2, gymCol, lastRow - 1, 1);
  var gyms = range.getValues();
  var filled = 0;
  gyms.forEach(function (r, i) {
    if (String(ids[i][0]).trim() && !String(r[0]).trim()) {
      r[0] = res27GymDef_(RES27_DEFAULT_GYM).short;
      filled += 1;
    }
  });
  if (filled) {
    range.setValues(gyms);
    res27Log_('(setup)', 'Filled blank gyms', filled + ' participant' + (filled === 1 ? '' : 's') + ' with no Gym set to ' + res27GymDef_(RES27_DEFAULT_GYM).short + ' (everyone before 11/23/2026 signed up at Iron View)');
  }
  return filled;
}

/**
 * 11/10/2026: a bonus task went from 4 points to 1 on top of the day's score out of 10. Days seeded
 * before that say 4; this changes those cells to 1 once (a script property remembers it ran), so a
 * bonus Kevin sets to 4 later is left alone. Only Bonus Points cells change.
 */
function res27MigrateBonusPoints_(book, props) {
  if (props.getProperty('RES27_BONUS_IS_1')) return 0;
  var sheet = book.getSheetByName(RES27_TABS.days.name);
  var changed = 0;
  if (sheet && sheet.getLastRow() > 1) {
    var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) {
      return String(h).trim();
    });
    var taskCol = head.indexOf('Bonus Task') + 1;
    var pointsCol = head.indexOf('Bonus Points') + 1;
    if (taskCol && pointsCol) {
      var count = sheet.getLastRow() - 1;
      var tasks = sheet.getRange(2, taskCol, count, 1).getValues();
      var points = sheet.getRange(2, pointsCol, count, 1);
      var values = points.getValues();
      values.forEach(function (r, i) {
        if (String(tasks[i][0]).trim() && Number(r[0]) === 4) {
          r[0] = 1;
          changed += 1;
        }
      });
      if (changed) points.setValues(values);
    }
  }
  props.setProperty('RES27_BONUS_IS_1', '1');
  return changed;
}

/**
 * Writes the Days tab from a list of {day, week, theme, title, video, category, about, action, bonus,
 * bonusPoints, presenter, notes, ref}. Rewriting a filled tab keeps the video links already pasted
 * in, matched by title, so a link follows its video even when a day moves.
 */
function res27WriteDays_(book, days, overwrite) {
  var sheet = book.getSheetByName(RES27_TABS.days.name);
  if (sheet.getLastRow() > 1 && !overwrite) return 0;
  var keepVideo = {};
  if (sheet.getLastRow() > 1) {
    var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) {
      return String(h).trim();
    });
    var titleAt = head.indexOf('Title');
    var videoAt = head.indexOf('Video URL');
    if (titleAt >= 0 && videoAt >= 0) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, head.length).getValues().forEach(function (r) {
        var title = String(r[titleAt]).trim();
        var video = String(r[videoAt]).trim();
        if (title && video) keepVideo[title] = video;
      });
    }
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
  RES27_REQ_.keptVideos = 0;
  RES27_REQ_.headers = {};
  RES27_REQ_.sheets = {};
  var cfg = res27Settings_();
  var start = res27ParseDateKey_(cfg.start_date) || '2027-01-18';
  var headers = res27Headers_('days');
  var rows = days.slice(0, 120).map(function (x) {
    var n = parseInt(x.day, 10);
    var kept = !x.video && keepVideo[String(x.title || '').trim()];
    if (kept) RES27_REQ_.keptVideos += 1;
    var obj = {
      'Day': n,
      'Date': new Date(res27KeyToUtc_(res27AddDays_(start, n - 1)) + 12 * 3600000),
      'Week': parseInt(x.week, 10) || Math.ceil(n / 7),
      'Week Theme': x.theme || '',
      'Title': x.title || '',
      'Video URL': x.video || kept || '',
      'Category': x.category || '',
      'About': x.about || '',
      'Action Item': x.action || '',
      'Bonus Task': x.bonus || '',
      'Bonus Points': x.bonus ? parseInt(x.bonusPoints, 10) || RES27_POINTS.bonus : '',
      'Presenter': x.presenter || '',
      'Notes (not shown)': x.notes || '',
      '2026 Video (not shown)': x.ref || '',
    };
    return headers.map(function (h) {
      return Object.prototype.hasOwnProperty.call(obj, h) ? res27SafeCell_(obj[h]) : '';
    });
  });
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    var dateCol = headers.indexOf('Date') + 1;
    if (dateCol) sheet.getRange(2, dateCol, rows.length, 1).setNumberFormat('ddd m/d/yyyy');
  }
  CacheService.getScriptCache().remove('res27:days');
  return rows.length;
}

function res27AdminSeedDays_(d) {
  if (!Array.isArray(d.days) || !d.days.length) res27Fail_('No days to write.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var seeded = res27WriteDays_(res27Book_(), d.days, d.overwrite === true);
    return { ok: true, seededDays: seeded, keptVideos: RES27_REQ_.keptVideos || 0 };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Changes someone's Type (Member, Remote or Test). Moving someone off Test (Kevin back to Member
 * after the beta) also clears their practice days: days saved outside the real challenge's dates
 * (the beta week) come out of their history and the Check-ins tab, and Points / Days Logged are
 * counted again, so their row starts from zero like everyone else's. Days inside the real challenge
 * are never touched. clearPractice: true does the same for someone already Member or Remote (a Type
 * cell changed by hand); it's safe to repeat. Each change goes on the Log tab.
 */
function res27AdminSetType_(d) {
  var email = res27LookupEmail_(d.email);
  // (not d.type: the hyrox router already uses type for routing)
  var type = String(d.participantType || '');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var was;
  var cleared = null;
  try {
    RES27_REQ_.headers = {};
    var row = res27FindRow_('participants', 'Email', email);
    if (!row) res27Fail_('No participant with that email.');
    if (['Member', 'Remote', 'Test'].indexOf(type) < 0) res27Fail_('participantType must be Member, Remote or Test.');
    res27AssertRow_('participants', row._row, 'Email', email);
    was = String(row['Type'] || '').trim();
    var update = { 'Type': type };
    if (type !== 'Test' && (was === 'Test' || d.clearPractice === true)) {
      cleared = res27ClearPractice_(row, type, email);
      update['Points'] = cleared.points;
      update['Days Logged'] = cleared.daysLogged;
    }
    res27UpdateRow_('participants', row._row, update);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  // On the Log tab, so after a beta it's clear who signed up for real before being moved onto it.
  if (was !== type || (cleared && cleared.days)) {
    try {
      res27Log_(email, 'Changed type', (was || '(blank)') + ' → ' + type + (cleared && cleared.days ? ' · cleared ' + cleared.days + ' practice day' + (cleared.days === 1 ? '' : 's') : ''));
    } catch (e) {}
  }
  return { ok: true, was: was, type: type, cleared: cleared };
}

/**
 * For someone leaving Test: drops their days dated outside the real challenge (a beta's practice
 * days) from App Data and the Check-ins tab, and returns their totals counted again for the new
 * type. Runs inside the caller's lock. If the rows don't line up (an ID column sorted on its own
 * would clear someone else's days), it stops before writing anything and says why.
 */
function res27ClearPractice_(row, type, email) {
  var id = String(row['ID']).trim();
  if (!id) res27Fail_('That participant’s row has no ID. Nothing was changed.', 'mismatch');
  // The Accounts tab says who an ID belongs to (the app writes it; nobody edits it by hand).
  var acct = res27FindRow_('accounts', 'ID', id);
  if (acct && String(acct['Email']).trim().toLowerCase() !== email) {
    res27Fail_('The Participants row for ' + email + ' has ID ' + id + ', but the Accounts tab gives that ID to ' + String(acct['Email']).trim() + '. Was the ID column sorted on its own? Undo the sort, then try again. Nothing was changed.', 'mismatch');
  }
  var app = res27FindRow_('appdata', 'ID', id);
  var person;
  try {
    person = res27Person_(row, app);
  } catch (e) {
    res27Fail_(String((e && e.message) || e) + ' Nothing was changed.', 'mismatch');
  }
  person.type = type;
  var program = res27Program_(res27Settings_(), person, null);
  var outside = function (date) {
    return res27IsDayKey_(date) && (date < program.start || date > program.end);
  };
  var dropped = Object.keys(person.history).filter(outside);
  dropped.forEach(function (date) {
    delete person.history[date];
  });
  if (dropped.length && app) {
    res27AssertRow_('appdata', app._row, 'ID', id);
    res27UpdateRow_('appdata', app._row, { 'History': res27HistoryJson_(person.history, id), 'Updated': new Date(res27Now_()) });
  }
  // That person's Check-ins rows (Key = ID|date) dated outside the challenge, from the bottom up.
  var rows = res27AllRows_('checkins')
    .filter(function (r) {
      var key = String(r['Key']).trim();
      return String(r['ID']).trim() === id && key.indexOf(id + '|') === 0 && outside(key.slice(id.length + 1));
    })
    .sort(function (a, c) {
      return c._row - a._row;
    });
  rows.forEach(function (r) {
    res27Sheet_('checkins').deleteRow(r._row);
  });
  var totals = res27Totals_(person.history, program);
  return { days: dropped.length, checkins: rows.length, points: totals.points, daysLogged: totals.days };
}

/**
 * Deletes every participant whose Type is Test, with their account, app data, check-ins and
 * questions (for clearing practice runs and beta testers before launch). With `email`, only that
 * Test participant. Guards for the after-beta cleanup (Kevin, 11/11):
 *   dryRun: true   only lists who would go (and any rows that don't line up), deleting nothing.
 *   keep: [emails] never deleted, nor any row carrying their IDs, even if Test (Kevin's own account).
 *   ids: [...]     refuses, deleting nothing, unless exactly those IDs would go (the dry run's list).
 *   expect: n      the same, by count.
 * Every row is checked before anything is deleted. The Accounts tab says who each ID belongs to; if
 * any row of those people doesn't line up (a tab sorted on one column, so an ID sits next to someone
 * else's data), nothing is deleted and the reply says which rows. Each person goes on the Log tab
 * before their rows are deleted.
 */
function res27AdminPurgeTests_(d) {
  var only = '';
  if (d.email !== undefined && d.email !== null && d.email !== '') {
    only = res27LookupEmail_(d.email);
    if (!only) res27Fail_('That email isn’t valid.');
  }
  var keep = {};
  [].concat(d.keep === undefined || d.keep === null ? [] : d.keep).forEach(function (e) {
    var clean = res27LookupEmail_(e);
    if (!clean) res27Fail_('A keep email isn’t valid: ' + e);
    keep[clean] = true;
  });
  var expect = d.expect === undefined || d.expect === null || d.expect === '' ? null : Number(d.expect);
  if (expect !== null && !(expect >= 0 && Math.floor(expect) === expect)) res27Fail_('expect must be a whole number.');
  var want = d.ids === undefined || d.ids === null ? null : [].concat(d.ids).map(function (x) {
    return String(x).trim();
  }).filter(Boolean).sort();
  var has = function (o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  };
  var lower = function (v) {
    return String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    RES27_REQ_.headers = {};
    var participants = res27AllRows_('participants');
    var accounts = res27AllRows_('accounts');
    var owners = {}; // ID → the emails the Accounts tab gives it
    var keepIds = {}; // every ID a kept email has, on Participants or Accounts
    accounts.forEach(function (r) {
      var id = String(r['ID']).trim();
      if (!id) return;
      (owners[id] = owners[id] || []).push(lower(r['Email']));
      if (keep[lower(r['Email'])]) keepIds[id] = true;
    });
    var rowsWithId = {}; // ID → how many Participants rows have it
    var kept = [];
    participants.forEach(function (r) {
      var id = String(r['ID']).trim();
      if (id) rowsWithId[id] = (rowsWithId[id] || 0) + 1;
      if (keep[lower(r['Email'])]) {
        if (id) keepIds[id] = true;
        kept.push({ email: lower(r['Email']), type: String(r['Type']).trim() });
      }
    });
    // How each person came to be Test, so the list can flag anyone who is neither a beta sign-up
    // nor moved there with set-type (a Type column sorted on its own looks just like a move).
    var movedToTest = {};
    if (res27Book_().getSheetByName(RES27_TABS.log.name)) {
      res27AllRows_('log').forEach(function (r) {
        if (String(r['What']).trim() === 'Changed type' && /→ Test$/.test(String(r['Detail']).trim())) movedToTest[lower(r['Who'])] = true;
      });
    }
    var ids = {}; // ID → email, for each Test participant being removed
    var people = []; // who that is, for the dry run, the reply and the Log
    var problems = [];
    participants.forEach(function (r) {
      var email = lower(r['Email']);
      if (keep[email] || String(r['Type']).trim() !== 'Test') return;
      if (only && email !== only) return;
      var id = String(r['ID']).trim();
      if (!id) return;
      var where = 'Participants row ' + r._row + ' (' + email + ', ID ' + id + ')';
      if (keepIds[id]) problems.push(where + ': that ID belongs to a kept account');
      else if (rowsWithId[id] > 1) problems.push(where + ': ' + rowsWithId[id] + ' Participants rows have that ID');
      else if (has(owners, id) && (owners[id].length > 1 || owners[id][0] !== email)) problems.push(where + ': the Accounts tab gives that ID to ' + owners[id].join(', ') + ' (a sorted ID column, or an email changed on only one of the two tabs)');
      ids[id] = email;
      var signed = r['Signed Up'];
      var notes = String(r['Notes'] || '');
      people.push({
        id: id,
        name: (String(r['First Name'] || '') + ' ' + String(r['Last Name'] || '')).trim(),
        email: email,
        signedUp: res27IsDate_(signed) ? Utilities.formatDate(signed, RES27_TZ, 'MMM d, h:mm a') : String(signed || ''),
        points: Number(r['Points']) || 0,
        days: Number(r['Days Logged']) || 0,
        payment: String(r['Payment'] || '').trim(),
        paid: res27Truthy_(r['Paid']),
        notes: notes,
        how: /^Beta test sign-up/.test(notes) ? 'beta sign-up' : movedToTest[email] ? 'moved to Test' : '',
      });
    });
    if (only && !people.length) res27Fail_(keep[only] ? 'That email is on the keep list.' : 'No Test participant with that email.');
    // Every other row of those IDs must agree it belongs to them, so a tab sorted on one column
    // (IDs no longer next to their data) can't take someone else's rows with it.
    var belongs = {
      checkins: function (r, id) {
        return String(r['Key']).trim().indexOf(id + '|') === 0;
      },
      accounts: function (r, id) {
        return lower(r['Email']) === ids[id];
      },
      appdata: function (r, id) {
        var setup = res27ParseJson_(r['Setup'], {});
        var history = res27ParseJson_(r['History'], {});
        return (!setup.id || String(setup.id) === id) && (!history._id || String(history._id) === id);
      },
      participants: function (r, id) {
        return lower(r['Email']) === ids[id];
      },
      questions: function (r, id) {
        return lower(r['Email']) === ids[id];
      },
    };
    var tabs = ['checkins', 'accounts', 'appdata', 'questions', 'participants'];
    var plan = {};
    var leftAlone = []; // Questions rows that don't match: a record, never anyone's identity, so kept
    tabs.forEach(function (tab) {
      plan[tab] = [];
      if (!res27Book_().getSheetByName(RES27_TABS[tab].name)) return; // a tab setup hasn't added yet
      var rows = tab === 'participants' ? participants : tab === 'accounts' ? accounts : res27AllRows_(tab);
      rows.forEach(function (r) {
        var id = String(r['ID']).trim();
        if (!has(ids, id)) return;
        if (belongs[tab](r, id)) plan[tab].push(r);
        else if (tab === 'questions') leftAlone.push('Questions row ' + r._row + ' (ID ' + id + ', ' + lower(r['Email']) + ') kept: its email isn’t ' + ids[id]);
        else problems.push(RES27_TABS[tab].name + ' row ' + r._row + ' (ID ' + id + (tab === 'accounts' ? ', ' + lower(r['Email']) : '') + ') doesn’t match the rest of its row');
      });
    });
    if (d.dryRun === true) return { ok: true, dryRun: true, people: people, kept: kept, problems: problems, leftAlone: leftAlone };
    if (problems.length) {
      res27Fail_('Nothing was deleted: some rows don’t line up (was a tab sorted on one column, or an email changed on only one tab?). Undo the sort or make the emails match, then try again. ' + problems.join('; ') + '.', 'mismatch');
    }
    if (expect !== null && expect !== people.length) {
      res27Fail_('Expected ' + expect + ' test account' + (expect === 1 ? '' : 's') + ' to delete, but found ' + people.length + '. Nothing was deleted: look at the list again.', 'expect');
    }
    if (want && want.join(',') !== Object.keys(ids).sort().join(',')) {
      res27Fail_('The test accounts to delete aren’t the ones on the list (' + people.length + ' now, ' + want.length + ' listed). Nothing was deleted: list them again.', 'changed');
    }
    // On the Log first, so the sheet keeps who went even if a delete fails partway.
    people.forEach(function (p) {
      try {
        var paying = p.payment ? 'pays by ' + p.payment + (p.paid ? ' (PAID)' : ' (not paid)') : '';
        res27Log_(p.email, 'Deleting test account', [p.name, p.id, p.points + ' pts', p.days + (p.days === 1 ? ' day' : ' days'), paying, p.notes].filter(Boolean).join(' · '));
      } catch (e) {}
    });
    var removed = { participants: 0, accounts: 0, appdata: 0, checkins: 0, questions: 0 };
    tabs.forEach(function (tab) {
      plan[tab]
        .sort(function (a, c) {
          return c._row - a._row;
        })
        .forEach(function (r) {
          res27Sheet_(tab).deleteRow(r._row);
          removed[tab] += 1;
        });
    });
    SpreadsheetApp.flush();
    return { ok: true, removed: removed, skipped: [], people: people, kept: kept, leftAlone: leftAlone };
  } finally {
    lock.releaseLock();
  }
}

/** A gym an admin typed (id, short name or full name), or a refusal that lists them. */
function res27AdminGym_(value) {
  var id = res27GymId_(value);
  if (!id) {
    res27Fail_('No gym is called "' + res27CleanText_(value, 40) + '". Use one of: ' + RES27_GYMS.map(function (g) {
      return g.id + ' (' + g.short + ')';
    }).join(', ') + '.', 'gym');
  }
  return res27Gym_(id);
}

/** An admin's date (yyyy-mm-dd), or the gym's own today when there's none. */
function res27AdminDate_(value, gym) {
  if (value === undefined || value === null || value === '') return res27GymNow_(gym).date;
  var key = res27ParseDateKey_(value);
  if (!key) res27Fail_('The date needs to look like 2027-01-20.');
  return key;
}

/**
 * adminSetGym { email, gym }: Kevin moves someone to another gym, any time (after Day 1 people are
 * told "Ask Kevin"). Moving someone mid-challenge moves their points between gym and team
 * standings, which lets anyone comparing the standings before and after work out their total, so
 * make such changes together. A coach ranking made for the old gym is cleared, and so are Team and
 * Coach (set for the old gym: teams belong to a gym); the reply (teamCleared, coachCleared: what
 * they were) and the Log line say so, so Kevin can set the new ones.
 */
function res27AdminSetGym_(d) {
  var email = res27LookupEmail_(d.email);
  if (!email) res27Fail_('That email isn’t valid.');
  var gym = res27AdminGym_(d.gym);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var was;
  var cleared = false;
  var team = '';
  var coach = '';
  try {
    RES27_REQ_.headers = {};
    if (res27Headers_('participants').indexOf('Gym') < 0) res27Fail_('Participants has no Gym column yet: run node dev/live.js setup first.');
    var row = res27FindRow_('participants', 'Email', email);
    if (!row) res27Fail_('No participant with that email.');
    var app = res27FindRow_('appdata', 'ID', row['ID']);
    var person;
    try {
      person = res27Person_(row, app);
    } catch (e) {
      res27Fail_(String((e && e.message) || e) + ' Nothing was changed.', 'mismatch');
    }
    was = person.gym;
    var update = { 'Gym': gym.short };
    var setup = person.setup || {};
    if ((setup.coaches || []).length && !res27RankingFits_(setup.coaches, gym)) {
      setup.coaches = [];
      cleared = true;
      if (app) {
        res27AssertRow_('appdata', app._row, 'ID', person.id);
        res27UpdateRow_('appdata', app._row, { 'Setup': res27SetupJson_(setup, person.id), 'Updated': new Date(res27Now_()) });
      }
    }
    update['Coach Ranking'] = res27RankingText_(setup, gym);
    if (was !== gym.id) {
      team = String(person.team).trim();
      coach = String(person.coach).trim();
      if (team) update['Team'] = '';
      if (coach) update['Coach'] = '';
    }
    res27AssertRow_('participants', row._row, 'Email', email);
    res27UpdateRow_('participants', row._row, update);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  if (was !== gym.id || cleared) {
    try {
      res27Log_(email, 'Changed gym', res27GymMoveText_(was, gym, { by: 'Kevin', ranking: cleared, team: team, coach: coach }));
    } catch (e) {}
  }
  return { ok: true, email: email, was: was, gym: gym.id, coachRankingCleared: cleared, teamCleared: team, coachCleared: coach };
}

/** Why someone isn't getting a gym's daily email on a date, in words (for the preview). */
function res27WhyNoEmail_(cfg, gym, date, people, email) {
  var p = people.filter(function (x) {
    return x && String(x.email).trim().toLowerCase() === email;
  })[0];
  if (!p) return 'nobody on Participants has that email';
  if (p.gym !== gym.id) return 'they’re at ' + res27GymDef_(p.gym).short + ', not ' + gym.short;
  if (/removed/i.test(p.status)) return 'their Status is Removed';
  if (!p.dailyEmail) return 'their Daily Email is Off';
  if (!res27DailyProgram_(cfg, p, date)) return 'their challenge has no email that day (before Day 1, or after the Monday after the last day)';
  return 'their email address isn’t valid';
}

/**
 * adminEmailPreview { gym, email?, date? }: that gym's daily email for a date (default: today
 * there) without sending: { subject, html, text, recipients (how many get it), overdue (how many
 * of them with the Overdue box) }. With email: that person's own email (and person: whether they
 * get it, and why not). Without: the one everyone without an Overdue box gets.
 */
function res27AdminEmailPreview_(d) {
  var cfg = res27Settings_();
  var gym = res27AdminGym_(d.gym);
  var date = res27AdminDate_(d.date, gym);
  var people = res27AllPeople_();
  var batch = res27DailyBatch_(cfg, gym, date, people);
  var out = { ok: true, gym: gym.id, date: date, subject: '', html: '', text: '', recipients: batch.messages.length, overdue: batch.overdue };
  var pick = null;
  if (d.email !== undefined && d.email !== null && d.email !== '') {
    var email = res27LookupEmail_(d.email);
    if (!email) res27Fail_('That email isn’t valid.');
    pick = batch.messages.filter(function (m) {
      return m.to === email;
    })[0] || null;
    out.person = { email: email, gets: !!pick, overdue: !!(pick && pick.overdue), why: pick ? '' : res27WhyNoEmail_(cfg, gym, date, people, email) };
  }
  if (!pick) {
    // The common one, with a stop link that does nothing (no one has the ID PREVIEW).
    var prog = res27DailyProgram_(cfg, null, date);
    var shared = batch.shared || (prog ? res27DailyShared_(cfg, gym, prog, date, res27DaysContent_()) : null);
    if (shared) pick = res27DailyMessage_(cfg, gym, shared, { id: 'PREVIEW', first: '', last: '' }, '', null);
  }
  if (pick) {
    out.subject = pick.subject;
    out.html = pick.html;
    out.text = pick.text;
  } else {
    out.note = 'No daily email on ' + date + ': it goes out from Day 1 through the last day, and on the Monday after it.';
  }
  return out;
}

/**
 * adminEmailSend { gym, date?, dryRun, force?, email? }: that gym's daily email now (default date:
 * today there), whatever daily_email says, through email_provider. dryRun (the default) sends
 * nothing: it lists who's on that day's list, who's waiting on that day's list for a resend
 * (retry: their send failed; unconfirmed: it got no answer, so they may have it), and what a real
 * send would do (send: 'all' | 'retry' | '' with refused and code). A real send (11/23/2026 review:
 * a hand send of another day used to go to the whole gym unmarked, so the morning run sent it again):
 *   - today: everyone, marked as sent so the hourly run won't send it again; once it has gone
 *     out, only the people waiting on today's list (if any), or everyone again with force.
 *   - an earlier day: only the people waiting on that day's list; everyone again only with force.
 *   - a later day: refused, even with force (that morning's run sends it). To try it before then,
 *     send it to one address.
 * The people waiting include the unconfirmed ones, each batch sent as it went with its
 * Idempotency-Key, so Resend sends it only to a batch it never took (within 24 hours of the first).
 * The reply says what happened (sent, failed, unconfirmed, released) and nextRun: whether an hourly
 * run still comes this morning for whoever it failed for (else they need a send by hand).
 * email (live.js --to=): just that one address, on any date, and nothing is marked or kept: that
 * person's own email if they're on the gym's list that day, else the gym's common one (as in the
 * preview, whose stop link does nothing). For trying the email in a real inbox.
 */
function res27AdminEmailSend_(d) {
  var cfg = res27Settings_();
  var gym = res27AdminGym_(d.gym);
  var date = res27AdminDate_(d.date, gym);
  var today = res27GymNow_(gym).date;
  var when = date > today ? 'future' : date < today ? 'past' : 'today';
  var dry = d.dryRun !== false;
  var force = d.force === true;
  var people = res27AllPeople_();
  var batch = res27DailyBatch_(cfg, gym, date, people);
  var out = { ok: true, gym: gym.id, date: date, today: today, when: when, dryRun: dry, subject: batch.subject, count: batch.messages.length, overdue: batch.overdue };
  if (d.email !== undefined && d.email !== null && d.email !== '') return res27AdminEmailSendTo_(cfg, gym, date, batch, people, d.email, dry, out);
  var props = PropertiesService.getScriptProperties();
  var list = res27Retry_(props, gym.id, date);
  var waiting = list ? res27OnlyIds_(batch.messages, list.ids) : [];
  var unsure = list ? res27OnlyIds_(batch.messages, res27UnconfirmedIds_(list)) : [];
  out.retry = waiting.length; // whose send failed that day: a real send without force goes to just them (and the unconfirmed ones)
  out.unconfirmed = unsure.length; // whose send that day got no answer from Resend: they may have it
  out.alreadySent = when === 'today' && props.getProperty('RES27_DAILY_' + gym.id) === today;
  out.nextRun = res27NextRun_(cfg, gym, date);
  out.skipped = batch.skipped.map(function (s) {
    return s.email || s.name + ' (no address)';
  });
  var plan = res27HandSendPlan_(gym, date, when, out.alreadySent, waiting.length + unsure.length, force);
  if (dry) {
    out.recipients = batch.messages.map(function (m) {
      return { email: m.to, overdue: m.overdue, subject: m.subject };
    });
    out.retryRecipients = waiting.map(function (m) {
      return m.to;
    });
    out.unconfirmedRecipients = unsure.map(function (m) {
      return m.to;
    });
    out.problem = res27ProviderProblem_(cfg); // what would stop a real send ('' if nothing)
    out.send = batch.messages.length ? plan.mode || '' : '';
    if (plan.why && batch.messages.length) {
      out.refused = plan.why;
      out.code = plan.code;
    }
    return out;
  }
  var why = res27ProviderProblem_(cfg);
  if (why) res27Fail_('Nothing was sent: ' + why + '.', 'no_provider');
  out.sent = 0;
  out.failed = 0;
  out.unconfirmed = 0;
  out.failures = [];
  out.unconfirmedTo = [];
  if (when !== 'future' && !batch.messages.length) return out;
  if (plan.why) res27Fail_(plan.why, plan.code);
  var result = res27SendDay_(cfg, gym, date, batch, { mode: plan.mode, claim: when === 'today', force: force, hand: true, nextRun: out.nextRun, started: Date.now(), note: 'sent by hand' });
  if (!result) res27Fail_('Another run sent ' + gym.short + '’s email for ' + date + ' just now: see the Log tab, then look again.', 'already_sent');
  out.send = plan.mode;
  out.sent = result.sent;
  out.failed = result.failed;
  out.unconfirmed = result.unconfirmed;
  out.failures = result.failures.slice(0, 100);
  out.unconfirmedTo = result.unconfirmedTo.slice(0, 100);
  out.released = result.released; // none of it went out, so the day is open again
  out.superseded = result.superseded; // a forced send went to everyone meanwhile: nobody is kept
  return out;
}

/**
 * Whether an hourly run still comes this morning to send a gym's email for date to whoever its
 * send failed for: it's that gym's today, before 11 there (a run at 11-something is the last one
 * before noon), and the runs are on (daily_email TRUE, the provider ready, the trigger in). If not,
 * a hint or Log row says to send it by hand (11/24/2026 review: one said "the next run before noon
 * sends it" in the afternoon).
 */
function res27NextRun_(cfg, gym, date) {
  var now = res27GymNow_(gym);
  if (date !== now.date || now.hour >= 11) return false;
  if (!res27Truthy_(cfg.daily_email) || res27ProviderProblem_(cfg)) return false;
  return ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'res27DailyEmails';
  });
}

/**
 * What a real hand send of a gym's email for date would do: { mode: 'all' | 'retry' } or { why, code }
 * (refused). Today's not marked as sent yet goes to everyone even when its list has people on it (a
 * day given back keeps them there), so the day is marked again and the hourly run won't send it too.
 */
function res27HandSendPlan_(gym, date, when, alreadySent, waiting, force) {
  if (when === 'future') {
    return { why: 'That day hasn’t come yet: ' + gym.short + '’s email for ' + date + ' goes out that morning, with the hourly run. To try it before then, send it to one address (email; live.js: --to=<email>).', code: 'future' };
  }
  if (force) return { mode: 'all' };
  if (when === 'today' && !alreadySent) return { mode: 'all' };
  if (waiting) return { mode: 'retry' };
  if (when === 'today') {
    return { why: 'Today’s email for ' + gym.short + ' has already gone out, and nobody is waiting for it to be sent again. To send it to everyone again anyway, add force: true (live.js: --force).', code: 'already_sent' };
  }
  return { why: gym.short + '’s email for ' + date + ' is an earlier day’s: everyone who got it then would get it again. To send it anyway, add force: true (live.js: --force).', code: 'past' };
}

/** adminEmailSend with email: just that one address (see res27AdminEmailSend_). */
function res27AdminEmailSendTo_(cfg, gym, date, batch, people, raw, dry, out) {
  var to = res27CleanEmail_(raw);
  if (!to) res27Fail_('That email isn’t valid.');
  var mine = batch.messages.filter(function (m) {
    return m.to === to;
  })[0] || null;
  var why = mine ? '' : res27WhyNoEmail_(cfg, gym, date, people, to);
  if (!mine) {
    // Not on that day's list: the gym's common email, with a stop link that does nothing (no one has the ID PREVIEW).
    var prog = res27DailyProgram_(cfg, null, date);
    var shared = batch.shared || (prog ? res27DailyShared_(cfg, gym, prog, date, res27DaysContent_()) : null);
    if (shared) mine = res27DailyMessage_(cfg, gym, shared, { id: 'PREVIEW', first: '', last: '' }, to, null);
  }
  if (!mine) {
    res27Fail_('No daily email on ' + date + ': it goes out from Day 1 through the last day, and on the Monday after it. Pick one of those days (date; live.js: --date=yyyy-mm-dd).', 'no_email');
  }
  // onList: their own email (Overdue box and stop link included); otherwise why they aren't on it.
  out.to = { email: to, onList: !why, overdue: !!mine.overdue, why: why };
  out.subject = mine.subject;
  out.count = 1;
  out.overdue = mine.overdue ? 1 : 0;
  if (dry) {
    out.recipients = [{ email: to, overdue: !!mine.overdue, subject: mine.subject }];
    out.problem = res27ProviderProblem_(cfg);
    out.send = 'one';
    return out;
  }
  var problem = res27ProviderProblem_(cfg);
  if (problem) res27Fail_('Nothing was sent: ' + problem + '.', 'no_provider');
  // No Idempotency-Key: this is a test send Kevin may repeat on purpose (with the same key, Resend
  // would send the first one only, and a changed email would be turned down).
  var result = res27DeliverDaily_(cfg, [mine], Date.now());
  res27LogDaily_(gym, date, result, out.overdue, 'sent by hand to ' + to + ' only');
  out.send = 'one';
  out.sent = result.sent;
  out.failed = result.failed;
  out.unconfirmed = result.unconfirmed;
  out.failures = result.failures;
  out.unconfirmedTo = result.unconfirmedTo;
  return out;
}

/** Every gym time zone, once each, in gym order (America/Denver, America/Chicago). */
function res27DailyZones_() {
  var zones = [];
  res27Gyms_().list.forEach(function (g) {
    if (zones.indexOf(g.tz) < 0) zones.push(g.tz);
  });
  return zones;
}

/**
 * adminEmailTriggers { on }: true puts in the one trigger that runs res27DailyEmails every hour,
 * after taking out any old ones (an earlier 1.8.0 build made one daily trigger per time zone);
 * false takes it out; leave it off to just list. Each run decides by each gym's own clock and
 * email_hour, so changing email_hour needs nothing here. Apps Script can't say how often a trigger
 * runs, so that's kept with its ID in Script Properties (RES27_DAILY_TRIGGERS).
 * { on, triggers: [{ id, every }], hour (email_hour), zones (the gyms' time zones), note? }.
 */
function res27AdminEmailTriggers_(d) {
  var cfg = res27Settings_();
  var props = PropertiesService.getScriptProperties();
  var mine = function (t) {
    return t.getHandlerFunction() === 'res27DailyEmails';
  };
  var record = res27ParseJson_(props.getProperty('RES27_DAILY_TRIGGERS'), {});
  var hour = res27EmailHour_(cfg);
  var zones = res27DailyZones_();
  if (d.on === true || d.on === false) {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      ScriptApp.getProjectTriggers().filter(mine).forEach(function (t) {
        ScriptApp.deleteTrigger(t);
      });
      record = {};
      if (d.on === true) {
        var t = ScriptApp.newTrigger('res27DailyEmails').timeBased().everyHours(1).create();
        record[t.getUniqueId()] = { every: 'hour' };
      }
      props.setProperty('RES27_DAILY_TRIGGERS', JSON.stringify(record));
    } finally {
      lock.releaseLock();
    }
    try {
      res27Log_('(admin)', 'Daily email triggers ' + (d.on ? 'on' : 'off'), d.on ? 'every hour: each gym’s goes out after ' + hour + ':00 in its own time zone (' + zones.join(', ') + ')' : '');
    } catch (e) {}
  }
  var triggers = ScriptApp.getProjectTriggers().filter(mine).map(function (t) {
    var r = record[t.getUniqueId()] || {};
    return { id: t.getUniqueId(), every: r.every || (r.timeZone ? 'day, ' + r.timeZone : '') };
  });
  var out = { ok: true, on: triggers.length > 0, triggers: triggers, hour: hour, zones: zones };
  // What would still stop the emails, so turning the triggers on says what's left to do.
  var blocked = res27Truthy_(cfg.daily_email) ? res27ProviderProblem_(cfg) : 'daily_email is FALSE in Settings';
  if (triggers.length && blocked) out.note = 'The triggers are on, but nothing goes out until this is fixed: ' + blocked + '.';
  return out;
}

/**
 * The beta's dates as the backend locks them: its last week can still be filled in through
 * lastOpen (the day after that week), so the after-beta cleanup waits for lockedFrom.
 */
function res27BetaDates_(cfg) {
  var beta = res27Beta_(cfg);
  if (!beta) return null;
  var lastOpen = res27AddDays_(beta.start, 7 * Math.ceil(beta.length / 7));
  return { start: beta.start, end: res27AddDays_(beta.start, beta.length - 1), days: beta.length, lastOpen: lastOpen, lockedFrom: res27AddDays_(lastOpen, 1) };
}

function res27AdminSummary_(d) {
  var cfg = res27Settings_();
  var everyone = res27AllPeople_();
  var people = everyone.filter(function (p) {
    return p && p.id && !/removed/i.test(p.status) && p.type !== 'Test';
  });
  var count = function (list, fn) {
    var out = {};
    list.forEach(function (p) {
      [].concat(fn(p)).forEach(function (k) {
        if (k) out[k] = (out[k] || 0) + 1;
      });
    });
    return out;
  };
  return {
    ok: true,
    total: people.length,
    // Test accounts (beta testers included) aren't in any count below. Counted straight from the
    // Participants rows, so a row whose App Data doesn't load is still counted.
    testAccounts: res27AllRows_('participants').filter(function (r) {
      return String(r['ID']).trim() && String(r['Type']).trim() === 'Test';
    }).length,
    byType: count(people, function (p) {
      return p.type;
    }),
    remoteUnpaid: people.filter(function (p) {
      return p.type === 'Remote' && !res27Truthy_(p.paid);
    }).map(function (p) {
      return p.first + ' ' + p.last + ' (' + p.payment + ')';
    }),
    shirts: count(people, function (p) {
      return (RES27_SHIRTS[p.shirt] || '?') + ' ' + p.size;
    }),
    goals: count(people, function (p) {
      return RES27_GOALS[p.setup.goal];
    }),
    plans: count(people, function (p) {
      return p.setup.track && p.setup.track.nutrition ? RES27_PLANS[p.setup.plan] : 'Not tracking nutrition';
    }),
    tracking: count(people, function (p) {
      return RES27_TRACK_KEYS.filter(function (k) {
        return p.setup.track && p.setup.track[k];
      });
    }),
    firstChoiceCoach: count(people, function (p) {
      return (p.setup.coaches || [])[0] || 'No preference';
    }),
    // Per gym (11/23/2026): real people (as in total), Test accounts, and the real people's Daily
    // Email: on, off, and on but with an address the daily email skips (badEmail; 11/24/2026
    // review: they were counted as on while every send left them out).
    gyms: res27Gyms_().list.map(function (g) {
      var here = everyone.filter(function (p) {
        return p && p.id && !/removed/i.test(p.status) && p.gym === g.id;
      });
      var real = here.filter(function (p) {
        return p.type !== 'Test';
      });
      var on = real.filter(function (p) {
        return p.dailyEmail && !!res27CleanEmail_(p.email);
      }).length;
      var bad = real.filter(function (p) {
        return p.dailyEmail && !res27CleanEmail_(p.email);
      }).length;
      return { id: g.id, short: g.short, name: g.name, people: real.length, test: here.length - real.length, dailyOn: on, dailyOff: real.length - on - bad, badEmail: bad };
    }),
    // Gym cells that aren't a gym (a typo): counted as Iron View until fixed.
    unknownGym: everyone.filter(function (p) {
      return p && p.id && p.gymCell && !res27GymId_(p.gymCell);
    }).map(function (p) {
      return p.first + ' ' + p.last + ' <' + p.email + '> (Gym: ' + p.gymCell + ')';
    }),
    // Daily Email on, but an address the email service wouldn't take ("jess@gmail.com.", from
    // before the stricter check): the daily email skips them until Email is fixed on both
    // Participants and Accounts (Test accounts too, marked, since a beta emails them).
    badEmail: everyone.filter(function (p) {
      return p && p.id && !/removed/i.test(p.status) && p.dailyEmail && !res27CleanEmail_(p.email);
    }).map(function (p) {
      return p.first + ' ' + p.last + ' <' + p.email + '> (' + res27GymDef_(p.gym).short + (p.type === 'Test' ? ', Test' : '') + ')';
    }),
    // The stored values the beta commands check (dev/live.js beta / end-beta), and the server's date.
    settings: {
      beta_start: res27ParseDateKey_(cfg.beta_start) || '',
      beta_days: Math.max(1, Math.min(42, parseInt(cfg.beta_days, 10) || 7)),
      beta_everyone: res27Truthy_(cfg.beta_everyone),
      preview_today: res27ParseDateKey_(cfg.preview_today) || '',
      registration_open: res27Truthy_(cfg.registration_open),
      welcome_email: res27Truthy_(cfg.welcome_email),
    },
    // The daily email (never the key itself, only whether there is one): its settings, what would
    // stop it, its triggers, and the last day each gym's went out.
    email: {
      daily_email: res27Truthy_(cfg.daily_email),
      email_provider: res27Provider_(cfg) || 'off',
      email_from: String(cfg.email_from || ''),
      email_hour: res27EmailHour_(cfg),
      apiKey: !!res27EmailKey_(),
      problem: res27Truthy_(cfg.daily_email) ? res27ProviderProblem_(cfg) : 'daily_email is FALSE in Settings',
      triggers: ScriptApp.getProjectTriggers().filter(function (t) {
        return t.getHandlerFunction() === 'res27DailyEmails';
      }).length,
      lastSent: RES27_GYMS.reduce(function (o, g) {
        o[g.id] = res27Prop_('RES27_DAILY_' + g.id) || '';
        return o;
      }, {}),
      // Gyms with people waiting on a day's list for a resend (the next run, or email-send <gym>
      // --date=<day> --yes), a list per day, oldest first: { okc: [{ date, count, unconfirmed }] }
      // (count: their send failed; unconfirmed: it got no answer, so they may have it).
      retry: RES27_GYMS.reduce(function (o, g) {
        var lists = res27Retries_(PropertiesService.getScriptProperties(), g.id).map(function (r) {
          return { date: r.date, count: r.ids.length, unconfirmed: res27UnconfirmedIds_(r).length };
        });
        if (lists.length) o[g.id] = lists;
        return o;
      }, {}),
    },
    beta: res27BetaDates_(cfg),
    today: res27TodayKey_(),
  };
}
