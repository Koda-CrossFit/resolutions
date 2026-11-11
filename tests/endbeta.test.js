'use strict';

/**
 * Ending the beta (Kevin, 11/11: "Delete with the beta"): Kevin's own account goes back to Member
 * with its practice days cleared, every other beta account is deleted (after a dry run, with a keep
 * guard and an exact-list check, all rows checked before anything goes), each deletion is logged,
 * and a phone still signed in to a deleted account is told why.   node --test "tests/*.test.js"
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { createGas } = require('../dev/gas-mock.js');

const ADMIN = 'test-admin-key-123';
const DAYS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'days-2027.json'), 'utf8'));
const BETA = { beta_start: '2026-11-09', beta_days: 7 };
const EVERYONE = Object.assign({ beta_everyone: true }, BETA);

function world(at, settings) {
  const gas = createGas();
  gas.setNow(at || '2026-11-10T09:00:00-07:00');
  const post = (body) => gas.post(Object.assign({ type: 'res27' }, body));
  const setup = post({ action: 'adminSetup', key: ADMIN, days: DAYS, settings: Object.assign({ welcome_email: false }, settings || {}) });
  assert.equal(setup.ok, true, setup.error);
  return { gas, post };
}

const SETUP = {
  goal: 'health',
  track: { nutrition: false, workout: true, sleep: true, protein: false, hydration: false, finishers: false, skill: false, mobility: false, recovery: false, other: false },
  plan: 'recommended',
  sleepHours: 7,
  coaches: [],
};

function join(post, email, extra) {
  const r = post(Object.assign({
    action: 'register', memberType: 'member', first: email.split('@')[0], last: 'Tester', email, password: 'secret1',
    shirt: 'tee', size: 'L', setup: SETUP,
  }, extra || {}));
  assert.equal(r.ok, true, r.error);
  return r;
}

const setType = (post, email, participantType, extra) => post(Object.assign({ action: 'adminSetType', key: ADMIN, email, participantType }, extra || {}));
const saveDay = (post, token, date) => {
  const r = post({ action: 'save', token, date, answers: { video: 1, workout: 1, sleep: 1 }, patch: true });
  assert.equal(r.ok, true, r.error);
};
const tabCounts = (gas) => ['Participants', 'Accounts', 'App Data', 'Check-ins', 'Questions'].map((t) => gas.rows(t).length);

test('moving Kevin off Test clears his practice days (only those) and recounts his row', () => {
  // A week before the beta, his account (moved to Test) previews a real day, which is inside the
  // real challenge, so it's never cleared (README says to preview with a separate account).
  const { gas, post } = world('2026-11-05T09:00:00-07:00', { preview_today: '2027-01-18' });
  const kevin = join(post, 'kevin@example.com');
  assert.equal(kevin.me.person.type, 'Member');
  const onto = setType(post, 'kevin@example.com', 'Test');
  assert.deepEqual([onto.was, onto.type, onto.cleared], ['Member', 'Test', null], 'moving onto Test clears nothing');
  saveDay(post, kevin.token, '2027-01-18');
  // Then the beta (preview_today is ignored while it's set), and two practice days.
  gas.setNow('2026-11-10T09:00:00-07:00');
  assert.equal(post({ action: 'adminSetup', key: ADMIN, settings: BETA }).ok, true);
  saveDay(post, kevin.token, '2026-11-09');
  saveDay(post, kevin.token, '2026-11-10');
  assert.equal(gas.rows('Check-ins').length, 3);
  assert.equal(Number(gas.rows('Participants')[0]['Days Logged']), 2, 'his row holds the beta’s totals');

  gas.setNow('2026-11-17T09:00:00-07:00');
  const out = setType(post, 'Kevin@Example.com', 'Member');
  assert.equal(out.ok, true, out.error);
  assert.deepEqual([out.was, out.type], ['Test', 'Member']);
  const hist = JSON.parse(gas.rows('App Data')[0].History);
  assert.deepEqual(Object.keys(hist).filter((k) => k !== '_id'), ['2027-01-18'], 'only the real-challenge day is left');
  assert.deepEqual(out.cleared, { days: 2, checkins: 2, points: hist['2027-01-18'].p, daysLogged: 1 });
  assert.deepEqual(gas.rows('Check-ins').map((r) => r.Date), ['2027-01-18']);
  const row = gas.rows('Participants')[0];
  assert.deepEqual([row.Type, Number(row['Days Logged']), Number(row.Points)], ['Member', 1, hist['2027-01-18'].p], 'his row is counted again');
  assert.deepEqual(gas.rows('Log').filter((r) => r.What === 'Changed type').map((r) => r.Detail), ['Member → Test', 'Test → Member · cleared 2 practice days']);
  const me = post({ action: 'me', token: kevin.token });
  assert.equal(me.ok, true, me.error);
  assert.deepEqual([me.me.person.type, me.me.program.phase, me.me.program.beta], ['Member', 'before', false], 'still signed in, a member waiting for Day 1');

  const again = setType(post, 'kevin@example.com', 'Member');
  assert.deepEqual([again.was, again.cleared], ['Member', null], 'already a member: nothing to clear');
  assert.equal(gas.rows('Log').filter((r) => r.What === 'Changed type').length, 2, 'no change, no new line');
  assert.equal(setType(post, 'kevin@example.com', 'member').error, 'participantType must be Member, Remote or Test.');
  assert.equal(setType(post, 'nobody@example.com', 'Member').error, 'No participant with that email.');
});

test('clearPractice clears a member whose Type was changed back by hand (end-beta always sends it)', () => {
  const { gas, post } = world('2026-11-10T09:00:00-07:00', BETA);
  const kevin = join(post, 'kevin@example.com');
  setType(post, 'kevin@example.com', 'Test');
  saveDay(post, kevin.token, '2026-11-09');
  saveDay(post, kevin.token, '2026-11-10');
  // Kevin types Member into his own Type cell.
  const people = gas.sheet('Participants');
  const typeCol = people.getRange(1, 1, 1, people.getLastColumn()).getValues()[0].indexOf('Type') + 1;
  people.getRange(2, typeCol).setValue('Member');
  gas.setNow('2026-11-17T09:00:00-07:00');
  const plain = setType(post, 'kevin@example.com', 'Member');
  assert.deepEqual([plain.was, plain.cleared], ['Member', null], 'without it, a member is left alone');
  const out = setType(post, 'kevin@example.com', 'Member', { clearPractice: true });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.cleared, { days: 2, checkins: 2, points: 0, daysLogged: 0 });
  assert.equal(gas.rows('Check-ins').length, 0);
  assert.deepEqual([Number(gas.rows('Participants')[0].Points), Number(gas.rows('Participants')[0]['Days Logged'])], [0, 0]);
  assert.match(gas.rows('Log').filter((r) => r.What === 'Changed type').pop().Detail, /^Member → Member · cleared 2 practice days$/);
  assert.deepEqual(setType(post, 'kevin@example.com', 'Member', { clearPractice: true }).cleared, { days: 0, checkins: 0, points: 0, daysLogged: 0 }, 'safe to repeat');
});

test('clearing practice days stops, changing nothing, when rows don’t line up', () => {
  const { gas, post } = world('2026-11-10T09:00:00-07:00', BETA);
  const kevin = join(post, 'kevin@example.com');
  join(post, 'other@example.com');
  setType(post, 'kevin@example.com', 'Test');
  saveDay(post, kevin.token, '2026-11-10');
  // App Data sorted on its ID column only.
  const app = gas.sheet('App Data');
  const ids = app.getRange(2, 1, 2, 1).getValues();
  app.getRange(2, 1, 2, 1).setValues([ids[1], ids[0]]);
  const sorted = setType(post, 'kevin@example.com', 'Member');
  assert.equal(sorted.code, 'mismatch');
  assert.match(sorted.error, /App Data does not match ID .*Undo the sort\. Nothing was changed\.$/);
  app.getRange(2, 1, 2, 1).setValues(ids);
  // The Participants ID column sorted on its own: Kevin's row now carries the other person's ID.
  const people = gas.sheet('Participants');
  const pids = people.getRange(2, 1, 2, 1).getValues();
  people.getRange(2, 1, 2, 1).setValues([pids[1], pids[0]]);
  const swapped = setType(post, 'kevin@example.com', 'Member');
  assert.equal(swapped.code, 'mismatch');
  assert.match(swapped.error, /the Accounts tab gives that ID to other@example\.com/);
  assert.equal(gas.rows('Participants').find((r) => r.Email === 'kevin@example.com').Type, 'Test', 'still Test');
  assert.equal(gas.rows('Check-ins').length, 1, 'nothing deleted');
});

test('purge: a dry run lists who would go, keep guards an account, ids/expect check the list, each one is logged first', () => {
  const { gas, post } = world('2026-11-10T09:00:00-07:00', EVERYONE);
  join(post, 'kevin@example.com'); // beta_everyone: a Test account
  const ava = join(post, 'ava@example.com', { memberType: 'remote', payment: 'venmo' });
  join(post, 'ben@example.com');
  saveDay(post, ava.token, '2026-11-10');
  gas.setNow('2026-11-17T08:00:00-07:00');
  assert.equal(join(post, 'real@example.com').me.person.type, 'Member', 'after the beta, sign-ups are real');
  const before = tabCounts(gas);

  const dry = post({ action: 'adminPurgeTests', key: ADMIN, dryRun: true, keep: ['Kevin@Example.com '] });
  assert.equal(dry.ok, true, dry.error);
  assert.deepEqual(dry.problems, []);
  assert.deepEqual(dry.people.map((p) => p.email), ['ava@example.com', 'ben@example.com']);
  assert.deepEqual(dry.kept, [{ email: 'kevin@example.com', type: 'Test' }]);
  assert.match(dry.people[0].notes, /chose Remote · Venmo/);
  assert.deepEqual([dry.people[0].days, dry.people[0].payment, dry.people[0].paid], [1, '', false], 'a beta sign-up owes nothing');
  assert.match(dry.people[0].signedUp, /^Nov 10, 9:00 AM$/);
  assert.deepEqual(tabCounts(gas), before, 'a dry run deletes nothing');

  const wrong = post({ action: 'adminPurgeTests', key: ADMIN, keep: ['kevin@example.com'], expect: 3 });
  assert.equal(wrong.code, 'expect');
  assert.match(wrong.error, /Expected 3 test accounts to delete, but found 2/);
  const other = post({ action: 'adminPurgeTests', key: ADMIN, keep: ['kevin@example.com'], ids: [dry.people[0].id, 'RNOTHER'] });
  assert.equal(other.code, 'changed', 'same count, different people');
  assert.equal(post({ action: 'adminPurgeTests', key: ADMIN, keep: ['not-an-email'] }).ok, false);
  assert.equal(post({ action: 'adminPurgeTests', key: ADMIN, expect: 'two' }).ok, false);
  assert.equal(post({ action: 'adminPurgeTests', key: ADMIN, email: 'kevin@example.com', keep: ['kevin@example.com'] }).error, 'That email is on the keep list.');
  assert.deepEqual(tabCounts(gas), before, 'refusals delete nothing');

  const out = post({ action: 'adminPurgeTests', key: ADMIN, keep: ['kevin@example.com'], ids: dry.people.map((p) => p.id) });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.removed, { participants: 2, accounts: 2, appdata: 2, checkins: 1, questions: 0 });
  assert.deepEqual(out.people.map((p) => p.name), ['ava Tester', 'ben Tester']);
  assert.deepEqual(gas.rows('Participants').map((r) => r.Email).sort(), ['kevin@example.com', 'real@example.com'], 'the kept account (still Test) and the member stay');
  const logged = gas.rows('Log').filter((r) => r.What === 'Deleting test account');
  assert.deepEqual(logged.map((r) => r.Who), ['ava@example.com', 'ben@example.com']);
  assert.match(logged[0].Detail, /^ava Tester · R\w+ · [\d.]+ pts · 1 day · Beta test sign-up \(chose Remote · Venmo\)$/);
  assert.match(logged[1].Detail, /^ben Tester · R\w+ · 0 pts · 0 days · Beta test sign-up \(chose Koda Member\)$/);
});

test('the list says how each person became Test, so a Type cell changed by hand stands out', () => {
  const { gas, post } = world('2026-11-05T09:00:00-07:00', BETA);
  join(post, 'moved@example.com');
  setType(post, 'moved@example.com', 'Test');
  join(post, 'sorted@example.com');
  gas.setNow('2026-11-10T09:00:00-07:00');
  join(post, 'beta@example.com', { beta: true });
  // A one-column sort of Type made sorted@ Test without anyone moving them.
  const people = gas.sheet('Participants');
  const typeCol = people.getRange(1, 1, 1, people.getLastColumn()).getValues()[0].indexOf('Type') + 1;
  people.getRange(gas.rows('Participants').find((r) => r.Email === 'sorted@example.com')._row, typeCol).setValue('Test');
  const dry = post({ action: 'adminPurgeTests', key: ADMIN, dryRun: true });
  assert.deepEqual(dry.people.map((p) => [p.email, p.how]), [['moved@example.com', 'moved to Test'], ['sorted@example.com', ''], ['beta@example.com', 'beta sign-up']]);
});

test('a Questions row whose email was corrected by hand is left alone; it doesn’t block the purge', () => {
  const { gas, post } = world('2026-11-10T09:00:00-07:00', EVERYONE);
  const ava = join(post, 'ava@exmaple.com');
  assert.equal(post({ action: 'ask', token: ava.token, question: 'How do I log a rest day?' }).ok, true);
  // Kevin fixes the typo on Participants and Accounts (the Questions row keeps the old address).
  for (const tab of ['Participants', 'Accounts']) {
    const sheet = gas.sheet(tab);
    const col = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].indexOf('Email') + 1;
    sheet.getRange(2, col).setValue('ava@example.com');
  }
  const dry = post({ action: 'adminPurgeTests', key: ADMIN, dryRun: true });
  assert.deepEqual(dry.problems, []);
  assert.equal(dry.leftAlone.length, 1);
  assert.match(dry.leftAlone[0], /^Questions row 2 \(ID \w+, ava@exmaple\.com\) kept: its email isn’t ava@example\.com$/);
  const out = post({ action: 'adminPurgeTests', key: ADMIN, ids: dry.people.map((p) => p.id) });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.removed, { participants: 1, accounts: 1, appdata: 1, checkins: 0, questions: 0 });
  assert.equal(gas.rows('Questions').length, 1, 'the question stays on the record');
});

test('a real Remote moved onto the beta is listed with what they pay, and the Log keeps it', () => {
  const { gas, post } = world('2026-11-05T09:00:00-07:00', BETA);
  join(post, 'rita@example.com', { memberType: 'remote', payment: 'venmo' });
  const people = gas.sheet('Participants');
  const paidCol = people.getRange(1, 1, 1, people.getLastColumn()).getValues()[0].indexOf('Paid') + 1;
  people.getRange(2, paidCol).setValue(true);
  setType(post, 'rita@example.com', 'Test');
  const dry = post({ action: 'adminPurgeTests', key: ADMIN, dryRun: true });
  assert.deepEqual([dry.people[0].payment, dry.people[0].paid], ['Venmo', true]);
  assert.equal(post({ action: 'adminPurgeTests', key: ADMIN, ids: [dry.people[0].id] }).ok, true);
  assert.match(gas.rows('Log').find((r) => r.What === 'Deleting test account').Detail, /pays by Venmo \(PAID\)/);
});

test('purge: if the Participants ID column was sorted on its own, nothing is deleted, not even a kept account’s rows', () => {
  const { gas, post } = world('2026-11-10T09:00:00-07:00', BETA);
  const kevin = join(post, 'kevin@example.com');
  setType(post, 'kevin@example.com', 'Test');
  saveDay(post, kevin.token, '2026-11-10');
  const ava = join(post, 'ava@example.com', { beta: true });
  saveDay(post, ava.token, '2026-11-10');
  gas.setNow('2026-11-16T09:00:00-07:00');
  const mia = join(post, 'mia@example.com');
  assert.equal(mia.me.person.type, 'Member');
  // Swap the ID cells of ava (Test) and mia (a real member) only.
  const people = gas.sheet('Participants');
  const rowOf = (email) => gas.rows('Participants').find((r) => r.Email === email)._row;
  const a = rowOf('ava@example.com');
  const m = rowOf('mia@example.com');
  const aId = people.getRange(a, 1).getValue();
  people.getRange(a, 1).setValue(people.getRange(m, 1).getValue());
  people.getRange(m, 1).setValue(aId);
  const before = tabCounts(gas);
  const dry = post({ action: 'adminPurgeTests', key: ADMIN, dryRun: true, keep: ['kevin@example.com'] });
  assert.equal(dry.people.length, 1);
  assert.equal(dry.problems.length, 2, JSON.stringify(dry.problems));
  assert.match(dry.problems[0], /^Participants row \d+ \(ava@example\.com, ID \w+\): the Accounts tab gives that ID to mia@example\.com \(a sorted ID column, or an email changed on only one of the two tabs\)$/);
  assert.match(dry.problems[1], /^Accounts row \d+ \(ID \w+, mia@example\.com\) doesn’t match the rest of its row$/, 'mia’s own account row is caught too');
  const out = post({ action: 'adminPurgeTests', key: ADMIN, keep: ['kevin@example.com'], ids: dry.people.map((p) => p.id) });
  assert.equal(out.code, 'mismatch');
  assert.deepEqual(tabCounts(gas), before, 'nothing deleted');
  // Kevin's ID in a tester's row: still refused.
  people.getRange(a, 1).setValue(people.getRange(m, 1).getValue());
  people.getRange(m, 1).setValue(aId);
  const k = rowOf('kevin@example.com');
  const kId = people.getRange(k, 1).getValue();
  people.getRange(k, 1).setValue(people.getRange(a, 1).getValue());
  people.getRange(a, 1).setValue(kId);
  const dry2 = post({ action: 'adminPurgeTests', key: ADMIN, dryRun: true, keep: ['kevin@example.com'] });
  assert.match(dry2.problems[0], /that ID belongs to a kept account/);
  assert.equal(post({ action: 'adminPurgeTests', key: ADMIN, keep: ['kevin@example.com'] }).code, 'mismatch');
  assert.deepEqual(tabCounts(gas), before, 'still nothing deleted');
});

test('a phone signed in to a deleted account is told it no longer exists and can sign up again', () => {
  const { gas, post } = world('2026-11-10T09:00:00-07:00', EVERYONE);
  const gone = join(post, 'gone@example.com');
  gas.setNow('2026-11-17T08:00:00-07:00');
  assert.equal(post({ action: 'adminPurgeTests', key: ADMIN, expect: 1 }).ok, true);
  for (const action of ['me', 'leaderboard']) {
    const r = post({ action, token: gone.token });
    assert.equal(r.code, 'auth', action);
    assert.match(r.error, /no longer exists \(beta and test accounts are deleted after the beta\)\. Sign up again/);
  }
  const back = join(post, 'gone@example.com');
  assert.equal(back.me.person.type, 'Member', 'a real sign-up now');
  assert.notEqual(back.me.person.id, gone.me.person.id);
  // An account whose Participants row was deleted by hand wasn't purged: sign in again (and get help).
  const people = gas.sheet('Participants');
  people.deleteRow(gas.rows('Participants').find((r) => r.Email === 'gone@example.com')._row);
  const lost = post({ action: 'me', token: back.token });
  assert.deepEqual([lost.code, lost.error], ['auth', 'Please sign in again.']);
  assert.equal(post({ action: 'login', email: 'gone@example.com', password: 'secret1' }).code, 'missing');
});

test('the summary shows the stored beta settings, its lock dates and the server’s date, and counts every Test row', () => {
  const { gas, post } = world('2026-11-10T09:00:00-07:00', EVERYONE);
  join(post, 'one@example.com');
  join(post, 'two@example.com');
  const app = gas.sheet('App Data');
  const ids = app.getRange(2, 1, 2, 1).getValues();
  app.getRange(2, 1, 2, 1).setValues([ids[1], ids[0]]);
  const s = post({ action: 'adminSummary', key: ADMIN });
  assert.equal(s.ok, true, s.error);
  assert.deepEqual(s.settings, { beta_start: '2026-11-09', beta_days: 7, beta_everyone: true, preview_today: '', registration_open: true, welcome_email: false });
  assert.deepEqual(s.beta, { start: '2026-11-09', end: '2026-11-15', days: 7, lastOpen: '2026-11-16', lockedFrom: '2026-11-17' });
  assert.equal(s.today, '2026-11-10');
  assert.equal(s.testAccounts, 2, 'even when their App Data doesn’t load');
  assert.equal(post({ action: 'adminSetup', key: ADMIN, settings: { beta_days: 10 } }).ok, true);
  assert.deepEqual(post({ action: 'adminSummary', key: ADMIN }).beta, { start: '2026-11-09', end: '2026-11-18', days: 10, lastOpen: '2026-11-23', lockedFrom: '2026-11-24' }, 'a part week stays open until the day after it');
  assert.equal(post({ action: 'adminSetup', key: ADMIN, settings: { beta_start: '' } }).ok, true);
  assert.equal(post({ action: 'adminSummary', key: ADMIN }).beta, null);
});

test('setup reports a misspelled setting, and leaves an emptied Finishers tab empty', () => {
  const { gas, post } = world();
  const r = post({ action: 'adminSetup', key: ADMIN, settings: { 'beta-start': '2026-11-09' } });
  assert.deepEqual(r.unknown, ['beta-start']);
  assert.equal(post({ action: 'adminSummary', key: ADMIN }).settings.beta_start, '', 'nothing stored');
  assert.equal(gas.rows('Finishers').length, 1, 'a new sheet gets the example');
  gas.sheet('Finishers').deleteRow(2);
  assert.equal(post({ action: 'adminSetup', key: ADMIN, settings: { beta_start: '', beta_everyone: false } }).ok, true);
  assert.equal(gas.rows('Finishers').length, 0, 'beta off (which runs setup) doesn’t put it back');
});
