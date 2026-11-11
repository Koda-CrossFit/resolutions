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
 *   node dev/live.js beta <yyyy-mm-dd> [days]         (start a beta test; end one with end-beta)
 *   node dev/live.js beta off                         (turn it off; refused while testers can still catch up)
 *   node dev/live.js end-beta <keep-email> [--yes=<code>]   (after the beta: see README "Ending the beta")
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
};

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
    if (name === '--yes' && value !== undefined && !/^[0-9a-f]{6}$/.test(value)) throw new Error('--yes needs the 6-letter code the list printed, like --yes=1a2b3c');
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
    const settings = flags['--welcome'] !== undefined ? { welcome_email: /^true$/i.test(flags['--welcome']) } : undefined;
    out = await post({ action: 'adminSetup', key, settings });
  } else if (cmd === 'setting') {
    // In Windows PowerShell an empty "" never reaches node, so --clear stands for a blank value.
    if (b === undefined && !flags['--clear']) throw new Error('setting needs a key and a value (or --clear to blank it)');
    if (b !== undefined && flags['--clear']) throw new Error('setting takes a value or --clear, not both');
    let value = flags['--clear'] ? '' : b;
    if (/^(true|false)$/i.test(value)) value = /true/i.test(value);
    out = await post({ action: 'adminSetup', key, settings: { [a]: value } });
    if (out.ok && out.unknown && out.unknown.length) out = { ok: false, error: 'No setting is called ' + out.unknown.join(', ') + '; nothing was stored. Check the Settings tab for the exact name.' };
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
  console.log(JSON.stringify(out, null, 1));
  if (out && out.ok === false) process.exitCode = 1;
})().catch((e) => {
  console.error('FAILED', e.message);
  // Not process.exit(1): on Windows that aborts while fetch's sockets are closing (exit code lost).
  process.exitCode = 1;
});
