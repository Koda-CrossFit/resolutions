'use strict';

/**
 * The beta test (Settings beta_start / beta_days): a practice run that Test accounts go through on
 * the real dates, sign-ups through the beta link (?beta=1), the 2026 stand-in videos, the edit
 * window around a missed day, and clearing one test account.   node --test "tests/*.test.js"
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { createGas } = require('../dev/gas-mock.js');

const ADMIN = 'test-admin-key-123';
const DAYS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'days-2027.json'), 'utf8'));
// The public plan file has no 2026 references (they live in the private plan); the stand-ins need them.
const REFS = ['nbg1s1gdjJk', 'As3Zpd7XEY8', 'KBOW32PKgfI', 'tscdhnnCIV4', '9C14vwKA9Cs', '_NLEqrDAl4Q', '_szhT8Sieq8'];
const PLAN = DAYS.map((d, i) => Object.assign({}, d, { ref: REFS[i] ? REFS[i] + " 'Day " + (i + 1) + "- 2026' - re-record at about 3 minutes" : '' }));
const BETA = { beta_start: '2026-11-09', beta_days: 7 };
const TUESDAY = '2026-11-10T09:00:00-07:00';

function world(at, settings) {
  const gas = createGas();
  gas.setNow(at || TUESDAY);
  const post = (body) => gas.post(Object.assign({ type: 'res27' }, body));
  const setup = post({ action: 'adminSetup', key: ADMIN, days: PLAN, settings });
  assert.equal(setup.ok, true, setup.error);
  return { gas, post };
}

const SETUP = {
  goal: 'fatloss',
  track: { nutrition: true, workout: true, sleep: true, protein: false, hydration: false, finishers: true, skill: false, mobility: false, recovery: false, other: false },
  plan: 'recommended',
  sleepHours: 7,
  finishersPerWeek: 2,
  coaches: [],
};

function signUp(post, extra) {
  return post(Object.assign({
    action: 'register', memberType: 'member', first: 'Kevin', last: 'Beta', email: 'beta@example.com', password: 'secret1',
    shirt: 'tee', size: 'L', setup: SETUP, beta: true,
  }, extra || {}));
}

function setSetting(gas, key, value) {
  const sheet = gas.sheet('Settings');
  const row = sheet.getDataRange().getValues().findIndex((r) => r[0] === key) + 1;
  assert.ok(row > 0, 'no setting ' + key);
  sheet.getRange(row, 2).setValue(value);
  gas.state.cache.clear();
}

test('beta link sign-ups go through Nov 9 – 15 on the real dates; everyone else keeps Jan 18', () => {
  const { gas, post } = world(TUESDAY, BETA);
  const cfg = post({ action: 'config' }).config;
  assert.deepEqual(cfg.beta, { start: '2026-11-09', end: '2026-11-15', days: 7 });
  assert.equal(cfg.startDate, '2027-01-18', 'the real challenge dates stay put');

  const r = signUp(post);
  assert.equal(r.ok, true, r.error);
  const p = r.me.program;
  assert.equal(r.me.person.type, 'Test');
  assert.deepEqual([p.start, p.end, p.length, p.today, p.dayNumber, p.phase, p.beta], ['2026-11-09', '2026-11-15', 7, '2026-11-10', 2, 'during', true]);
  assert.deepEqual([p.editFrom, p.editTo], ['2026-11-09', '2026-11-10'], 'yesterday (Day 1) can still be filled in');
  assert.deepEqual(Object.keys(r.me.checklists).sort(), ['2026-11-09', '2026-11-10']);
  assert.equal(r.me.days.length, 7);
  assert.equal(r.me.days[0].title, DAYS[0].title, 'Day 1 has the plan’s Day 1');
  assert.equal(r.me.days[0].weekday, 'Mon');
  assert.equal(r.me.days[2].released, false, 'Wednesday unlocks Wednesday');

  const row = gas.rows('Participants')[0];
  assert.equal(row['Type'], 'Test');
  assert.equal(row['Payment'], '');
  assert.equal(row['Paid'], 'n/a');
  assert.match(row['Notes'], /Beta test sign-up \(chose Koda Member\)/);

  const member = signUp(post, { email: 'member@example.com', beta: false });
  assert.equal(member.me.person.type, 'Member');
  assert.deepEqual([member.me.program.start, member.me.program.phase, member.me.program.beta], ['2027-01-18', 'before', false]);

  const summary = post({ action: 'adminSummary', key: ADMIN });
  assert.equal(summary.total, 1, 'beta testers stay out of the counts');
  assert.equal(summary.testAccounts, 1);
});

test('the beta welcome email has the beta dates and link; a remote beta sign-up never pays', () => {
  const { gas, post } = world(TUESDAY, BETA);
  const r = signUp(post, { memberType: 'remote', payment: 'venmo', email: 'remote.beta@example.com' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.emailed, true);
  const mail = gas.state.mail[gas.state.mail.length - 1];
  assert.equal(mail.to, 'remote.beta@example.com');
  assert.match(mail.subject, /You’re in the beta/);
  for (const bit of ['Monday, November 9', 'Sunday, November 15', 'resolutions/?beta=1', 'Overdue', 'for 2 more days', 'Monday, January 18']) {
    assert.ok(mail.htmlBody.includes(bit), 'email mentions ' + bit);
  }
  assert.ok(!/venmo\.com|\$99/.test(mail.htmlBody), 'no payment in a beta email');
  assert.equal(r.me.person.type, 'Test');
  assert.equal(r.me.person.paid, null);
  assert.equal(r.me.payUrl, '');
  const row = gas.rows('Participants')[0];
  assert.equal(row['Payment'], '');
  assert.match(row['Notes'], /chose Remote · Venmo/);
  assert.equal(row['Welcome Email'], 'Sent');
});

test('without a beta test, a beta sign-up is stopped (never quietly made real); a normal one goes through', () => {
  const { gas, post } = world(TUESDAY);
  assert.equal(post({ action: 'config' }).config.beta, null);
  const stopped = signUp(post, { memberType: 'remote', payment: 'venmo' });
  assert.equal(stopped.code, 'beta_over');
  assert.match(stopped.error, /beta test is over/);
  assert.equal(gas.rows('Participants').length, 0, 'nothing written');
  assert.equal(gas.state.mail.length, 0, 'no email');
  const r = signUp(post, { beta: false });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.me.person.type, 'Member');
  assert.deepEqual([r.me.program.start, r.me.program.beta], ['2027-01-18', false]);
  assert.match(gas.state.mail[gas.state.mail.length - 1].subject, /^You’re in: /);
  assert.equal(gas.rows('Participants')[0]['Notes'], '');
});

test('with edit_days_back 0 the beta email doesn’t promise an Overdue day', () => {
  const { gas, post } = world(TUESDAY, Object.assign({ edit_days_back: 0 }, BETA));
  const r = signUp(post);
  assert.equal(r.ok, true, r.error);
  const html = gas.state.mail[gas.state.mail.length - 1].htmlBody;
  assert.ok(!/Overdue/.test(html), 'no Overdue promise');
  assert.match(html, /locks at midnight/);
  assert.match(html, /you’ll sign up again/);
  assert.deepEqual([r.me.program.editFrom, r.me.program.editTo], ['2026-11-10', '2026-11-10']);
});

test('a missed beta day can be filled in for edit_days_back days, then it locks', () => {
  const { gas, post } = world(TUESDAY, BETA);
  const r = signUp(post);
  const monday = post({ action: 'save', token: r.token, date: '2026-11-09', answers: { video: 1, workout: 1 }, patch: true });
  assert.equal(monday.ok, true, monday.error);
  assert.equal(monday.entry.d, 2);
  let rows = gas.rows('Check-ins');
  assert.deepEqual([rows.length, rows[0]['Date'], Number(rows[0]['Day'])], [1, '2026-11-09', 1]);
  assert.equal(post({ action: 'save', token: r.token, date: '2026-11-11', answers: { video: 1 } }).code, 'locked_day', 'not before it happens');

  gas.setNow('2026-11-11T21:00:00-07:00');
  assert.equal(post({ action: 'save', token: r.token, date: '2026-11-09', answers: { sleep: 1 }, patch: true }).ok, true, 'Wednesday is Monday’s last day');

  gas.setNow('2026-11-12T06:00:00-07:00');
  const me = post({ action: 'me', token: r.token }).me;
  assert.deepEqual([me.program.dayNumber, me.program.editFrom], [4, '2026-11-10']);
  assert.ok(!me.checklists['2026-11-09'], 'Monday is locked');
  assert.equal(post({ action: 'save', token: r.token, date: '2026-11-09', answers: { video: 1 } }).code, 'locked_day');
  assert.equal(post({ action: 'save', token: r.token, date: '2026-11-10', answers: { video: 1 } }).ok, true, 'Tuesday is still open');
  rows = gas.rows('Check-ins');
  assert.deepEqual(rows.map((x) => x['Date']).sort(), ['2026-11-09', '2026-11-10']);
});

test('beta days play the 2026 stand-in video; members never see it, and a pasted link wins', () => {
  const { gas, post } = world(TUESDAY, BETA);
  const r = signUp(post);
  assert.deepEqual(r.me.days[0].videos, [{ label: '', url: 'https://www.youtube.com/watch?v=nbg1s1gdjJk', youtube: 'nbg1s1gdjJk', standIn: true }]);
  assert.equal(r.me.days[1].videos[0].youtube, 'As3Zpd7XEY8');
  assert.equal(r.me.days[2].videos, undefined, 'nothing about a day before it unlocks');

  signUp(post, { email: 'member@example.com', beta: false });
  gas.setNow('2027-01-19T09:00:00-07:00');
  const member = post({ action: 'login', email: 'member@example.com', password: 'secret1' }).me;
  assert.equal(member.program.dayNumber, 2);
  assert.deepEqual(member.days[0].videos, [], 'the real challenge never plays a stand-in');

  gas.setNow(TUESDAY);
  const sheet = gas.sheet('Days');
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.getRange(2, head.indexOf('Video URL') + 1).setValue('https://youtu.be/AbCdEfGhIjK');
  gas.state.cache.clear();
  const again = post({ action: 'me', token: r.token }).me;
  assert.deepEqual(again.days[0].videos, [{ label: '', url: 'https://youtu.be/AbCdEfGhIjK', youtube: 'AbCdEfGhIjK' }]);
});

test('the beta ends on its last day; turning it off puts Test accounts back on the real dates', () => {
  const { gas, post } = world(TUESDAY, BETA);
  const r = signUp(post);
  post({ action: 'save', token: r.token, date: '2026-11-10', answers: { video: 1 }, patch: true });
  gas.setNow('2026-11-15T18:00:00-07:00');
  let me = post({ action: 'me', token: r.token }).me;
  assert.deepEqual([me.program.dayNumber, me.program.phase, me.program.week], [7, 'during', 1]);
  gas.setNow('2026-11-16T18:00:00-07:00');
  me = post({ action: 'me', token: r.token }).me;
  assert.deepEqual([me.program.phase, me.program.editFrom, me.program.editTo], ['after', '2026-11-14', '2026-11-15'], 'the last two days stay open after the end');
  assert.equal(me.totals.days, 1);
  // Over: the beta link stops making Test accounts even though beta_start is still set. A beta page
  // left open and sent now is stopped; the same person signing up normally is a real member.
  gas.state.cache.clear();
  assert.equal(post({ action: 'config' }).config.beta, null);
  assert.equal(signUp(post, { email: 'late@example.com' }).code, 'beta_over');
  const late = signUp(post, { email: 'late@example.com', beta: false });
  assert.deepEqual([late.me.person.type, late.me.program.start], ['Member', '2027-01-18']);

  const off = post({ action: 'adminSetup', key: ADMIN, settings: { beta_start: '' } });
  assert.equal(off.ok, true, off.error);
  me = post({ action: 'me', token: r.token }).me;
  assert.deepEqual([me.program.start, me.program.phase, me.program.beta], ['2027-01-18', 'before', false]);
  assert.deepEqual(me.history, {}, 'beta check-ins are outside the real challenge');
  assert.equal(me.totals.points, 0);
});

test('preview_today is ignored while a beta is set (beta testers stay on the real date), and works again after', () => {
  const { gas, post } = world(TUESDAY, BETA);
  const kevin = signUp(post);
  const tess = signUp(post, { email: 'tess@example.com', first: 'Tess' });
  setSetting(gas, 'preview_today', '2026-11-13');
  for (const t of [kevin.token, tess.token]) {
    const me = post({ action: 'me', token: t }).me;
    assert.deepEqual([me.program.today, me.program.dayNumber, me.program.preview, me.program.beta], ['2026-11-10', 2, false, true]);
  }
  assert.equal(post({ action: 'save', token: tess.token, date: '2026-11-13', answers: { video: 1 } }).code, 'locked_day', 'no saving a day that hasn’t happened');
  assert.equal(post({ action: 'save', token: tess.token, date: '2026-11-09', answers: { video: 1 }, patch: true }).ok, true, 'yesterday is still open');
  // Beta over: the preview works for Test accounts on the real challenge again.
  setSetting(gas, 'beta_start', '');
  setSetting(gas, 'preview_today', '2027-01-21');
  const me = post({ action: 'me', token: kevin.token }).me;
  assert.deepEqual([me.program.start, me.program.today, me.program.dayNumber, me.program.preview, me.program.beta], ['2027-01-18', '2027-01-21', 4, true, false]);
});

test('clearing test accounts never deletes rows whose ID cell got separated from the rest of the row', () => {
  const { gas, post } = world(TUESDAY, BETA);
  const tester = signUp(post, { email: 'tester@example.com' });
  const member = signUp(post, { email: 'member@example.com', beta: false });
  assert.equal(member.ok, true, member.error);
  // App Data sorted on its ID column only: each ID cell now sits next to the other person's data.
  const app = gas.sheet('App Data');
  const ids = app.getRange(2, 1, 2, 1).getValues();
  app.getRange(2, 1, 2, 1).setValues([ids[1], ids[0]]);
  const out = post({ action: 'adminPurgeTests', key: ADMIN, email: 'tester@example.com' });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.removed, { participants: 1, accounts: 1, appdata: 0, checkins: 0 });
  assert.equal(out.skipped.length, 1);
  assert.match(out.skipped[0], /App Data row \d+/);
  const left = gas.rows('App Data').map((r) => JSON.parse(r.History)._id).sort();
  assert.deepEqual(left, [member.me.person.id, tester.me.person.id].sort(), 'both App Data rows kept, so nobody lost data');
});

test('purging one test account by email leaves everyone else', () => {
  const { gas, post } = world(TUESDAY, BETA);
  const a = signUp(post, { email: 'a@example.com' });
  signUp(post, { email: 'b@example.com' });
  signUp(post, { email: 'm@example.com', beta: false });
  post({ action: 'save', token: a.token, date: '2026-11-10', answers: { video: 1 }, patch: true });
  const out = post({ action: 'adminPurgeTests', key: ADMIN, email: 'A@Example.com ' });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.removed, { participants: 1, accounts: 1, appdata: 1, checkins: 1 });
  assert.deepEqual(gas.rows('Participants').map((p) => p.Email).sort(), ['b@example.com', 'm@example.com']);
  assert.equal(post({ action: 'adminPurgeTests', key: ADMIN, email: 'm@example.com' }).error, 'No Test participant with that email.', 'never a member');
  assert.equal(post({ action: 'adminPurgeTests', key: ADMIN, email: 'not-an-email' }).ok, false);
  assert.equal(gas.rows('Participants').length, 2);
});
