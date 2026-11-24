'use strict';

/**
 * Admin calls against the LIVE backend (the hyrox web app). The admin key is read from the
 * credentials folder and never printed.
 *   node dev/live.js setup [--welcome=false|true]
 *   node dev/live.js seed-days [--overwrite]          (content/days-2027.json → Days tab)
 *   node dev/live.js summary
 *   node dev/live.js set-type <email> <Member|Remote|Test>   (off Test: also clears practice days)
 *   node dev/live.js purge-tests [--yes=<code>]       (every Test account: lists them with a code; --yes=<code> deletes that list)
 *   node dev/live.js purge-test <email>               (just that Test account)
 *   node dev/live.js setting <key> <value|--clear>    (one Settings value, via adminSetup)
 *   node dev/live.js beta <yyyy-mm-dd> [days] [--force]   (start a beta test, or change the running one;
 *                                                      a new one is refused while Test accounts from an
 *                                                      earlier one are left: run end-beta first)
 *   node dev/live.js beta off                         (turn it off; refused while testers can still catch up)
 *   node dev/live.js end-beta <keep-email> [--yes=<code>]   (after the beta: see README "Ending the beta")
 * Six gyms and the daily email (1.8.0, 11/23/2026):
 *   node dev/live.js gyms                             (each gym's details, people and daily email counts)
 *   node dev/live.js set-gym <email> <gym>            (move someone to a gym: okc, OKC or Koda OKC all work;
 *                                                      clears their Team and Coach, which were the old gym's)
 *   node dev/live.js email-preview <gym> [email] [--date=yyyy-mm-dd]
 *                                                     (that day's email, not sent: saved as a page under
 *                                                      dev/screenshots/email-previews/, which git ignores)
 *   node dev/live.js email-send <gym> [--date=yyyy-mm-dd]   (who would get what, and what --yes would do; nothing is sent)
 *   node dev/live.js email-send <gym> --yes [--date=…] [--force]
 *                                                     (sends it now: today's to everyone, or once it has gone
 *                                                      out, to just the ones waiting on that day's list (it
 *                                                      failed for them, or got no answer); an earlier day's
 *                                                      only to the ones waiting on its list; --force: everyone
 *                                                      again. A later day is refused: that morning's run sends it)
 *   node dev/live.js email-send <gym> --to=<email> [--date=…] [--yes]
 *                                                     (that one address only, any day, marking nothing: their
 *                                                      own email, or the gym's common one: for a test send)
 *   node dev/live.js email-triggers [on|off]          (the hourly trigger: each gym's goes on the first run
 *                                                      past email_hour in its own time zone)
 * Exits 1 when the backend says no (ok: false), so a failed step stops anything chained after it.
 * Tests point it at a local dev server with RES27_URL=http://localhost:8790/api and RES27_ADMIN_KEY.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LIVE_URL = 'https://script.google.com/macros/s/AKfycbwWjHrhE6k3vVPDXD4qi3VLxZVAXMykAFIKocoUiq0BtXdv2XLy7Oo0GRfrP48fHytnyw/exec';
const KEY_FILE = 'C:/Users/kevsc/Desktop/Claude/Credentials - SENSITIVE Do Not Share/hyrox-sim-oct25-admin-key.txt';
const URL = process.env.RES27_URL || LIVE_URL;
const WHERE = process.env.RES27_URL ? 'the backend at ' + new globalThis.URL(URL).host : 'the live backend';

function adminKey() {
  // A test server gets its own key: the live key is only ever sent to the live backend.
  if (process.env.RES27_URL) {
    if (!process.env.RES27_ADMIN_KEY) throw new Error('RES27_URL is set, so give that server’s key in RES27_ADMIN_KEY (the live key only goes to the live backend)');
    return process.env.RES27_ADMIN_KEY;
  }
  if (process.env.RES27_ADMIN_KEY) throw new Error('RES27_ADMIN_KEY is set but RES27_URL isn’t: set both for a test server, or neither for live');
  const line = fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/).find((l) => /^key=/i.test(l.trim()));
  if (!line) throw new Error('No key= line in the admin key file');
  return line.trim().slice(4);
}

async function post(body) {
  const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ type: 'res27' }, body)), redirect: 'follow' });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'Not JSON: ' + text.slice(0, 300) };
  }
}

/** The backend's version as [major, minor, patch], from the public health check. */
async function backendVersion() {
  const res = await fetch(URL + '?action=res27Health', { redirect: 'follow' });
  const health = JSON.parse(await res.text());
  return String(health.version || '').split(' ')[0].split('.').map(Number);
}

