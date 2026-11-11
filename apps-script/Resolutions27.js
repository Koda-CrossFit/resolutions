/**
 * KODA RESOLUTIONS 2027 — backend for the member app at koda-crossfit.github.io/resolutions
 *
 * Lives in the hyrox Apps Script project next to Sim1025.js, Trial1025.js, MendWomens.js and
 * Friendsday.js (that project is already allowed to use Sheets and email, so no new Google
 * consent). Code.js routes to it:
 *   doPost: data.type === "res27"          → res27Post(data)
 *   doGet:  action starting with "res27"   → res27Get(action, e)
 * Every name here starts with res27 / RES27_ so nothing collides with the other files.
 *
 * Data lives in its own spreadsheet, "Koda Resolutions 2027" (id in the script property
 * RES27_SHEET_ID), made by the adminSetup request. Columns are found by header name.
 *
 * What Kevin edits in the sheet: Settings (dates, prices, payment info, coaches), Days (titles
 * and video links), Finishers, and on Participants: Paid, Coach, Team, Status, Type, Notes.
 * Participants can be sorted and filtered freely: each person's checklist setup and check-in
 * history live on the hidden "App Data" tab, keyed by ID, and every write re-checks that the
 * row it is about to change still belongs to that ID.
 *
 * Passwords are never stored: Accounts keeps a salted PBKDF2-HMAC-SHA256 hash. Sign-in returns a
 * signed token the phone keeps, so people stay signed in. Changing a password (or "sign out
 * everywhere") bumps Token Version, which ends every older token.
 */

var RES27_VERSION = '1.5.0 (2026-11-11)';
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

