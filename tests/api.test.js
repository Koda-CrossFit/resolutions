'use strict';

/**
 * Backend tests against the in-memory Apps Script mock: `node --test tests/`
 * Each test builds its own world, so they don't depend on each other.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { createGas } = require('../dev/gas-mock.js');

const ADMIN = 'test-admin-key-123';
const DAYS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'days-2027.json'), 'utf8'));

function world(at) {
  const gas = createGas();
  gas.setNow(at || '2026-11-09T10:00:00-07:00');
  const post = (body) => gas.post(Object.assign({ type: 'res27' }, body));
  const setup = post({ action: 'adminSetup', key: ADMIN, days: DAYS });
  assert.equal(setup.ok, true, setup.error);
  return { gas, post };
}

const SETUP = {
  goal: 'muscle',
  track: { nutrition: true, workout: true, sleep: true, finishers: true, hydration: true, skill: true, mobility: true, other: true },
  plan: 'macros',
  macros: { protein: 180, carbs: 250, fat: 70, calories: 2400, wantHelp: true },
  sleepHours: 8,
  hydrationOz: 100,
  finishersPerWeek: 2,
  skill: 'Muscle-ups',
  mobility: 'Hips and ankles',
  other: ['No alcohol', '10k steps'],
  coaches: ['Maggie', 'Kevin', 'Nobody', 'Maggie'],
};

function register(post, extra) {
  return post(Object.assign({
    action: 'register',
    memberType: 'remote',
    payment: 'venmo',
    first: 'Casey',
    last: 'Lane',
    email: 'Casey.Lane@Example.com ',
    password: 'secret1',
    shirt: 'tank',
    size: 'S',
    setup: SETUP,
  }, extra || {}));
}

test('register builds the account, the participant row and a token', () => {
  const { gas, post } = world();
  const r = register(post);
  assert.equal(r.ok, true, r.error);
  assert.match(r.token, /^R[A-Z2-9]{6}\.1\.[a-z0-9]+\.[A-Za-z0-9_-]+$/);
  const me = r.me;
  assert.equal(me.person.email, 'casey.lane@example.com');
  assert.equal(me.person.type, 'Remote');
  assert.equal(me.person.paid, false);
  assert.equal(me.person.shirt, 'tank');
  assert.deepEqual(me.person.setup.coaches, ['Maggie', 'Kevin']);
  assert.equal(me.program.phase, 'before');
  assert.equal(me.program.start, '2027-01-11');
  assert.equal(me.program.end, '2027-02-21');
  assert.ok(me.preview.length >= 9, 'preview checklist has every tracked item');

  const people = gas.rows('Participants');
  assert.equal(people.length, 1);
  assert.equal(people[0]['Payment'], 'Venmo');
  assert.equal(people[0]['Shirt'], 'Ladies Tank');
  assert.equal(people[0]['Goal'], 'Muscle Gain');
  assert.equal(people[0]['Nutrition Plan'], 'Macros');
  assert.match(people[0]['Plan Details'], /P 180g/);
  assert.match(people[0]['Plan Details'], /WANTS HELP/);
  assert.match(people[0]['Daily Checklist'], /Skill: Muscle-ups/);
  assert.equal(people[0]['Coach Ranking'], '1. Maggie  2. Kevin');

  const accounts = gas.rows('Accounts');
  assert.equal(accounts.length, 1);
  assert.notEqual(accounts[0]['Password Hash'], 'secret1');
  assert.equal(String(accounts[0]['Password Hash']).length, 64);
  assert.equal(gas.state.mail.length, 1, 'welcome email');
  assert.match(gas.state.mail[0].subject, /You.re in/);
  assert.match(gas.state.mail[0].htmlBody, /\$99 remote spot/);
});

test('register refuses duplicates, bad input and closed sign-ups', () => {
  const { gas, post } = world();
  assert.equal(register(post).ok, true);
  const dup = register(post, { email: 'casey.lane@example.com' });
  assert.equal(dup.ok, false);
  assert.equal(dup.code, 'exists');
  assert.equal(register(post, { email: 'nope' }).ok, false);
  assert.equal(register(post, { email: 'a@b.co', password: '123' }).ok, false);
  assert.equal(register(post, { email: 'a@b.co', payment: '' }).ok, false);
  assert.equal(register(post, { email: 'a@b.co', memberType: 'member', payment: '' }).ok, true, 'members do not pay');
  assert.equal(register(post, { email: 'c@b.co', size: 'XXL' }).ok, false);
  assert.equal(register(post, { email: 'd@b.co', setup: Object.assign({}, SETUP, { goal: 'x' }) }).ok, false);
  assert.equal(register(post, { email: 'e@b.co', setup: Object.assign({}, SETUP, { skill: '' }) }).ok, false);
  assert.equal(register(post, { email: 'f@b.co', setup: Object.assign({}, SETUP, { plan: 'other', planOther: '' }) }).ok, false);
  // Kevin closes sign-ups in Settings
  const settings = gas.sheet('Settings');
  const values = settings.getDataRange().getValues();
  const row = values.findIndex((r) => r[0] === 'registration_open') + 1;
  settings.getRange(row, 2).setValue(false);
  gas.state.cache.clear();
  const closed = register(post, { email: 'g@b.co' });
  assert.equal(closed.code, 'closed');
});

test('a name that looks like a formula is stored as text', () => {
  const { gas, post } = world();
  assert.equal(register(post, { first: '=HYPERLINK("x")', email: 'h@b.co' }).ok, true);
  const people = gas.rows('Participants');
  assert.equal(people[0]['First Name'], '=HYPERLINK("x")');
  assert.equal(gas.sheet('Participants').getRange(2, 3).getFormula(), '');
});

test('login, wrong password lockout, and token checks', () => {
  const { gas, post } = world();
  register(post);
  const ok = post({ action: 'login', email: 'casey.lane@example.com', password: 'secret1' });
  assert.equal(ok.ok, true, ok.error);
  const me = post({ action: 'me', token: ok.token });
  assert.equal(me.ok, true);
  assert.equal(post({ action: 'me', token: ok.token.slice(0, -2) + 'xx' }).code, 'auth');
  assert.equal(post({ action: 'me', token: 'garbage' }).code, 'auth');
  assert.equal(post({ action: 'login', email: 'who@x.co', password: 'secret1' }).code, 'no_account');
  for (let i = 0; i < 7; i++) assert.equal(post({ action: 'login', email: 'casey.lane@example.com', password: 'wrong!' }).code, 'bad_password');
  assert.equal(post({ action: 'login', email: 'casey.lane@example.com', password: 'wrong!' }).code, 'bad_password');
  assert.equal(post({ action: 'login', email: 'casey.lane@example.com', password: 'secret1' }).code, 'locked');
  gas.setNow('2026-11-09T10:20:00-07:00');
  assert.equal(post({ action: 'login', email: 'casey.lane@example.com', password: 'secret1' }).ok, true);
});

test('password change and sign-out-everywhere end old tokens', () => {
  const { post } = world();
  const r = register(post);
  const changed = post({ action: 'password', token: r.token, current: 'secret1', password: 'newpass9' });
  assert.equal(changed.ok, true, changed.error);
  assert.equal(post({ action: 'me', token: r.token }).code, 'auth');
  assert.equal(post({ action: 'me', token: changed.token }).ok, true);
  assert.equal(post({ action: 'login', email: 'casey.lane@example.com', password: 'secret1' }).code, 'bad_password');
  assert.equal(post({ action: 'login', email: 'casey.lane@example.com', password: 'newpass9' }).ok, true);
  assert.equal(post({ action: 'signoutAll', token: changed.token }).ok, true);
  assert.equal(post({ action: 'me', token: changed.token }).code, 'auth');
});

test('reset by emailed code', () => {
  const { gas, post } = world();
  register(post);
  gas.state.mail.length = 0;
  assert.equal(post({ action: 'resetStart', email: 'casey.lane@example.com' }).ok, true);
  assert.equal(post({ action: 'resetStart', email: 'casey.lane@example.com' }).code, 'wait');
  const code = /(\d{6})/.exec(gas.state.mail[0].subject)[1];
  assert.equal(post({ action: 'resetFinish', email: 'casey.lane@example.com', code: '000000' === code ? '111111' : '000000', password: 'brandnew' }).code, 'bad_code');
  const done = post({ action: 'resetFinish', email: 'casey.lane@example.com', code, password: 'brandnew' });
  assert.equal(done.ok, true, done.error);
  assert.equal(post({ action: 'login', email: 'casey.lane@example.com', password: 'brandnew' }).ok, true);
  assert.equal(post({ action: 'resetFinish', email: 'casey.lane@example.com', code, password: 'again123' }).code, 'expired', 'a code works once');
});

test('daily check-ins: scoring, edit window, the sheet log', () => {
  const { gas, post } = world();
  const r = register(post);
  gas.setNow('2027-01-13T19:30:00-07:00'); // Day 3
  let me = post({ action: 'me', token: r.token }).me;
  assert.equal(me.program.phase, 'during');
  assert.equal(me.program.dayNumber, 3);
  assert.deepEqual(Object.keys(me.checklists).sort(), ['2027-01-11', '2027-01-12', '2027-01-13']);
  const list = me.checklists['2027-01-13'];
  const ids = list.map((i) => i.id);
  assert.deepEqual(ids.slice(0, 2), ['video', 'nutrition']);
  assert.ok(ids.includes('bonus'), 'Day 3 has the coach-goals bonus in the seed');
  const answers = {};
  list.forEach((item) => item.units.forEach((u) => (answers[u[0]] = 1)));
  answers['nutrition:snack'] = 0;
  answers['bogus'] = 1;
  const saved = post({ action: 'save', token: r.token, date: '2027-01-13', answers });
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.entry.a.bogus, undefined);
  const items = list.filter((i) => !i.units.every((u) => u[2]));
  assert.equal(saved.entry.n, items.length);
  assert.equal(saved.entry.d, items.length - 1, 'nutrition is not complete with a missed snack');
  // video 3 + meals 3 + workout 2 + sleep 1 + water 1 + finisher 2 + skill 1 + mobility 1 + 2 other + bonus 4
  assert.equal(saved.entry.p, 3 + 3 + 2 + 1 + 1 + 2 + 1 + 1 + 2 + 4);
  assert.equal(saved.entry.m, 3 + 4 + 2 + 1 + 1 + 1 + 1 + 2 + 4, 'finisher is extra credit');
  assert.equal(saved.totals.points, saved.entry.p);
  // edit again: one row, not two
  answers['nutrition:snack'] = 1;
  assert.equal(post({ action: 'save', token: r.token, date: '2027-01-13', answers }).entry.d, items.length);
  const log = gas.rows('Check-ins');
  assert.equal(log.length, 1);
  assert.match(log[0]['Answers'], /Meals 4\/4/);
  assert.equal(log[0]['Day'], 3);
  // window: two days back is fine, three is not, tomorrow is not
  assert.equal(post({ action: 'save', token: r.token, date: '2027-01-11', answers: { video: 1 } }).ok, true);
  gas.setNow('2027-01-14T08:00:00-07:00');
  assert.equal(post({ action: 'save', token: r.token, date: '2027-01-11', answers: { video: 1 } }).code, 'locked_day');
  assert.equal(post({ action: 'save', token: r.token, date: '2027-01-15', answers: { video: 1 } }).code, 'locked_day');
  me = post({ action: 'me', token: r.token }).me;
  assert.equal(Object.keys(me.history).length, 2);
  assert.equal(me.totals.days, 2);
  const people = gas.rows('Participants');
  assert.equal(people[0]['Days Logged'], 2);
});

test('the client date is trusted within a day, not further', () => {
  const { gas, post } = world();
  const r = register(post);
  gas.setNow('2027-01-13T23:30:00-07:00');
  assert.equal(post({ action: 'me', token: r.token, today: '2027-01-14' }).me.program.today, '2027-01-14');
  assert.equal(post({ action: 'me', token: r.token, today: '2027-01-20' }).me.program.today, '2027-01-13');
});

test('changing the setup mid-challenge updates today, keeps earlier days', () => {
  const { gas, post } = world();
  const r = register(post);
  gas.setNow('2027-01-12T19:00:00-07:00');
  post({ action: 'save', token: r.token, date: '2027-01-11', answers: { video: 1, workout: 1, sleep: 1 } });
  post({ action: 'save', token: r.token, date: '2027-01-12', answers: { video: 1, workout: 1, mobility: 1 } });
  const next = Object.assign({}, SETUP, { track: Object.assign({}, SETUP.track, { mobility: false, skill: false }) });
  const up = post({ action: 'setup', token: r.token, setup: next, shirt: 'tee', size: 'L' });
  assert.equal(up.ok, true, up.error);
  const me = up.me;
  assert.equal(me.person.shirt, 'tee');
  assert.equal(me.person.size, 'L');
  assert.ok(!me.checklists['2027-01-12'].some((i) => i.id === 'mobility'), 'today follows the new setup');
  assert.equal(me.history['2027-01-12'].a.mobility, undefined);
  assert.equal(me.history['2027-01-12'].a.workout, 1, 'answers that still apply are kept');
  assert.ok(me.checklists['2027-01-11'].some((i) => i.id === 'mobility'), 'yesterday keeps its own list');
});

test('removed participants are signed out', () => {
  const { gas, post } = world();
  const r = register(post);
  const sheet = gas.sheet('Participants');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.getRange(2, headers.indexOf('Status') + 1).setValue('Removed');
  assert.equal(post({ action: 'me', token: r.token }).code, 'inactive');
  assert.equal(post({ action: 'login', email: 'casey.lane@example.com', password: 'secret1' }).code, 'inactive');
});

test('test accounts can preview a challenge day', () => {
  const { gas, post } = world();
  register(post, { email: 'kevin+test@example.com' });
  assert.equal(post({ action: 'adminSetType', key: ADMIN, email: 'kevin+test@example.com', participantType: 'Test' }).ok, true);
  const settings = gas.sheet('Settings');
  const values = settings.getDataRange().getValues();
  const row = values.findIndex((r) => r[0] === 'preview_today') + 1;
  settings.getRange(row, 2).setValue('2027-01-20');
  gas.state.cache.clear();
  const login = post({ action: 'login', email: 'kevin+test@example.com', password: 'secret1' });
  assert.equal(login.me.program.today, '2027-01-20');
  assert.equal(login.me.program.dayNumber, 10);
  assert.equal(login.me.program.preview, true);
  assert.equal(post({ action: 'save', token: login.token, date: '2027-01-20', answers: { video: 1 } }).ok, true);
});

test('admin actions need the key; summary counts people', () => {
  const { post } = world();
  register(post);
  register(post, { email: 'm@b.co', memberType: 'member', payment: '', shirt: 'tee', size: 'XL' });
  assert.equal(post({ action: 'adminSummary', key: 'nope-nope' }).code, 'forbidden');
  const s = post({ action: 'adminSummary', key: ADMIN });
  assert.equal(s.total, 2);
  assert.equal(s.byType.Remote, 1);
  assert.equal(s.shirts['T-Shirt XL'], 1);
  assert.equal(s.remoteUnpaid.length, 1);
});

test('setup twice keeps Kevin\'s settings and days', () => {
  const { gas, post } = world();
  const settings = gas.sheet('Settings');
  const values = settings.getDataRange().getValues();
  const row = values.findIndex((r) => r[0] === 'remote_price') + 1;
  settings.getRange(row, 2).setValue(109);
  const again = post({ action: 'adminSetup', key: ADMIN, days: [{ day: 1, title: 'should not overwrite' }] });
  assert.equal(again.ok, true);
  assert.equal(again.seededDays, 0);
  gas.state.cache.clear();
  assert.equal(post({ action: 'config' }).config.remotePrice, 109);
});

test('unknown actions and health check', () => {
  const { gas, post } = world();
  assert.equal(post({ action: 'dropTables' }).code, 'unknown');
  assert.equal(gas.get({ action: 'res27Health' }).ok, true);
});

test("purging test accounts removes their rows and nobody else's", () => {
  const { gas, post } = world();
  const keep = register(post, { email: 'keep@b.co' });
  const gone = register(post, { email: 'gone@b.co' });
  gas.setNow('2027-01-12T19:00:00-07:00');
  post({ action: 'save', token: keep.token, date: '2027-01-12', answers: { video: 1 } });
  post({ action: 'save', token: gone.token, date: '2027-01-12', answers: { video: 1 } });
  post({ action: 'adminSetType', key: ADMIN, email: 'gone@b.co', participantType: 'Test' });
  const r = post({ action: 'adminPurgeTests', key: ADMIN });
  assert.deepEqual(r.removed, { participants: 1, accounts: 1, checkins: 1 });
  assert.deepEqual(gas.rows('Participants').map((p) => p.Email), ['keep@b.co']);
  assert.equal(gas.rows('Accounts').length, 1);
  assert.equal(gas.rows('Check-ins').length, 1);
  assert.equal(post({ action: 'me', token: keep.token }).ok, true);
  assert.equal(post({ action: 'me', token: gone.token }).code, 'auth');
});