/**
 * Stops unless the backend is at least major.minor. An older backend ignores flags it doesn't know,
 * so e.g. a purge dry run sent to 1.6.0 would delete for real.
 */
async function needVersion(major, minor, why) {
  const v = await backendVersion();
  if (!(v[0] > major || (v[0] === major && v[1] >= minor))) throw new Error(WHERE + ' is ' + v.join('.') + '; ' + (why || 'this command') + ' needs ' + major + '.' + minor + '.0 or later (deploy first)');
}

function realDay(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function weekday(key) {
  return new Date(key + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** A short code for exactly this list of people: the delete run must quote it (--yes=<code>). */
function listCode(people) {
  return crypto.createHash('sha256').update(people.map((p) => p.id).sort().join(',')).digest('hex').slice(0, 6);
}

/**
 * One line per Test account a purge would delete, flagging anyone who may have paid, and anyone
 * who is neither a beta sign-up nor moved to Test with set-type (a Type column sorted on its own
 * looks just like that; people moved before 11/11 ~11 AM, when moves started being logged, too).
 */
function printList(people) {
  if (!people.length) console.log('  (none)');
  people.forEach((p) => {
    const flags = [];
    if (p.paid) flags.push('PAID (' + p.payment + '): refund them or keep them');
    else if (p.payment) flags.push('pays by ' + p.payment + ': make sure they didn’t pay');
    else if (/Remote/.test(p.notes)) flags.push('chose Remote: make sure they didn’t pay');
    if (p.how === '') flags.push('not a beta sign-up, and the Log has no move to Test: make sure they belong on this list');
    console.log('  - ' + (p.name || '(no name)') + ' <' + p.email + '> · ' + (p.how || 'how they became Test is unknown') + ' · signed up ' + p.signedUp + ' · ' + p.points + ' pts · ' + p.days + (p.days === 1 ? ' day' : ' days') + (p.notes ? ' · ' + p.notes : '') + flags.map((f) => '\n      <-- ' + f).join(''));
  });
}

/** Rows that don't line up: nothing is deleted until they're fixed. */
function printProblems(problems) {
  console.log('These rows don’t line up, so nothing can be deleted until they’re fixed (was a tab sorted on one column, or an email changed on only one tab? undo the sort, or make the emails match):');
  problems.forEach((p) => console.log('  ! ' + p));
}

/** Rows a purge leaves in place on purpose (a Questions row whose email doesn't match). */
function printLeftAlone(rows) {
  (rows || []).forEach((r) => console.log('  (left alone) ' + r));
}

/** Checks a --yes=<code> against the list as it is now. Throws unless it matches. */
function confirmCode(code, people, rerun) {
  if (code === true) throw new Error('--yes needs the code the list printed, like --yes=' + listCode(people) + '. Run it without --yes first and check the list.');
  if (code !== listCode(people)) throw new Error('The list changed since you looked (its code is now ' + listCode(people) + ', not ' + code + '). Nothing was changed. Look again: ' + rerun);
}

const COMMANDS = {
  // words: how many plain arguments it takes; flags: the -- options it accepts.
  setup: { words: [0, 0], flags: ['--welcome'] },
  'seed-days': { words: [0, 0], flags: ['--overwrite'] },
  summary: { words: [0, 0], flags: [] },
  'set-type': { words: [2, 2], flags: [] },
  'purge-tests': { words: [0, 0], flags: ['--yes'] },
  'purge-test': { words: [1, 1], flags: [] },
  setting: { words: [1, 2], flags: ['--clear'] },
  beta: { words: [1, 2], flags: ['--force'] },
  'end-beta': { words: [1, 1], flags: ['--yes', '--force'] },
  gyms: { words: [0, 0], flags: [] },
  'set-gym': { words: [2, 2], flags: [] },
  'email-preview': { words: [1, 2], flags: ['--date'] },
  'email-send': { words: [1, 1], flags: ['--yes', '--date', '--force', '--to'] },
  'email-triggers': { words: [0, 1], flags: [] },
};

// Since 11/23/2026 each gym has these on the Gyms tab; the Settings values only started Iron View's row.
const MOVED_TO_GYMS = { venmo: 'Venmo', zelle: 'Zelle', card_url: 'Card URL', coaches: 'Coaches', coach_emails: 'Coach Emails' };
const PROVIDERS = ['resend', 'brevo', 'mailapp', 'off'];

/** Where email-preview saves its page: under dev/screenshots, which git ignores (a preview can hold someone's stop link). */
function previewFile(gym, date, email) {
  const dir = path.join(__dirname, 'screenshots', 'email-previews');
  fs.mkdirSync(dir, { recursive: true });
  const who = email ? '-' + email.replace(/[^a-z0-9]+/gi, '_') : '';
  return path.join(dir, 'email-' + gym + '-' + date + who + '.html');
}

/**
 * One gym's line in `gyms`: what people at that gym see, and how many there are. A card is offered
 * at every gym (Kevin, 11/23/2026: "put a placeholder for the card link, we'll add one later"):
 * until the gym's Card URL is in, its card payers are told we'll email them a secure link.
 */
function printGym(g, counts) {
  const pay = [g.venmo ? 'Venmo ' + g.venmo : '', g.zelle ? 'Zelle ' + g.zelle : '', g.cardUrl ? 'card (checkout link)' : 'card (NO LINK YET: email card payers a secure link)'].filter(Boolean);
  const c = counts || {};
  console.log('  ' + g.short + ' (' + g.id + ') · ' + g.name + ' · ' + (g.city || '?') + (g.address ? ' · ' + g.address : ' · NO ADDRESS'));
  console.log('      ' + (c.people || 0) + ' people' + (c.test ? ' + ' + c.test + ' test' : '') + ' · daily email on ' + (c.dailyOn || 0) + ', off ' + (c.dailyOff || 0) + (c.badEmail ? ', ' + c.badEmail + ' skipped (address not valid)' : '') +
    ' · $' + g.remotePrice + ' remote · pays by ' + pay.join(', ') +
    ' · coaches: ' + (g.coaches.length ? g.coaches.join(', ') : 'none (no ranking step)') + ' · questions to ' + (g.contactEmail || '?'));
}

(async () => {
  const cmd = process.argv[2];
  const spec = COMMANDS[cmd];
  if (!spec) throw new Error('unknown command ' + (cmd || '(none)') + '. Commands: ' + Object.keys(COMMANDS).join(', '));
  // Every argument is either a plain word or a known flag, wherever it sits, so a stray email or a
  // mistyped flag stops the command instead of being ignored.
  const words = [];
  const flags = {};
  process.argv.slice(3).forEach((arg) => {
    if (!arg.startsWith('--')) return words.push(arg);
    const [name, value] = arg.split(/=(.*)/s);
    if (spec.flags.indexOf(name) < 0) throw new Error(cmd + ' doesn’t take ' + name + (spec.flags.length ? ' (it takes ' + spec.flags.join(', ') + ')' : ''));
    // A switch is on by being there: --overwrite=false would read as "on", so a value is refused.
    if (['--overwrite', '--force', '--clear'].indexOf(name) >= 0 && value !== undefined) throw new Error(name + ' takes no value: leave it out for "no"');
    if (name === '--welcome' && !/^(true|false)$/i.test(value || '')) throw new Error('--welcome needs =true or =false');
    // email-send's --yes is a plain switch (sending can't be undone either way, so there's no list code).
    if (name === '--yes' && cmd === 'email-send' && value !== undefined) throw new Error('--yes takes no value here: email-send <gym> --yes');
    if (name === '--yes' && value !== undefined && !/^[0-9a-f]{6}$/.test(value)) throw new Error('--yes needs the 6-letter code the list printed, like --yes=1a2b3c');
    if (name === '--date' && !realDay(value || '')) throw new Error('--date needs a real day, like --date=2027-01-20');
    if (name === '--to' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value || '')) throw new Error('--to needs the one address to send it to, like --to=you@example.com');
    flags[name] = value === undefined ? true : value;
  });
  if (words.length < spec.words[0] || words.length > spec.words[1]) {
    throw new Error(cmd + ' takes ' + (spec.words[0] === spec.words[1] ? spec.words[0] : spec.words[0] + ' to ' + spec.words[1]) + ' argument(s), not ' + words.length + (words.length ? ': ' + words.join(' ') : '') + (cmd === 'purge-tests' ? '. purge-tests deletes every Test account; for one account use purge-test <email>.' : ''));
  }
  const [a, b] = words;
  const key = adminKey();
  console.error('(' + WHERE + ')');
  let out;
  if (cmd === 'setup') {
    // The deploy step before the front end: an older backend still live (update-deployment pointed
    // at the wrong version) would say ok here without adding the Gym column, and the six-gym page
    // would then go out against it.
    await needVersion(1, 8, 'setup for this front end (the six gyms)');
    const settings = flags['--welcome'] !== undefined ? { welcome_email: /^true$/i.test(flags['--welcome']) } : undefined;
    out = await post({ action: 'adminSetup', key, settings });
  } else if (cmd === 'setting') {
    // In Windows PowerShell an empty "" never reaches node, so --clear stands for a blank value.
    if (b === undefined && !flags['--clear']) throw new Error('setting needs a key and a value (or --clear to blank it)');
    if (b !== undefined && flags['--clear']) throw new Error('setting takes a value or --clear, not both');
    let value = flags['--clear'] ? '' : b;
    if (/^(true|false)$/i.test(value)) value = /true/i.test(value);
    if (a === 'email_provider' && PROVIDERS.indexOf(String(value).toLowerCase()) < 0) throw new Error('email_provider is one of ' + PROVIDERS.join(', '));
    if (a === 'email_hour' && !(Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 11)) throw new Error('email_hour is a whole hour from 0 to 11 (3 = 3 AM)');
    if (a === 'email_hour') value = Number(value);
    out = await post({ action: 'adminSetup', key, settings: { [a]: value } });
    if (out.ok && out.unknown && out.unknown.length) out = { ok: false, error: 'No setting is called ' + out.unknown.join(', ') + '; nothing was stored. Check the Settings tab for the exact name.' };
    if (out.ok && MOVED_TO_GYMS[a]) console.log('Note: the app no longer reads ' + a + ' from Settings. Each gym’s ' + MOVED_TO_GYMS[a] + ' is on the Gyms tab: change it there.');
    if (out.ok && a === 'email_hour') console.log('Note: from now on each gym’s email goes on the first hourly run past ' + value + ':00 in its own time zone. Nothing else needs changing.');
  } else if (cmd === 'seed-days') {
    const full = path.join(__dirname, '..', 'content', 'private', 'days-2027-full.json');
    const days = JSON.parse(fs.readFileSync(fs.existsSync(full) ? full : path.join(__dirname, '..', 'content', 'days-2027.json'), 'utf8'));
    out = await post({ action: 'adminSeedDays', key, days, overwrite: !!flags['--overwrite'] });
  } else if (cmd === 'summary') {
    out = await post({ action: 'adminSummary', key });
  } else if (cmd === 'set-type') {
    // Off Test it clears practice days, which 1.6.0 and older silently skip.
    if (b !== 'Test') await needVersion(1, 7, 'set-type off Test (it clears practice days)');
    out = await post({ action: 'adminSetType', key, email: a, participantType: b });
  } else if (cmd === 'purge-tests') {
    // Deletes every Test account, so it lists them first with a code, and only deletes when given
    // that code: if the list changed in between, nothing is deleted.
    await needVersion(1, 7, 'purge-tests (it lists before deleting)');
    const list = await post({ action: 'adminPurgeTests', key, dryRun: true });
    if (!list.ok) throw new Error('listing the test accounts failed: ' + list.error);
    const go = flags['--yes'] && !list.problems.length;
    if (go) confirmCode(flags['--yes'], list.people, 'node dev/live.js purge-tests');
    console.log((go ? 'Deleting ' : '') + list.people.length + ' test account(s):');
    printList(list.people);
    printLeftAlone(list.leftAlone);
    if (list.problems.length) {
      printProblems(list.problems);
      out = { ok: false, error: 'Rows don’t line up; nothing deleted.' };
    } else if (!go) {
      out = { ok: true, dryRun: true, count: list.people.length, note: 'Nothing deleted. To delete exactly these: node dev/live.js purge-tests --yes=' + listCode(list.people) };
    } else {
      out = await post({ action: 'adminPurgeTests', key, ids: list.people.map((p) => p.id) });
      if (out.ok) console.log('Deleted ' + out.people.length + ' test account(s).');
    }
  } else if (cmd === 'purge-test') {
    await needVersion(1, 3, 'purge-test');
    out = await post({ action: 'adminPurgeTests', key, email: a });
  } else if (cmd === 'beta') {
    if (a !== 'off' && !realDay(a)) throw new Error('beta needs a real start date (yyyy-mm-dd) or off');
    if (b && (a === 'off' || !(Number.isInteger(Number(b)) && Number(b) >= 1 && Number(b) <= 42))) throw new Error(a === 'off' ? 'beta off takes nothing else' : 'beta days must be a whole number from 1 to 42');
    // Starting one works on 1.3.0+; turning one off checks its dates, which 1.7.0 reports.
    await needVersion(1, a === 'off' ? 7 : 3, a === 'off' ? 'beta off' : 'beta');
    if (a !== 'off') {
      // Every Test account goes through whatever beta is set, daily emails included, so Test
      // accounts left from an earlier beta (the 11/9 testers) would be pulled into this one. A change
      // to the beta that's running (a new length, or a new start while it's still open) keeps its
      // own testers, so that's not refused (11/24/2026 review: it pointed Kevin to end-beta, which
      // deletes them).
      const sum = await post({ action: 'adminSummary', key });
      if (!sum.ok) throw new Error('summary failed: ' + sum.error);
      const running = sum.settings.beta_start === a || !!(sum.beta && sum.today <= sum.beta.lastOpen);
      if (sum.testAccounts > 0 && !running && !flags['--force']) {
        throw new Error('There are ' + sum.testAccounts + ' Test account(s) on Participants, and no beta is running (they’re left from one that’s over, or were moved to Test). A new beta would put every one of them on it, with its daily emails. End the old one first: node dev/live.js end-beta <your email> (or add --force to start this one with them on it). Nothing was changed.');
      }
    }
    if (a === 'off') {
      // Turning it off flips Test accounts to January at once, so not while testers can still
      // catch up its last week. (After a beta, end-beta does this with the rest of the cleanup.)
      const sum = await post({ action: 'adminSummary', key });
      if (!sum.ok) throw new Error('summary failed: ' + sum.error);
      if (sum.beta && sum.today < sum.beta.lockedFrom && !flags['--force']) {
        throw new Error('Too early: testers can still fill in the beta until midnight at the end of ' + weekday(sum.beta.lastOpen) + ' (Mountain). After that, end it with: node dev/live.js end-beta <your email> (or add --force to turn it off now anyway).');
      }
    }
    const settings = { beta_start: a === 'off' ? '' : a };
    if (b) settings.beta_days = Number(b);
    // So the next beta starts out link-only again (beta_everyone is turned on by hand when wanted).
    if (a === 'off') settings.beta_everyone = false;
    out = await post({ action: 'adminSetup', key, settings });
    // What the app now says (the settings cache can take up to a minute to catch up), and what's
    // stored (after a beta's last day the app says no beta either way, so that alone proves nothing).
    const cfg = await post({ action: 'config' });
    const sum = await post({ action: 'adminSummary', key });
    out = { ok: out.ok, error: out.error, beta: cfg.config ? cfg.config.beta : cfg.error, stored: sum.settings };
    if (a !== 'off' && out.ok && !out.beta) out.note = 'beta_start is set, but the beta is not open (it may already be over, or the settings cache is still a minute old)';
  } else if (cmd === 'end-beta') {
    // After the beta (Kevin, 11/11): keep one account (Kevin's own: back to Member, practice days
    // cleared), delete every other Test account, then turn the beta off. Without --yes it only
    // shows what it would do and prints the code that --yes needs. It won't run while testers can
    // still catch up the beta's last week.
    const keepEmail = a;
    await needVersion(1, 7, 'end-beta');
    const sum = await post({ action: 'adminSummary', key });
    if (!sum.ok) throw new Error('summary failed: ' + sum.error);
    if (sum.beta && sum.today < sum.beta.lockedFrom && !flags['--force']) {
      throw new Error('Too early: testers can still fill in the beta (' + sum.beta.start + ' to ' + sum.beta.end + ') until midnight at the end of ' + weekday(sum.beta.lastOpen) + ' (Mountain). Run this on ' + weekday(sum.beta.lockedFrom) + ' or later.');
    }
    const list = await post({ action: 'adminPurgeTests', key, dryRun: true, keep: [keepEmail] });
    if (!list.ok) throw new Error('listing the test accounts failed: ' + list.error);
    const keepRow = list.kept[0];
    if (!keepRow) throw new Error('Nobody on Participants has the email to keep (' + keepEmail + '). Check the spelling. Nothing was changed.');
    const go = flags['--yes'] && !list.problems.length;
    const again = 'node dev/live.js end-beta ' + keepEmail + (flags['--force'] ? ' --force' : '');
    if (go) confirmCode(flags['--yes'], list.people, again);
    console.log(sum.beta ? 'Beta: ' + sum.beta.start + ' to ' + sum.beta.end + (sum.settings.beta_everyone ? ' (everyone who signed up joined it)' : '') + '. Today (Mountain): ' + sum.today + '.' : 'No beta is set any more (beta_start is blank). Today (Mountain): ' + sum.today + '.');
    console.log('Keep: ' + keepRow.email + ' (' + keepRow.type + (keepRow.type === 'Member' ? ', practice days cleared' : ' now: set to Member, practice days cleared') + ')');
    console.log((go ? 'Delete ' : 'Would delete ') + list.people.length + ' test account(s):');
    printList(list.people);
    printLeftAlone(list.leftAlone);
    if (list.problems.length) {
      printProblems(list.problems);
      out = { ok: false, error: 'Rows don’t line up; nothing changed.' };
    } else if (!go) {
      out = { ok: true, dryRun: true, count: list.people.length, note: 'Nothing changed. To do it: ' + again + ' --yes=' + listCode(list.people) };
    } else {
      const st = await post({ action: 'adminSetType', key, email: keepEmail, participantType: 'Member', clearPractice: true });
      if (!st.ok || st.type !== 'Member') throw new Error('Could not set ' + keepEmail + ' to Member (' + (st.error || JSON.stringify(st)) + '). Nothing was deleted.');
      console.log('Kept ' + keepEmail + ': ' + st.was + ' → Member' + (st.cleared ? ', cleared ' + st.cleared.days + ' practice day(s) and ' + st.cleared.checkins + ' Check-ins row(s)' : '') + '.');
      const purge = await post({ action: 'adminPurgeTests', key, keep: [keepEmail], ids: list.people.map((p) => p.id) });
      if (!purge.ok) throw new Error('The purge refused: ' + purge.error + ' (' + keepEmail + ' is a Member now; run end-beta again to see the list).');
      if (purge.people.length !== list.people.length) throw new Error('Deleted ' + purge.people.length + ' of ' + list.people.length + ': run end-beta again to see who is left.');
      console.log('Deleted ' + purge.people.length + ' test account(s): ' + JSON.stringify(purge.removed));
      if (sum.settings.beta_start || sum.settings.beta_everyone) {
        const off = await post({ action: 'adminSetup', key, settings: { beta_start: '', beta_everyone: false } });
        if (!off.ok) throw new Error('Deleted, but turning the beta off failed: ' + off.error + '. Run: node dev/live.js beta off');
        console.log('Beta turned off.');
      }
      const after = await post({ action: 'adminSummary', key });
      if (!after.ok) {
        out = { ok: false, error: 'Done, but the final check failed (' + after.error + '). Run: node dev/live.js summary' };
      } else {
        const as = after.settings;
        out = { ok: after.testAccounts === 0 && !as.beta_start && as.beta_everyone === false, total: after.total, testAccounts: after.testAccounts, beta_start: as.beta_start, beta_everyone: as.beta_everyone, preview_today: as.preview_today };
        if (!out.ok) out.error = 'Not finished: testAccounts should be 0, beta_start blank and beta_everyone false. Run end-beta again to see what’s left.';
      }
    }
  }
  if (cmd === 'gyms') {
    await needVersion(1, 8, 'gyms');
    const cfg = await post({ action: 'config' });
    if (!cfg.ok) throw new Error('config failed: ' + cfg.error);
    const sum = await post({ action: 'adminSummary', key });
    if (!sum.ok) throw new Error('summary failed: ' + sum.error);
    const counts = Object.fromEntries((sum.gyms || []).map((g) => [g.id, g]));
    console.log(cfg.config.gyms.length + ' gyms (details from the Gyms tab):');
    cfg.config.gyms.forEach((g) => printGym(g, counts[g.id]));
    if (sum.unknownGym && sum.unknownGym.length) {
      console.log('These Gym cells aren’t a gym, so they count as Iron View until fixed (Participants, or set-gym):');
      sum.unknownGym.forEach((u) => console.log('  ! ' + u));
    }
    if (sum.badEmail && sum.badEmail.length) {
      console.log('These addresses aren’t ones an email service takes, so the daily email skips them until Email is fixed on both Participants and Accounts:');
      sum.badEmail.forEach((u) => console.log('  ! ' + u));
    }
    const e = sum.email || {};
    console.log('Daily email: ' + (e.daily_email ? 'ON' : 'off') + ' · provider ' + e.email_provider + (e.email_from ? ' from ' + e.email_from : '') + ' · API key ' + (e.apiKey ? 'set' : 'not set') +
      ' · ' + e.triggers + ' trigger(s) at ' + e.email_hour + ':00 local' + (e.problem ? ' · not sending: ' + e.problem : ''));
    console.log('Last sent: ' + Object.keys(e.lastSent || {}).map((g) => g + ' ' + (e.lastSent[g] || 'never')).join(', '));
    // A list per gym per day (11/24/2026): each day's own command reaches just the people on it.
    Object.keys(e.retry || {}).forEach((g) => [].concat(e.retry[g]).forEach((r) => {
      const who = [r.count ? r.count + ' whose email failed' : '', r.unconfirmed ? r.unconfirmed + ' unconfirmed (no answer from Resend: they may have it)' : ''].filter(Boolean).join(' and ');
      console.log('  ! ' + g + ' ' + r.date + ': ' + who + ', waiting to be sent again (node dev/live.js email-send ' + g + ' --date=' + r.date + ' shows them)');
    }));
    out = { ok: true, gyms: cfg.config.gyms.length, people: sum.total, unknownGym: (sum.unknownGym || []).length, badEmail: (sum.badEmail || []).length };
  } else if (cmd === 'set-gym') {
    await needVersion(1, 8, 'set-gym');
    out = await post({ action: 'adminSetGym', key, email: a, gym: b });
    // Their Team and Coach were for the old gym, so the move clears them: Kevin sets the new ones.
    const left = [out.teamCleared ? 'Team ' + out.teamCleared : '', out.coachCleared ? 'Coach ' + out.coachCleared : ''].filter(Boolean);
    if (out.ok && left.length) console.log('Cleared ' + left.join(' and ') + ' (they were for the old gym): set the new ones on Participants.');
  } else if (cmd === 'email-preview') {
    await needVersion(1, 8, 'email-preview');
    const r = await post({ action: 'adminEmailPreview', key, gym: a, email: b, date: flags['--date'] });
    if (r.ok && r.html) {
      const file = previewFile(r.gym, r.date, b);
      fs.writeFileSync(file, '<!doctype html><meta charset="utf-8"><title>' + r.subject.replace(/</g, '&lt;') + '</title>' + r.html);
      console.log('Subject: ' + r.subject);
      console.log('Saved the email as ' + file + ' (open it in a browser).');
      console.log('\n' + r.text + '\n');
      out = { ok: true, gym: r.gym, date: r.date, subject: r.subject, recipients: r.recipients, overdue: r.overdue, person: r.person, file };
    } else {
      out = r.ok ? { ok: true, gym: r.gym, date: r.date, recipients: r.recipients, note: r.note, person: r.person } : r;
    }
  } else if (cmd === 'email-send') {
    await needVersion(1, 8, 'email-send');
    if (flags['--force'] && !flags['--yes']) throw new Error('--force only goes with --yes');
    if (flags['--force'] && flags['--to']) throw new Error('--force doesn’t go with --to: a send to one address never marks the day, so there’s nothing to force');
    const to = flags['--to'];
    const date = flags['--date'];
    // Every command it prints names the day (--date=, the backend's own date when none was given),
    // so one copied later still means that day (11/24/2026 review: without it, the next morning
    // the same command meant the next day's email).
    const again = (day) => 'node dev/live.js email-send ' + a + ' --date=' + day + (to ? ' --to=' + to : '');
    if (!flags['--yes']) {
      const r = await post({ action: 'adminEmailSend', key, gym: a, date, email: to, dryRun: true });
      if (r.ok && to) {
        console.log(r.to.email + ' would get ' + (r.to.onList ? 'their own email' + (r.to.overdue ? ' (with the Overdue box)' : '') : 'the gym’s common email (they aren’t on the list that day: ' + r.to.why + ')') + ': "' + r.subject + '" (' + r.gym + ', ' + r.date + ').');
        if (r.problem) console.log('A real send would be refused right now: ' + r.problem + '.');
        out = { ok: true, dryRun: true, gym: r.gym, date: r.date, to: r.to, note: 'Nothing sent. To send it to that one address (nothing is marked): ' + again(r.date) + ' --yes' };
      } else if (r.ok) {
        console.log((r.count ? r.count + ' would get "' + r.subject + '"' : 'Nobody would get an email') + ' (' + r.gym + ', ' + r.date + '), ' + r.overdue + ' with the Overdue box:');
        r.recipients.forEach((p) => console.log('  - ' + p.email + (p.overdue ? '  (overdue)' : '')));
        if (r.retry) {
          console.log(r.retry + ' of them are waiting for it to be sent again (their send that day failed):');
          r.retryRecipients.forEach((e) => console.log('  - ' + e));
        }
        if (r.unconfirmed) {
          console.log(r.unconfirmed + ' of them are unconfirmed: their send that day got no answer from Resend, so they may have it. Check Resend’s log first (a resend within 24 hours of the first goes out only to a batch Resend never took):');
          (r.unconfirmedRecipients || []).forEach((e) => console.log('  - ' + e));
        }
        if (r.skipped && r.skipped.length) console.log(r.skipped.length + ' skipped, address not valid (fix Email on Participants and Accounts): ' + r.skipped.join(', '));
        if (r.problem) console.log('A real send would be refused right now: ' + r.problem + '.');
        // What --yes would do, so the hint never offers a send to the whole gym it shouldn't.
        const waiting = (r.retry || 0) + (r.unconfirmed || 0);
        let note = 'Nothing sent.';
        if (r.count && r.send === 'all') note += ' To send it to all ' + r.count + ': ' + again(r.date) + ' --yes';
        else if (r.count && r.send === 'retry') note += ' To send it to just the ' + waiting + ' waiting: ' + again(r.date) + ' --yes (with --force it goes to all ' + r.count + ' again)';
        else if (r.count && r.code === 'future') note += ' ' + r.date + ' hasn’t come yet: that morning’s run sends it. To try it on one address now: ' + again(r.date) + ' --to=<email> --yes';
        else if (r.count && r.code === 'already_sent') note += ' Today’s has already gone out, and nobody is waiting for it to be sent again. To send it to all ' + r.count + ' again anyway: ' + again(r.date) + ' --yes --force';
        else if (r.count) note += ' That’s an earlier day’s: everyone who got it then would get it again. To send it anyway: ' + again(r.date) + ' --yes --force';
        out = { ok: true, dryRun: true, gym: r.gym, date: r.date, count: r.count, overdue: r.overdue, retry: r.retry, unconfirmed: r.unconfirmed || 0, note };
      } else {
        out = r;
      }
    } else {
      out = await post({ action: 'adminEmailSend', key, gym: a, date, email: to, dryRun: false, force: !!flags['--force'] });
      const counts = (o) => 'Sent ' + o.sent + ', failed ' + o.failed + (o.unconfirmed ? ', unconfirmed ' + o.unconfirmed : '');
      if (out.ok && to) {
        console.log(counts(out) + ' (' + out.gym + ', ' + out.date + ', only to ' + out.to.email + (out.to.onList ? '' : ': the gym’s common email') + '; nothing was marked).');
      } else if (out.ok) {
        // After noon (or for an earlier day) no run is left to send it, so it says to send it by hand.
        const byHand = again(out.date) + ' --yes';
        const next = [];
        if (out.superseded) {
          next.push('A forced send went to everyone meanwhile, so nobody is kept for a resend.');
        } else {
          if (out.released) next.push('None of it went out, so the day is open again: ' + (out.nextRun ? 'the next run before noon sends it.' : 'send it by hand: ' + byHand));
          else if (out.failed) next.push('The ' + out.failed + ' it failed for are kept: ' + (out.nextRun ? 'the next run before noon sends it to them (or ' + byHand + ' now).' : 'send it by hand: ' + byHand));
          if (out.unconfirmed) next.push('The ' + out.unconfirmed + ' unconfirmed got no answer from Resend, so they may have it: check Resend’s log, then ' + byHand);
        }
        console.log(counts(out) + ' (' + out.gym + ', ' + out.date + (out.send === 'retry' ? ', to the ones waiting' : '') + ').' + (next.length ? ' ' + next.join(' ') : ''));
      }
    }
  } else if (cmd === 'email-triggers') {
    await needVersion(1, 8, 'email-triggers');
    if (a !== undefined && a !== 'on' && a !== 'off') throw new Error('email-triggers takes on, off, or nothing (to list them)');
    out = await post({ action: 'adminEmailTriggers', key, on: a === 'on' ? true : a === 'off' ? false : undefined });
    if (out.ok && out.on) console.log('The daily email runs every hour: each gym’s goes on the first run past ' + out.hour + ':00 in its own time zone (' + (out.zones || []).join(', ') + ').');
  }
  console.log(JSON.stringify(out, null, 1));
  if (out && out.ok === false) process.exitCode = 1;
})().catch((e) => {
  console.error('FAILED', e.message);
  // Not process.exit(1): on Windows that aborts while fetch's sockets are closing (exit code lost).
  process.exitCode = 1;
});
