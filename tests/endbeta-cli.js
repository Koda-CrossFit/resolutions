'use strict';

/**
 * dev/live.js end-beta, purge-tests and friends, run for real against the LOCAL dev server (never
 * the live backend): the after-beta cleanup Kevin chose on 11/11 ("Delete with the beta").
 *   node dev/server.js   (port 8790), then:   node tests/endbeta-cli.js   (it resets that server)
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const BASE = process.env.BASE || 'http://localhost:8790';
const KEY = 'test-admin-key-123';
const LIVE = path.join(__dirname, '..', 'dev', 'live.js');
const GUARD = path.join(__dirname, 'local-only-guard.js'); // no request leaves this computer, the key file stays unread
const HOST = new URL(BASE).host;

const api = (body) => fetch(BASE + '/api', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ type: 'res27' }, body)) }).then((r) => r.json());
const get = (p) => fetch(BASE + p).then((r) => r.json());
const at = (iso) => get('/dev/time?set=' + encodeURIComponent(iso));
const rows = (tab) => get('/dev/rows?tab=' + encodeURIComponent(tab));

/** Runs live.js (pointed at the dev server unless env says otherwise); its exit code and everything it printed. */
function cli(args, env) {
  const vars = Object.assign({}, process.env, env || { RES27_URL: BASE + '/api', RES27_ADMIN_KEY: KEY });
  Object.keys(vars).forEach((k) => vars[k] === undefined && delete vars[k]);
  try {
    return { code: 0, out: execFileSync(process.execPath, ['-r', GUARD, LIVE].concat(args), { env: vars, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}
const codeIn = (out) => (/--yes=([0-9a-f]{6})/.exec(out) || [])[1];

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? ' — ' + detail : ''));
}

const SETUP = {
  goal: 'health',
  track: { nutrition: false, workout: true, sleep: true, protein: false, hydration: false, finishers: false, skill: false, mobility: false, recovery: false, other: false },
  plan: 'recommended',
  sleepHours: 7,
  coaches: [],
};
const join = (email, extra) => api(Object.assign({ action: 'register', memberType: 'member', first: email.split('@')[0], last: 'Tester', email, password: 'secret1', shirt: 'tee', size: 'L', setup: SETUP }, extra || {}));
const testers = async () => (await rows('Participants')).filter((p) => p.Type === 'Test').map((p) => p.Email).sort().join(',');

(async () => {
  await get('/dev/reset');
  await at('2026-11-10T09:00:00-07:00');
  check('dev world: beta Nov 9–15, no welcome emails', (await api({ action: 'adminSetup', key: KEY, settings: { beta_start: '2026-11-09', beta_days: 7, beta_everyone: false, welcome_email: false } })).ok);
  // Kevin signed up for real, then was moved onto the beta; then testers came in on the plain link.
  const kevin = await join('kevin@example.com');
  check('Kevin signs up as a member', kevin.ok && kevin.me.person.type === 'Member', JSON.stringify(kevin.error || ''));
  await api({ action: 'adminSetType', key: KEY, email: 'kevin@example.com', participantType: 'Test' });
  await api({ action: 'adminSetup', key: KEY, settings: { beta_everyone: true } });
  const ava = await join('ava@example.com', { memberType: 'remote', payment: 'venmo' });
  await join('ben@example.com');
  for (const date of ['2026-11-09', '2026-11-10']) await api({ action: 'save', token: kevin.token, date, answers: { video: 1, workout: 1, sleep: 1 }, patch: true });
  await api({ action: 'save', token: ava.token, date: '2026-11-10', answers: { video: 1 }, patch: true });
  check('dev world: 3 beta accounts, 3 check-ins', (await testers()) === 'ava@example.com,ben@example.com,kevin@example.com' && (await rows('Check-ins')).length === 3);

  // Monday after the beta: testers can still catch up until midnight, so the cleanup waits.
  await at('2026-11-16T22:00:00-07:00');
  let r = cli(['end-beta', 'kevin@example.com']);
  check('end-beta refuses on the Monday after the beta (exit 1, says when), and says which backend', r.code === 1 && /Too early/.test(r.out) && /Monday, November 16/.test(r.out) && /Tuesday, November 17/.test(r.out) && r.out.includes('(the backend at ' + HOST + ')'), r.out);
  r = cli(['beta', 'off']);
  check('beta off refuses on that Monday too (it would cut testers off)', r.code === 1 && /Too early/.test(r.out) && /end-beta/.test(r.out), r.out);
  check('…and nothing changed', (await testers()).split(',').length === 3 && (await rows('Settings')).find((s) => s.Setting === 'beta_start').Value !== '');

  // Tuesday: a preview by default, with the code --yes needs.
  await at('2026-11-17T07:00:00-07:00');
  r = cli(['end-beta', 'kevin@example.com']);
  const code = codeIn(r.out);
  check('end-beta without --yes lists the 2 testers (flags the remote one), keeps Kevin, prints the --yes code',
    r.code === 0 && /Would delete 2 test account/.test(r.out) && /ava Tester <ava@example.com> · beta sign-up[^\n]*\n\s+<-- chose Remote: make sure they didn’t pay/.test(r.out) && /ben Tester <ben@example.com> · beta sign-up/.test(r.out) && !/<-- not a beta sign-up/.test(r.out) && /Keep: kevin@example.com \(Test now: set to Member/.test(r.out) && !/kevin Tester </.test(r.out) && !!code, r.out);
  check('…nothing changed', (await testers()).split(',').length === 3 && (await rows('Check-ins')).length === 3);

  // Mistakes that must stop before anything happens.
  const mistakes = [
    [['end-beta', 'kevin@example.com', '--yes'], /needs the code the list printed/, 'plain --yes (no code)'],
    [['end-beta', 'kevin@example.com', '--yes=abc123'], /The list changed since you looked/, 'a wrong code'],
    [['end-beta', 'kevin@example.com', 'ben@example.com', '--yes=' + code], /takes 1 argument/, 'two emails'],
    [['end-beta', '--yes=' + code, 'kevin@example.com', '--bogus'], /doesn’t take --bogus/, 'an unknown flag'],
    [['end-beta', 'nobody@example.com'], /Nobody on Participants has the email to keep/, 'a keep email nobody has'],
    [['end-beta'], /takes 1 argument/, 'no keep email'],
    [['purge-tests', '--yes', 'ava@example.com'], /takes 0 argument.*for one account use purge-test/, 'purge-tests --yes <email> (one letter from purge-test)'],
    [['purge-tests', 'ava@example.com', '--yes'], /takes 0 argument/, 'purge-tests <email> --yes'],
    [['purge-tests', '--yes'], /needs the code the list printed/, 'purge-tests --yes without the code'],
    [['set-type', 'kevin@example.com', 'member'], /participantType must be/, 'a set-type the backend refuses (exit 1, so nothing chained runs)'],
    [['setting', 'beta-start', '2026-11-09'], /No setting is called beta-start/, 'a misspelled setting'],
    [['end-beta', 'kevin@example.com', '--yes=xyz'], /--yes needs the 6-letter code/, 'a code that isn’t one'],
    [['seed-days', '--overwrite=false'], /--overwrite takes no value/, 'seed-days --overwrite=false (it would have overwritten)'],
    [['end-beta', 'kevin@example.com', '--force=false'], /--force takes no value/, '--force=false (it would have forced)'],
    [['setup', '--welcome'], /--welcome needs =true or =false/, 'a bare --welcome'],
    [['summary'], /^RES27_ADMIN_KEY is set but RES27_URL isn’t|FAILED RES27_ADMIN_KEY is set but RES27_URL isn’t/m, 'a test key without a test URL (would go to live)', { RES27_URL: undefined, RES27_ADMIN_KEY: KEY }],
  ];
  for (const [args, want, name, env] of mistakes) {
    r = cli(args, env);
    check('refused: ' + name, r.code === 1 && want.test(r.out), r.out);
  }
  check('…and still nothing changed', (await testers()).split(',').length === 3 && (await rows('Check-ins')).length === 3);
  r = cli(['purge-tests']);
  check('purge-tests alone only lists (all 3, Kevin included, "moved to Test") with its own code', r.code === 0 && /3 test account/.test(r.out) && /kevin Tester <kevin@example.com> · moved to Test/.test(r.out) && !!codeIn(r.out) && codeIn(r.out) !== code, r.out);

  // The real thing.
  r = cli(['end-beta', 'kevin@example.com', '--yes=' + code]);
  check('end-beta --yes=<code> finishes ok', r.code === 0 && /"ok": true/.test(r.out) && /Kept kevin@example.com: Test → Member, cleared 2 practice day\(s\) and 2 Check-ins row\(s\)/.test(r.out) && /Deleted 2 test account/.test(r.out) && /Beta turned off/.test(r.out), r.out);
  const people = await rows('Participants');
  check('only Kevin is left, a Member with 0 points and 0 days', people.length === 1 && people[0].Email === 'kevin@example.com' && people[0].Type === 'Member' && Number(people[0].Points) === 0 && Number(people[0]['Days Logged']) === 0, JSON.stringify(people.map((p) => [p.Email, p.Type, p.Points, p['Days Logged']])));
  check('no check-ins, accounts or app data left except Kevin’s (and his practice days are gone)',
    (await rows('Check-ins')).length === 0 && (await rows('Accounts')).length === 1 && (await rows('App Data')).length === 1 && Object.keys(JSON.parse((await rows('App Data'))[0].History)).filter((k) => k !== '_id').length === 0);
  const settings = Object.fromEntries((await rows('Settings')).map((s) => [s.Setting, s.Value]));
  check('the beta is off: beta_start blank, beta_everyone FALSE', settings.beta_start === '' && settings.beta_everyone === false, JSON.stringify({ beta_start: settings.beta_start, beta_everyone: settings.beta_everyone }));
  const log = await rows('Log');
  check('the Log says who was deleted and that Kevin was moved back',
    log.filter((l) => l.What === 'Deleting test account').map((l) => l.Who).join(',') === 'ava@example.com,ben@example.com' && log.some((l) => l.What === 'Changed type' && l.Detail === 'Test → Member · cleared 2 practice days'));
  const me = await api({ action: 'me', token: kevin.token });
  check('Kevin is still signed in: a member waiting for Day 1', me.ok && me.me.person.type === 'Member' && me.me.program.phase === 'before' && !me.me.program.beta, JSON.stringify(me.error || me.me.program));
  const goneMe = await api({ action: 'me', token: ava.token });
  check('a tester’s phone is told the account no longer exists', goneMe.code === 'auth' && /no longer exists/.test(goneMe.error), JSON.stringify(goneMe));
  const back = await join('ava@example.com');
  check('the tester can sign up again right away, as a real member', back.ok && back.me.person.type === 'Member', JSON.stringify(back.error || ''));

  // Run again (no beta set any more): it still keeps Kevin first, and finds nothing to delete.
  r = cli(['end-beta', 'kevin@example.com']);
  check('a second run (beta already off) previews safely: 0 to delete, Kevin kept', r.code === 0 && /No beta is set any more/.test(r.out) && /Would delete 0 test account/.test(r.out) && /Keep: kevin@example.com \(Member/.test(r.out), r.out);
  r = cli(['setting', 'preview_today', '--clear']);
  check('setting <key> --clear blanks a value (an empty "" never reaches node in PowerShell)', r.code === 0 && /"ok": true/.test(r.out), r.out);

  // A real member made Test by a Type cell changed by hand (or a one-column sort) is flagged in the list.
  await join('sam@example.com');
  await get('/dev/cell?email=' + encodeURIComponent('sam@example.com') + '&col=Type&value=Test');
  r = cli(['purge-tests']);
  check('purge-tests flags someone who is neither a beta sign-up nor moved to Test', r.code === 0 && /sam Tester <sam@example.com> · how they became Test is unknown[^\n]*\n\s+<-- not a beta sign-up, and the Log has no move to Test/.test(r.out), r.out);
  r = cli(['purge-tests', '--yes=' + codeIn(r.out)]);
  check('…and purge-tests --yes=<code> deletes exactly that list', r.code === 0 && /Deleted 1 test account/.test(r.out) && (await testers()) === '', r.out);

  await get('/dev/time?clear=1');
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  process.exitCode = failed ? 1 : 0;
})().catch((e) => {
  console.error('FAILED', e);
  process.exitCode = 1;
});