var RES27_TABS = {
  participants: {
    name: 'Participants',
    headers: ['ID', 'Signed Up', 'First Name', 'Last Name', 'Email', 'Type', 'Payment', 'Paid', 'Shirt', 'Size', 'Goal',
      'Nutrition Plan', 'Plan Details', 'Daily Checklist', 'Coach Ranking', 'Coach', 'Team', 'Status', 'Points', 'Days Logged',
      'Last Seen', 'Welcome Email', 'Notes'],
    dates: ['Signed Up', 'Last Seen'],
    numbers: ['Days Logged'],
    decimals: ['Points'],
    widths: { 'ID': 80, 'First Name': 110, 'Last Name': 120, 'Email': 210, 'Daily Checklist': 320, 'Plan Details': 200, 'Coach Ranking': 180, 'Welcome Email': 140, 'Notes': 200 },
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
    headers: ['Key', 'ID', 'Name', 'Team', 'Date', 'Day', 'Done', 'Of', 'Score', 'Bonus', 'Points', 'Answers', 'Updated'],
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
  ['remote_price', 99, 'What a remote participant pays, in dollars'],
  ['venmo', '@kevin-schuetz-5', 'Venmo handle. The app builds a "Pay $99 on Venmo" button with the amount and a note filled in'],
  ['zelle', 'kodaironview@gmail.com', 'Zelle email or phone shown to remote participants'],
  ['card_url', '', 'Zen Planner checkout link for the remote spot. Blank: card payers are told we will email them a secure link'],
  ['coaches', 'Kevin, Riley, Jamie, Maggie', 'Coaches people rank at sign-up, comma-separated, in the order shown'],
  ['contact_email', 'kodaironview@gmail.com', 'Where participants send questions (also the reply-to on emails)'],
  ['site_url', 'https://koda-crossfit.github.io/resolutions/', 'The app link used in emails'],
  ['shirt_changes_until', '', 'Last day people can change their shirt style or size, e.g. 2026-12-15 (blank = any time)'],
  ['cookbook_url', 'https://docs.google.com/document/d/1GYO72pgnYteRCpjKJSa0rvk4ZRN1DRvGElrm0lFWy6o/edit?usp=sharing', 'The Koda Cookbook link on the Nutrition tab'],
  ['welcome_email', true, 'TRUE sends a welcome email after sign-up'],
  ['notify_email', '', 'Optional: also email this address about every new sign-up'],
  ['coach_emails', '', 'Where "Ask a question" (FAQs page) goes for each coach, one per line or comma-separated, like  Riley: riley@example.com. The person’s Coach column picks the coach. No coach, or a coach not listed here: it goes to contact_email. Every question is also kept on the Questions tab'],
  ['show_upcoming_titles', false, 'TRUE shows the titles of videos that have not unlocked yet'],
  ['preview_today', '', 'Test accounts (Type = Test on Participants) see this date as today, e.g. 2027-01-21. Blank = the real date. Ignored while a beta test is set (beta_start), so beta testers always see the real date'],
  ['beta_start', '', 'Beta test: Day 1 of a practice run, e.g. 2026-11-09. Everyone who signs up through the beta link (the app link with ?beta=1 on the end) becomes a Test account, and every Test account goes through Days 1, 2, 3… on the real dates from here. Blank = no beta test'],
  ['beta_days', 7, 'How many days the beta test runs (1 to 42)'],
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

function res27CleanEmail_(value) {
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
  var secret = res27Prop_(RES27_SECRET_PROP);
  if (secret) return secret;
  secret = res27RandomHex_(32);
  PropertiesService.getScriptProperties().setProperty(RES27_SECRET_PROP, secret);
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

function res27Coaches_(cfg) {
  return String(cfg.coaches || '')
    .split(',')
    .map(function (c) {
      return res27CleanText_(c, 40);
    })
    .filter(Boolean);
}

/** Kevin's Venmo link, as on the Hyrox pages: opens Venmo with the amount and a note filled in. */
function res27VenmoPayUrl_(cfg, note) {
  var handle = String(cfg.venmo || '').trim().replace(/^@/, '');
  if (!handle) return '';
  return 'https://venmo.com/?txn=pay&audience=private&recipients=' + encodeURIComponent(handle) +
    '&amount=' + encodeURIComponent(Number(cfg.remote_price) || 99) + '&note=' + encodeURIComponent(note || 'Koda Resolutions 2027');
}

function res27PublicConfig_(cfg) {
  var program = res27Program_(cfg, null, null);
  var beta = res27BetaOpen_(cfg);
  return {
    programName: String(cfg.program_name || 'Koda Resolutions 2027'),
    startDate: program.start,
    endDate: program.end,
    lengthDays: program.length,
    registrationOpen: res27Truthy_(cfg.registration_open),
    remotePrice: Number(cfg.remote_price) || 99,
    venmo: String(cfg.venmo || ''),
    zelle: String(cfg.zelle || ''),
    cardUrl: String(cfg.card_url || ''),
    coaches: res27Coaches_(cfg),
    contactEmail: String(cfg.contact_email || ''),
    siteUrl: String(cfg.site_url || ''),
    cookbookUrl: String(cfg.cookbook_url || ''),
    shirtChangesUntil: res27ParseDateKey_(cfg.shirt_changes_until) || '',
    sizes: RES27_SIZES,
    sleepChoices: RES27_SLEEP_CHOICES,
    finisherChoices: RES27_FINISHER_CHOICES,
    points: RES27_POINTS,
    // The beta test's dates, for the beta link's landing page (null when there's no beta).
    beta: beta ? { start: beta.start, end: res27AddDays_(beta.start, beta.length - 1), days: beta.length } : null,
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
 * id at the start of the cell ("nbg1s1gdjJk 'Day 1- 2026…' - re-record…"). Only the beta shows it.
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

/** One or more videos from the Video URL cell: a link per line, optionally "Label: link" or "Label | link". */
function res27ParseVideos_(cell) {
  return String(cell || '')
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
    .filter(Boolean)
    .slice(0, 6);
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

function res27Program_(cfg, person, clientToday) {
  // While a beta test is set, Test accounts go through it instead, on the real dates.
  var beta = person && person.type === 'Test' ? res27Beta_(cfg) : null;
  var start = beta ? beta.start : res27ParseDateKey_(cfg.start_date) || '2027-01-18';
  var length = beta ? beta.length : Math.max(1, Math.min(120, parseInt(cfg.length_days, 10) || 42));
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

function res27DayPublic_(n, program, content, cfg) {
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
    day.videos = res27ParseVideos_(c.video);
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

function res27FinishersFor_(program) {
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
        videos: res27ParseVideos_(r['Video URL']),
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
    setup: setup,
    history: history,
  };
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

/** Validates and normalizes the goal / tracking / follow-up answers. Throws a friendly message. */
function res27CleanSetup_(raw, cfg) {
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
  var known = res27Coaches_(cfg);
  var seen = {};
  s.coaches = (Array.isArray(raw.coaches) ? raw.coaches : [])
    .map(function (c) {
      return res27CleanText_(c, 40);
    })
    .filter(function (c) {
      if (known.indexOf(c) < 0 || seen[c]) return false;
      seen[c] = true;
      return true;
    });
  return s;
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
function res27SetupColumns_(s) {
  return {
    'Goal': RES27_GOALS[s.goal] || '',
    'Nutrition Plan': res27PlanLabel_(s),
    'Plan Details': res27PlanDetails_(s),
    'Daily Checklist': res27ChecklistText_(s),
    'Coach Ranking': (s.coaches || []).map(function (c, i) {
      return i + 1 + '. ' + c;
    }).join('  ') || 'No preference',
  };
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
        var answered = item.units.filter(function (u) {
          return answers[u[0]] === 1 || answers[u[0]] === 0;
        }).length;
        return 'Meals ' + (answered ? yes + '/4' : '–');
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
    var day = res27DayPublic_(n, program, content, cfg);
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
  var days = [];
  for (var n = 1; n <= program.length; n++) days.push(res27DayPublic_(n, program, content, cfg));
  var checklists = res27EditableChecklists_(person, program, content, cfg);
  return {
    person: Object.assign(res27PublicPerson_(person), { askToCoach: !!res27CoachEmail_(cfg, person.coach) }),
    program: program,
    config: res27PublicConfig_(cfg),
    days: days,
    history: res27PublicHistory_(person, program),
    checklists: checklists,
    preview: program.phase === 'before' ? res27Checklist_(person, { title: '', bonus: '' }) : null,
    finishers: res27FinishersFor_(program),
    totals: res27Totals_(person.history, program),
    payUrl: person.type === 'Remote' ? res27VenmoPayUrl_(cfg, 'Koda Resolutions 2027 - ' + person.first + ' ' + person.last) : '',
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
  var acct = res27FindRow_('accounts', 'ID', parts[0]);
  if (!acct || String(Number(acct['Token Version']) || 1) !== parts[1]) res27Fail_('Please sign in again.', 'auth');
  var person = res27LoadPerson_(parts[0]);
  if (!person) res27Fail_('Please sign in again.', 'auth');
  if (/removed/i.test(person.status)) res27Fail_('This account is no longer active. Questions? Email ' + res27Settings_().contact_email + '.', 'inactive');
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
  var email = res27CleanEmail_(d.email);
  if (!email) return { ok: true, valid: false, exists: false };
  return { ok: true, valid: true, exists: !!res27FindRow_('accounts', 'Email', email) };
}

function res27Register_(d) {
  var cfg = res27Settings_();
  if (!res27Truthy_(cfg.registration_open)) {
    res27Fail_('Sign-ups are closed right now. Questions? Email ' + cfg.contact_email + '.', 'closed');
  }
  var type = d.memberType === 'remote' ? 'Remote' : d.memberType === 'member' ? 'Member' : '';
  if (!type) res27Fail_('Choose Current Koda Member or Remote Participant.');
  var pay = String(d.payment || '');
  if (type === 'Remote' && !RES27_PAYMENTS[pay]) res27Fail_('Choose how you’d like to pay the $' + (Number(cfg.remote_price) || 99) + '.');
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
  var setup = res27CleanSetup_(d.setup, cfg);
  // Through the beta link while a beta test is open: a Test account (no payment, left out of the
  // summary, cleared before launch). A beta page sent after the beta ended is stopped, so a
  // practice sign-up never quietly turns into a real one that owes $99; the app reloads and asks again.
  var beta = d.beta === true ? res27BetaOpen_(cfg) : null;
  if (d.beta === true && !beta) {
    res27Fail_('The beta test is over, so this would be a real sign-up for the challenge. Check your details, then tap Create my account again.', 'beta_over');
  }
  var chose = type === 'Remote' ? 'Remote · ' + RES27_PAYMENTS[pay] : 'Koda Member';

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
      'Payment': !beta && type === 'Remote' ? RES27_PAYMENTS[pay] : '',
      'Paid': !beta && type === 'Remote' ? '' : 'n/a',
      'Shirt': RES27_SHIRTS[shirt],
      'Size': size,
      'Status': 'Active',
      'Points': 0,
      'Days Logged': 0,
      'Last Seen': now,
    };
    if (beta) row['Notes'] = 'Beta test sign-up (chose ' + chose + ')';
    var cols = res27SetupColumns_(setup);
    Object.keys(cols).forEach(function (k) {
      row[k] = cols[k];
    });
    res27AppendRow_('participants', row);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  try {
    res27Log_(email, 'Signed up', (beta ? 'Beta test (chose ' + chose + ')' : type + (type === 'Remote' ? ' · pays by ' + RES27_PAYMENTS[pay] : '')) + ' · ' + RES27_GOALS[setup.goal]);
  } catch (e) {}
  var emailed = false;
  try {
    emailed = res27SendWelcome_(cfg, { id: id, first: first, last: last, email: email, type: beta ? 'Test' : type, beta: !!beta, pay: pay, setup: setup, shirt: RES27_SHIRTS[shirt], size: size });
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

function res27Login_(d) {
  var cfg = res27Settings_();
  var email = res27CleanEmail_(d.email);
  var password = String(d.password || '');
  if (!email || !password) res27Fail_('Enter your email and password.');
  var acct = res27FindRow_('accounts', 'Email', email);
  if (!acct) res27Fail_('We couldn’t find an account with that email. Check the spelling, or sign up first.', 'no_account');
  var now = res27Now_();
  var lockedUntil = res27Time_(acct['Locked Until']);
  if (lockedUntil > now) {
    res27Fail_('Too many tries. Wait ' + Math.max(1, Math.ceil((lockedUntil - now) / 60000)) + ' minutes, or reset your password.', 'locked');
  }
  var hash = res27HashPassword_(password, String(acct['Salt']), Number(acct['Rounds']) || RES27_HASH_ROUNDS);
  if (hash !== String(acct['Password Hash'])) {
    var fails = (Number(acct['Failed Logins']) || 0) + 1;
    var update = { 'Failed Logins': fails };
    if (fails >= RES27_MAX_FAILED_LOGINS) {
      update['Failed Logins'] = 0;
      update['Locked Until'] = new Date(now + RES27_LOCK_MINUTES * 60000);
    }
    res27AssertRow_('accounts', acct._row, 'Email', email);
    res27UpdateRow_('accounts', acct._row, update);
    res27Fail_('That password doesn’t match. Try again, or reset it.', 'bad_password');
  }
  res27AssertRow_('accounts', acct._row, 'Email', email);
  res27UpdateRow_('accounts', acct._row, { 'Failed Logins': 0, 'Locked Until': '', 'Last Login': new Date(now) });
  var person = res27LoadPerson_(acct['ID']);
  if (!person) res27Fail_('We couldn’t find your sign-up. Email ' + cfg.contact_email + ' and we’ll fix it.', 'missing');
  if (/removed/i.test(person.status)) res27Fail_('This account is no longer active. Questions? Email ' + cfg.contact_email + '.', 'inactive');
  return { ok: true, token: res27IssueToken_(person.id, Number(acct['Token Version']) || 1), me: res27Bootstrap_(person, d.today) };
}

function res27ResetCodeHash_(code, id) {
  return res27Sign_('reset|' + code + '|' + id);
}

function res27ResetStart_(d) {
  var cfg = res27Settings_();
  var email = res27CleanEmail_(d.email);
  if (!email) res27Fail_('Enter the email you signed up with.');
  var acct = res27FindRow_('accounts', 'Email', email);
  if (!acct) res27Fail_('We couldn’t find an account with that email. Check the spelling.', 'no_account');
  if (res27Count_('res27:rf:' + acct['ID']) >= RES27_RESET_BAD_BUDGET) {
    res27Fail_('Too many wrong codes. Email ' + cfg.contact_email + ' and we’ll reset it for you.', 'too_many');
  }
  var now = res27Now_();
  var expires = res27Time_(acct['Reset Expires']);
  if (expires && expires - RES27_RESET_MINUTES * 60000 + 60000 > now) {
    res27Fail_('We just sent you a code. Check your inbox (and spam), or try again in a minute.', 'wait');
  }
  var hour = Utilities.formatDate(new Date(now), RES27_TZ, 'yyyy-MM-dd-HH');
  if (res27Bump_('res27:rs:' + hour, 3700) > RES27_RESET_STARTS_PER_HOUR) {
    res27Fail_('Lots of password resets right now. Try again in an hour, or email ' + cfg.contact_email + '.', 'busy');
  }
  var code = res27RandomCode_();
  var name = String(cfg.program_name || 'Koda Resolutions 2027');
  var html = res27EmailFrame_(cfg, 'Your sign-in code',
    '<p style="margin:0 0 16px">Use this code to set a new password for ' + res27Html_(name) + ':</p>' +
    '<p style="margin:0 0 20px;font-size:34px;letter-spacing:8px;font-weight:700;color:#0C1A2B">' + code + '</p>' +
    '<p style="margin:0;color:#5F6B7A">It works for ' + RES27_RESET_MINUTES + ' minutes. If you didn’t ask for it, you can ignore this email.</p>');
  var sent = res27Mail_(cfg, email, 'Your ' + name + ' code: ' + code, html, 'Your code is ' + code + '. It works for ' + RES27_RESET_MINUTES + ' minutes.', 3);
  if (!sent) res27Fail_('We couldn’t send the email right now. Email ' + cfg.contact_email + ' and we’ll reset it for you.', 'mail');
  res27AssertRow_('accounts', acct._row, 'Email', email);
  res27UpdateRow_('accounts', acct._row, {
    'Reset Code': res27ResetCodeHash_(code, acct['ID']),
    'Reset Expires': new Date(now + RES27_RESET_MINUTES * 60000),
    'Reset Tries': 0,
  });
  return { ok: true };
}

function res27ResetFinish_(d) {
  var cfg = res27Settings_();
  var email = res27CleanEmail_(d.email);
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
    if (!acct) res27Fail_('We couldn’t find an account with that email.', 'no_account');
    var budgetKey = 'res27:rf:' + acct['ID'];
    if (res27Count_(budgetKey) >= RES27_RESET_BAD_BUDGET) {
      res27Fail_('Too many wrong codes. Email ' + cfg.contact_email + ' and we’ll reset it for you.', 'too_many');
    }
    var now = res27Now_();
    var tries = Number(acct['Reset Tries']) || 0;
    if (!acct['Reset Code'] || res27Time_(acct['Reset Expires']) < now || tries >= RES27_RESET_MAX_TRIES) {
      res27Fail_('That code has expired. Ask for a new one.', 'expired');
    }
    if (res27ResetCodeHash_(code, acct['ID']) !== String(acct['Reset Code'])) {
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
    var day = res27DayPublic_(n, program, content, cfg);
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
      endDay = res27DayPublic_(res27DiffDays_(program.start, end) + 1, program, content, cfg);
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

function res27UpdateSetup_(d, auth) {
  var cfg = res27Settings_();
  var setup = res27CleanSetup_(d.setup, cfg);
  var shirt = d.shirt === undefined ? null : String(d.shirt || '');
  var size = d.size === undefined ? null : String(d.size || '');
  if (shirt !== null && !RES27_SHIRTS[shirt]) res27Fail_('Choose a T-Shirt or a Ladies Tank.');
  if (shirt !== null && RES27_SIZES[shirt].indexOf(size) < 0) res27Fail_('Choose your size.');
  var shirtChanged = shirt !== null && (shirt !== auth.person.shirt || size !== auth.person.size);
  if (shirtChanged) {
    var until = res27ParseDateKey_(cfg.shirt_changes_until);
    if (until && res27TodayKey_() > until) res27Fail_('Shirts are already ordered, so sizes are locked. Email ' + cfg.contact_email + ' if you need a swap.', 'locked_shirt');
  }
  var program = res27Program_(cfg, auth.person, d.today);
  var content = res27DaysContent_();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var old = { shirt: auth.person.shirt, size: auth.person.size };
  try {
    RES27_REQ_.headers = {};
    var person = res27LoadPerson_(auth.id);
    if (!person || !person.appRow) res27Fail_('Please sign in again.', 'auth');
    old = { shirt: person.shirt, size: person.size };
    person.setup = setup;
    var update = res27SetupColumns_(setup);
    if (shirt !== null) {
      update['Shirt'] = RES27_SHIRTS[shirt];
      update['Size'] = size;
    }
    var appUpdate = { 'Setup': res27SetupJson_(setup, person.id), 'Updated': new Date(res27Now_()) };
    // Today's saved check-in follows the new checklist (keeping answers that still apply). Earlier days keep theirs.
    var today = program.today;
    var todayDay = null;
    if (program.phase === 'during' && person.history[today]) {
      todayDay = res27DayPublic_(res27DiffDays_(program.start, today) + 1, program, content, cfg);
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
    res27AssertRow_('appdata', person.appRow, 'ID', person.id);
    res27UpdateRow_('appdata', person.appRow, appUpdate);
    res27AssertRow_('participants', person.row, 'ID', person.id);
    res27UpdateRow_('participants', person.row, update);
    if (todayDay) res27WriteCheckin_(person, today, todayDay.n, todayDay, person.history[today], new Date(res27Now_()));
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  try {
    res27Log_(auth.person.email, 'Changed setup', res27ChecklistText_(setup));
    if (shirtChanged) res27Log_(auth.person.email, 'Changed shirt', (RES27_SHIRTS[old.shirt] || '?') + ' ' + old.size + ' → ' + RES27_SHIRTS[shirt] + ' ' + size);
  } catch (e) {}
  RES27_REQ_ = {};
  return { ok: true, me: res27Bootstrap_(res27LoadPerson_(auth.id), d.today) };
}

function res27ChangePassword_(d, auth) {
  var current = String(d.current || '');
  var next = String(d.password || '');
  if (!current) res27Fail_('Enter your current password. Forgot it? Sign out and use Forgot password.', 'bad_password');
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

/** coach_emails from Settings ("Riley: riley@x.com, Maggie: maggie@x.com" or one per line) as { riley: 'riley@x.com' }. */
function res27CoachEmails_(cfg) {
  var out = {};
  String(cfg.coach_emails || '').split(/[\n,;]+/).forEach(function (part) {
    var m = /^\s*(.+?)\s*[:=]\s*<?(\S+@[^\s>]+)>?\s*$/.exec(part) || /^\s*(.+?)\s+<?(\S+@[^\s>]+)>?\s*$/.exec(part);
    if (!m) return;
    var name = res27CleanText_(m[1], 60).toLowerCase();
    var email = res27CleanEmail_(m[2]);
    if (name && email) out[name] = email;
  });
  return out;
}

/** The email for a person's coach (Participants Coach column): the full name, else a unique first-name match. '' if none. */
function res27CoachEmail_(cfg, coach) {
  var map = res27CoachEmails_(cfg);
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
 * for that coach): it goes to contact_email. Every question is also kept on the Questions tab.
 * The coach's address never goes back to the app.
 */
function res27Ask_(d, auth) {
  var cfg = res27Settings_();
  var p = auth.person;
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
    res27Fail_('That’s a lot of questions for one day. Please wait a little, or email ' + cfg.contact_email + '.', 'busy_asks');
  }
  if (res27Count_('res27:ask:all:' + hour) >= RES27_ASK_ALL_PER_HOUR) {
    res27Fail_('Lots of questions are coming in right now. Please try again in a little while, or email ' + cfg.contact_email + '.', 'busy_asks');
  }
  res27Bump_('res27:ask:h:' + p.id + ':' + hour, 3700);
  res27Bump_('res27:ask:all:' + hour, 3700);
  var coach = res27CleanText_(p.coach, 60);
  var coachEmail = res27CoachEmail_(cfg, coach);
  var to = coachEmail || res27CleanEmail_(cfg.contact_email);
  var name = p.first + ' ' + p.last;
  var program = res27Program_(cfg, p, d.today);
  var when = program.phase === 'during' ? 'Day ' + program.dayNumber + ' of ' + program.length : program.phase === 'before' ? 'before Day 1' : 'after the challenge';
  var note = coachEmail ? '' : coach ? 'Coach ' + coach + ' has no email in coach_emails (Settings) yet, so this came to the gym.' : 'No coach is assigned yet, so this came to the gym.';
  var html = res27EmailFrame_(cfg, 'A question from ' + name,
    '<div style="background:#F0F2F5;border-radius:12px;padding:14px 16px;margin:0 0 16px;font-size:15px;color:#0F1925">' + res27Html_(q).replace(/\n/g, '<br>') + '</div>' +
    '<p style="margin:0 0 6px"><b>' + res27Html_(name) + '</b> · ' + res27Html_(p.email) + (p.team ? ' · Team ' + res27Html_(p.team) : '') + ' · ' + res27Html_(when) + '</p>' +
    (note ? '<p style="margin:0 0 6px;color:#5F6B7A">' + res27Html_(note) + '</p>' : '') +
    '<p style="margin:12px 0 0;color:#5F6B7A">Reply to this email to answer ' + res27Html_(p.first) + ' directly.</p>');
  var text = q + '\n\n- ' + name + ' (' + p.email + ')' + (note ? '\n' + note : '') + '\nReply to this email to answer ' + p.first + ' directly.';
  var subject = (p.type === 'Test' ? '[Beta] ' : '') + 'Resolutions question from ' + name;
  var sent = to ? res27Mail_(cfg, to, subject, html, text, RES27_MAIL_RESERVE, p.email) : false;
  var kept = true;
  try {
    res27AppendRow_('questions', { 'When': new Date(res27Now_()), 'ID': p.id, 'Name': name, 'Email': p.email, 'Team': p.team, 'Coach': coach, 'Sent To': to, 'Question': q, 'Emailed': sent ? 'Sent' : 'NOT SENT' });
  } catch (e) {
    kept = false;
  }
  if (!sent && !kept) res27Fail_('That didn’t go through. Please try again in a minute, or email ' + cfg.contact_email + '.', 'server');
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
 */
function res27Leaderboard_(d, auth) {
  var cfg = res27Settings_();
  var program = res27Program_(cfg, auth.person, d.today);
  var test = auth.person.type === 'Test';
  var key = 'res27:board:' + (test ? 'test' : 'real') + ':' + program.start + ':' + program.length + ':' + program.today;
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
  return { ok: true, board: board, myTeam: res27TeamKey_(auth.person.team) };
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
  var teams = {};
  res27AllPeople_().forEach(function (p) {
    if (!p || !p.id || /removed/i.test(p.status) || (p.type === 'Test') !== test) return;
    var name = res27TeamName_(p.team);
    var k = res27TeamKey_(p.team);
    if (!k) return;
    var t = teams[k] || (teams[k] = { key: k, name: name.replace(/^team\s+/i, ''), people: 0, points: 0, week: 0 });
    t.people += 1;
    Object.keys(p.history || {}).forEach(function (date) {
      if (!res27IsDayKey_(date) || date < program.start || date > last) return;
      var e = p.history[date];
      if (!e || !e.a || !Object.keys(e.a).length) return;
      var pts = Number(e.p) || 0;
      t.points += pts;
      if (week && date >= weekFrom && date <= weekTo) t.week += pts;
    });
  });
  var list = Object.keys(teams).map(function (k) {
    var t = teams[k];
    var shown = t.people >= RES27_BOARD_MIN_PEOPLE;
    return {
      key: t.key,
      name: t.name,
      people: t.people,
      overall: shown ? Math.round((t.points / t.people) * 10) / 10 : null,
      week: shown ? Math.round((t.week / t.people) * 10) / 10 : null,
    };
  });
  return { teams: list, week: week, weeks: Math.ceil(program.length / 7), weekFrom: weekFrom, weekTo: weekTo, minPeople: RES27_BOARD_MIN_PEOPLE, updated: res27Now_() };
}

/* ================================================================ email ==== */

function res27Html_(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function res27EmailFrame_(cfg, heading, bodyHtml) {
  var name = res27Html_(cfg.program_name || 'Koda Resolutions 2027');
  return '<div style="background:#F4F6F8;padding:24px 12px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#0F1925">' +
    '<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E8ED;border-radius:16px;overflow:hidden">' +
    '<div style="background:#0C1A2B;padding:22px 28px;color:#FFFFFF">' +
    '<div style="font-size:12px;letter-spacing:2px;color:#AEB7C2;text-transform:uppercase">Koda CrossFit Iron View</div>' +
    '<div style="font-size:24px;font-weight:800;letter-spacing:.5px;margin-top:4px">' + name + '</div></div>' +
    '<div style="padding:26px 28px;font-size:15px;line-height:1.55">' +
    '<h1 style="font-size:20px;margin:0 0 14px;color:#0C1A2B">' + res27Html_(heading) + '</h1>' + bodyHtml + '</div>' +
    '<div style="padding:16px 28px;border-top:1px solid #E4E8ED;font-size:12px;color:#8B95A3">Koda CrossFit Iron View · 740 S Pierce Ave #5, Louisville, CO 80027' +
    (cfg.contact_email ? ' · ' + res27Html_(cfg.contact_email) : '') + '</div></div></div>';
}

/**
 * Sends one email as the script owner. `reserve` keeps that many of the account's daily sends for
 * Koda's other sign-up pages. Anything not sent is written to the Log tab, so it can be resent.
 */
function res27Mail_(cfg, to, subject, htmlBody, textBody, reserve, replyTo) {
  if (!to) return false;
  var why = '';
  try {
    var left = MailApp.getRemainingDailyQuota();
    if (left < (reserve || 3)) {
      why = 'daily email limit (' + left + ' left)';
    } else {
      var message = { to: to, subject: subject, htmlBody: htmlBody, body: textBody || '', name: 'Koda Resolutions' };
      if (replyTo || cfg.contact_email) message.replyTo = String(replyTo || cfg.contact_email);
      MailApp.sendEmail(message);
      return true;
    }
  } catch (e) {
    why = String(e && e.message || e).slice(0, 200);
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

function res27SendWelcome_(cfg, p) {
  var program = res27Program_(cfg, null, null);
  var startText = res27DayText_(program.start);
  var site = String(cfg.site_url || '');
  var price = Number(cfg.remote_price) || 99;
  var beta = p.beta ? res27Beta_(cfg) : null;
  var payHtml = '';
  if (p.type === 'Remote') {
    var venmo = res27VenmoPayUrl_(cfg, 'Koda Resolutions 2027 - ' + p.first + ' ' + p.last);
    var button = function (href, label) {
      return '<a href="' + res27Html_(href) + '" style="display:inline-block;background:#0C1A2B;color:#FFFFFF;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:600;margin-top:10px">' + label + '</a>';
    };
    var how = p.pay === 'venmo' ? 'on Venmo to <b>' + res27Html_(cfg.venmo) + '</b>' + (venmo ? '<br>' + button(venmo, 'Pay $' + price + ' on Venmo') : '')
      : p.pay === 'zelle' ? 'with Zelle to <b>' + res27Html_(cfg.zelle) + '</b>, with your name in the memo'
      : cfg.card_url ? 'by card:<br>' + button(cfg.card_url, 'Pay $' + price + ' by card') : 'by card. We’ll email you a secure link within a day';
    payHtml = '<div style="background:#F0F2F5;border-radius:12px;padding:14px 16px;margin:0 0 18px"><b>Your $' + price + ' remote spot:</b> pay ' + how + '. We’ll mark you paid in the app.</div>';
  }
  var sent = false;
  if (res27Truthy_(cfg.welcome_email) && beta) {
    var betaEnd = res27AddDays_(beta.start, beta.length - 1);
    var betaLink = site ? site + (site.indexOf('?') >= 0 ? '&' : '?') + 'beta=1' : '';
    var betaBody = '<p style="margin:0 0 14px">Hi ' + res27Html_(p.first) + ', you’re in the <b>beta test</b> of the Resolutions app. It runs <b>' + res27DayText_(beta.start) + ' – ' + res27DayText_(betaEnd) +
      '</b> on the real dates, so you can try ' + (beta.length === 7 ? 'a week' : beta.length === 1 ? 'a day' : beta.length + ' days') + ' of check-ins before the challenge.</p>' +
      '<p style="margin:0 0 14px">Each day, open the app, watch the video and tap Yes or No on your list. ' +
      'A day you miss shows up as <b>Overdue</b>, and you can still fill it in until midnight on ' + res27WeekdayName_(beta.start) + ', when the week’s scores are pulled.</p>' +
      (betaLink ? '<p style="margin:0 0 18px"><a href="' + res27Html_(betaLink) + '" style="display:inline-block;background:#0C1A2B;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">Open the app</a></p>' : '') +
      '<p style="margin:0;color:#5F6B7A">Everything in the beta is practice. Beta accounts are deleted before the real challenge starts ' + startText + ', so you’ll sign up again for that one.</p>';
    sent = res27Mail_(cfg, p.email, 'You’re in the beta: ' + String(cfg.program_name || 'Koda Resolutions 2027'), res27EmailFrame_(cfg, 'Welcome to the beta test', betaBody),
      'Hi ' + p.first + ', you are in the beta test of the Resolutions app, ' + res27DayText_(beta.start) + ' to ' + res27DayText_(betaEnd) + '. Open the app: ' + betaLink, RES27_MAIL_RESERVE);
  } else if (res27Truthy_(cfg.welcome_email)) {
    var body = '<p style="margin:0 0 14px">Hi ' + res27Html_(p.first) + ', you’re signed up! Day 1 is <b>' + startText + '</b>.</p>' + payHtml +
      '<p style="margin:0 0 14px">Every day you’ll open the app, watch a short video, and check off your own daily list. Your checklist is already built from your answers, and you can change it any time on the Profile tab.</p>' +
      (site ? '<p style="margin:0 0 18px"><a href="' + res27Html_(site) + '" style="display:inline-block;background:#0C1A2B;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">Open the app</a></p>' : '') +
      '<p style="margin:0;color:#5F6B7A">Tip: open the link on your phone and add it to your home screen, then sign in once there. It remembers you after that.</p>';
    sent = res27Mail_(cfg, p.email, 'You’re in: ' + String(cfg.program_name || 'Koda Resolutions 2027'), res27EmailFrame_(cfg, 'Welcome to the challenge', body),
      'Hi ' + p.first + ', you are signed up! Day 1 is ' + startText + '. Open the app: ' + site, RES27_MAIL_RESERVE);
  }
  try {
    var row = res27FindRow_('participants', 'ID', p.id);
    if (row) res27UpdateRow_('participants', row._row, { 'Welcome Email': sent ? 'Sent' : res27Truthy_(cfg.welcome_email) ? 'NOT SENT (see Log)' : 'Off' });
  } catch (e) {}
  var notify = res27CleanEmail_(cfg.notify_email);
  if (notify) {
    res27Mail_(cfg, notify, 'New Resolutions sign-up: ' + p.first + ' ' + p.last + ' (' + p.type + ')',
      res27EmailFrame_(cfg, 'New sign-up', '<p style="margin:0">' + res27Html_(p.first + ' ' + p.last) + ' · ' + res27Html_(p.email) + '<br>' + res27Html_(p.type) +
        (p.type === 'Remote' ? ' · paying by ' + res27Html_(RES27_PAYMENTS[p.pay] || p.pay) : '') + '<br>' + res27Html_(RES27_GOALS[p.setup.goal] || '') +
        ' · ' + res27Html_(p.shirt + ' ' + p.size) + '<br>' + res27Html_(res27ChecklistText_(p.setup)) + '</p>'),
      p.first + ' ' + p.last + ' signed up (' + p.type + ').', RES27_MAIL_RESERVE);
  }
  return sent;
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
  var missing = def.headers.filter(function (h) {
    return existing.indexOf(h) < 0;
  });
  if (missing.length) {
    var start = existing.filter(Boolean).length + 1;
    sheet.getRange(1, start, 1, missing.length).setValues([missing]);
  }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) {
    return String(h).trim();
  });
  // Formats only reach rows that exist, so make room for the whole challenge up front
  // (about 200 people x 42 days of check-ins).
  var wantRows = { checkins: 12000, log: 4000 }[tabKey] || 1000;
  if (sheet.getMaxRows() < wantRows) sheet.insertRowsAfter(sheet.getMaxRows(), wantRows - sheet.getMaxRows());
  var maxRows = Math.max(sheet.getMaxRows(), 2);
  headers.forEach(function (h, i) {
    var col = i + 1;
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
    ['participants', 'checkins', 'days', 'finishers', 'settings', 'accounts', 'questions', 'log', 'appdata'].forEach(function (k) {
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
    RES27_SETTINGS_DEFAULTS.forEach(function (row) {
      var value = Object.prototype.hasOwnProperty.call(overrides, row[0]) ? overrides[row[0]] : row[1];
      if (!have[row[0]]) settings.appendRow([row[0], res27SafeCell_(value), row[2]]);
      else {
        settings.getRange(have[row[0]], 3).setValue(row[2]);
        if (Object.prototype.hasOwnProperty.call(overrides, row[0])) settings.getRange(have[row[0]], 2).setValue(res27SafeCell_(value));
      }
    });

    // Finishers: a sample row so the format is obvious, only on a brand-new tab.
    var fin = book.getSheetByName(RES27_TABS.finishers.name);
    if (fin.getLastRow() < 2) fin.appendRow([1, 'Example finisher (replace me)', 'e.g. 3 rounds: 10 burpees, 15 KB swings, 200m run', '']);

    res27Secret_();
    if (d.adminKey && String(d.adminKey).length >= 12) props.setProperty(RES27_ADMIN_PROP, String(d.adminKey));
    var bonusFixed = res27MigrateBonusPoints_(book, props);
    CacheService.getScriptCache().removeAll(['res27:settings', 'res27:days']);
    SpreadsheetApp.flush();
    var seeded = 0;
    if (Array.isArray(d.days) && d.days.length) {
      seeded = res27WriteDays_(book, d.days, d.overwriteDays === true);
    }
    return { ok: true, created: created, sheetId: book.getId(), url: book.getUrl(), seededDays: seeded, migrated: migrated, bonusFixed: bonusFixed };
  } finally {
    lock.releaseLock();
  }
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

function res27AdminSetType_(d) {
  var email = res27CleanEmail_(d.email);
  var row = res27FindRow_('participants', 'Email', email);
  if (!row) res27Fail_('No participant with that email.');
  // (not d.type: the hyrox router already uses type for routing)
  var type = String(d.participantType || '');
  if (['Member', 'Remote', 'Test'].indexOf(type) < 0) res27Fail_('participantType must be Member, Remote or Test.');
  res27AssertRow_('participants', row._row, 'Email', email);
  res27UpdateRow_('participants', row._row, { 'Type': type });
  return { ok: true };
}

/**
 * Deletes every participant whose Type is Test, with their account, app data and check-ins (for
 * clearing practice runs and beta testers before launch). With `email`, only that Test participant.
 */
function res27AdminPurgeTests_(d) {
  var only = '';
  if (d.email !== undefined && d.email !== null && d.email !== '') {
    only = res27CleanEmail_(d.email);
    if (!only) res27Fail_('That email isn’t valid.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ids = {}; // ID → email, for each Test participant being removed
    res27AllRows_('participants').forEach(function (r) {
      if (String(r['Type']).trim() !== 'Test') return;
      var email = String(r['Email']).trim().toLowerCase();
      if (only && email !== only) return;
      if (String(r['ID']).trim()) ids[String(r['ID']).trim()] = email;
    });
    if (only && !Object.keys(ids).length) res27Fail_('No Test participant with that email.');
    // A row is only deleted when the rest of it agrees it belongs to that ID, so a tab that was
    // sorted on one column (IDs no longer next to their data) can't take a real member with it.
    var belongs = {
      checkins: function (r, id) {
        return String(r['Key']).trim().indexOf(id + '|') === 0;
      },
      accounts: function (r, id) {
        return String(r['Email']).trim().toLowerCase() === ids[id];
      },
      appdata: function (r, id) {
        var setup = res27ParseJson_(r['Setup'], {});
        var history = res27ParseJson_(r['History'], {});
        return (!setup.id || String(setup.id) === id) && (!history._id || String(history._id) === id);
      },
      participants: function () {
        return true;
      },
      questions: function (r, id) {
        return String(r['Email']).trim().toLowerCase() === ids[id];
      },
    };
    var removed = { participants: 0, accounts: 0, appdata: 0, checkins: 0, questions: 0 };
    var skipped = [];
    ['checkins', 'accounts', 'appdata', 'questions', 'participants'].forEach(function (tab) {
      if (!res27Book_().getSheetByName(RES27_TABS[tab].name)) return; // a tab setup hasn't added yet
      res27AllRows_(tab)
        .filter(function (r) {
          var id = String(r['ID']).trim();
          if (!Object.prototype.hasOwnProperty.call(ids, id)) return false;
          if (belongs[tab](r, id)) return true;
          skipped.push(RES27_TABS[tab].name + ' row ' + r._row + ' (ID ' + id + ' doesn’t match the rest of the row: was the tab sorted?)');
          return false;
        })
        .sort(function (a, c) {
          return c._row - a._row;
        })
        .forEach(function (r) {
          res27Sheet_(tab).deleteRow(r._row);
          removed[tab] += 1;
        });
    });
    SpreadsheetApp.flush();
    return { ok: true, removed: removed, skipped: skipped };
  } finally {
    lock.releaseLock();
  }
}

function res27AdminSummary_(d) {
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
    // Test accounts (beta testers included) aren't in any count below.
    testAccounts: everyone.filter(function (p) {
      return p && p.id && p.type === 'Test';
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
  };
}
