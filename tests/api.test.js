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
  track: { nutrition: true, workout: true, sleep: true, protein: true, hydration: true, finishers: true, skill: true, mobility: true, recovery: true, other: true },
  plan: 'macros',
  macros: { protein: 180, carbs: 250, fat: 70, calories: 2400, wantHelp: true },
  sleepHours: 8,
  proteinG: 180,
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
  assert.equal(me.program.start, '2027-01-18');
  assert.equal(me.program.end, '2027-02-28');
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
  gas.setNow('2027-01-20T19:30:00-07:00'); // Day 3
  let me = post({ action: 'me', token: r.token }).me;
  assert.equal(me.program.phase, 'during');
  assert.equal(me.program.dayNumber, 3);
  assert.deepEqual(Object.keys(me.checklists).sort(), ['2027-01-18', '2027-01-19', '2027-01-20']);
  const list = me.checklists['2027-01-20'];
  const ids = list.map((i) => i.id);
  assert.deepEqual(ids.slice(0, 2), ['video', 'nutrition']);
  assert.ok(ids.includes('bonus'), 'Day 3 has the coach-goals bonus in the seed');
  const answers = {};
  list.forEach((item) => item.units.forEach((u) => (answers[u[0]] = 1)));
  answers['nutrition:snack'] = 0;
  answers['bogus'] = 1;
  const saved = post({ action: 'save', token: r.token, date: '2027-01-20', answers });
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.entry.a.bogus, undefined);
  const items = list.filter((i) => !i.units.every((u) => u[2]));
  assert.equal(saved.entry.n, items.length, 'the finisher and the bonus are not everyday items');
  assert.equal(saved.entry.d, items.length - 1, 'nutrition is not complete with a missed snack');
  // On the list: video 1 + meals 4 + workout 2 + sleep 2 + protein, water, skill, mobility, recovery 1 each
  // + 2 other = 16, plus today's finisher (done) = 17. Everything but the snack = 16 → 9.4 of 10; bonus +1.
  assert.equal(saved.entry.m, 17);
  assert.equal(saved.entry.e, 16);
  assert.equal(saved.entry.s, 9.4);
  assert.equal(saved.entry.b, 1);
  assert.equal(saved.entry.p, 10.4);
  assert.equal(saved.totals.points, 10.4);
  // edit again: one row, not two
  answers['nutrition:snack'] = 1;
  const full = post({ action: 'save', token: r.token, date: '2027-01-20', answers }).entry;
  assert.equal(full.d, items.length);
  assert.equal(full.s, 10);
  assert.equal(full.p, 11, 'a perfect day plus the bonus');
  const log = gas.rows('Check-ins');
  assert.equal(log.length, 1);
  assert.match(log[0]['Answers'], /Meals 4\/4/);
  assert.equal(log[0]['Day'], 3);
  assert.equal(log[0]['Score'], 10);
  assert.equal(log[0]['Bonus'], 1);
  assert.equal(log[0]['Points'], 11);
  // Window (Kevin, 11/11/2026): the whole week stays open until midnight the Monday after it; never a day ahead.
  assert.equal(post({ action: 'save', token: r.token, date: '2027-01-18', answers: { video: 1 } }).ok, true);
  gas.setNow('2027-01-25T23:30:00-07:00'); // Monday of week 2: week 1 is still open
  assert.equal(post({ action: 'save', token: r.token, date: '2027-01-18', answers: { video: 1 } }).ok, true);
  assert.equal(post({ action: 'save', token: r.token, date: '2027-01-27', answers: { video: 1 } }).code, 'locked_day', 'not a day ahead');
  gas.setNow('2027-01-26T00:05:00-07:00'); // Tuesday just after midnight: week 1 is locked
  const locked = post({ action: 'save', token: r.token, date: '2027-01-18', answers: { video: 1 } });
  assert.equal(locked.code, 'locked_day');
  assert.match(locked.error, /stays open until midnight on the Monday after it/);
  assert.equal(post({ action: 'save', token: r.token, date: '2027-01-24', answers: { video: 1 } }).code, 'locked_day', 'its Sunday too');
  assert.equal(post({ action: 'save', token: r.token, date: '2027-01-25', answers: { video: 1 } }).ok, true, 'this week is open');
  me = post({ action: 'me', token: r.token }).me;
  assert.equal(Object.keys(me.history).length, 3);
  assert.equal(me.totals.days, 3);
  const people = gas.rows('Participants');
  assert.equal(people[0]['Days Logged'], 3);
});

test('every day is out of 10 however many habits someone tracks', () => {
  const { gas, post } = world();
  const few = register(post, { email: 'few@b.co', setup: { goal: 'health', track: { workout: true }, coaches: [] } });
  const all = register(post, { email: 'all@b.co' });
  gas.setNow('2027-01-19T19:00:00-07:00'); // Day 2
  const yesToAll = (token) => {
    const list = post({ action: 'me', token }).me.checklists['2027-01-19'];
    const a = {};
    list.forEach((item) => item.units.forEach((u) => (a[u[0]] = u[2] === 2 ? 0 : 1))); // skip the bonus
    return post({ action: 'save', token, date: '2027-01-19', answers: a }).entry;
  };
  assert.equal(yesToAll(few.token).s, 10, 'video + workout, both done');
  assert.equal(yesToAll(all.token).s, 10, 'every habit done');
  // The score is the share of the day's weight done: 1 of 3 here, 8 of 16 below.
  assert.equal(post({ action: 'save', token: few.token, date: '2027-01-19', answers: { video: 1, workout: 0 } }).entry.s, 3.3);
  const half = post({ action: 'save', token: all.token, date: '2027-01-19', answers: { 'nutrition:m1': 1, 'nutrition:m2': 1, 'nutrition:m3': 1, 'nutrition:snack': 1, workout: 1, sleep: 1, video: 0, protein: 0 } }).entry;
  assert.equal(half.e, 8);
  assert.equal(half.m, 16, 'a finisher not done this day is not on the list');
  assert.equal(half.s, 5);
});

test('finishers: missed ones count against the last day of the week, and catch up when fixed', () => {
  const { gas, post } = world();
  const r = register(post, { email: 'fin@b.co', setup: { goal: 'performance', track: { workout: true, finishers: true }, finishersPerWeek: 2, coaches: [] } });
  assert.equal(r.ok, true, r.error);
  gas.setNow('2027-01-18T19:00:00-07:00'); // Mon, Day 1
  assert.equal(post({ action: 'save', token: r.token, date: '2027-01-18', answers: { video: 1, workout: 1, finisher: 1 } }).entry.s, 10);
  gas.setNow('2027-01-21T19:00:00-07:00'); // Thu: no finisher, no penalty mid-week
  assert.equal(post({ action: 'save', token: r.token, date: '2027-01-21', answers: { video: 1, workout: 1, finisher: 0 } }).entry.s, 10);
  gas.setNow('2027-01-24T19:00:00-07:00'); // Sun, Day 7: 1 of 2 finishers
  const sun = post({ action: 'save', token: r.token, date: '2027-01-24', answers: { video: 1, workout: 1 } }).entry;
  assert.equal(sun.f, 1, 'one missed finisher');
  assert.equal(sun.m, 4);
  assert.equal(sun.s, 7.5);
  // Saturday's finisher was logged late (still inside the edit window): Sunday catches up.
  const sat = post({ action: 'save', token: r.token, date: '2027-01-23', answers: { video: 1, workout: 1, finisher: 1 } });
  assert.equal(sat.ok, true, sat.error);
  const me = post({ action: 'me', token: r.token }).me;
  assert.equal(me.history['2027-01-24'].f, 0);
  assert.equal(me.history['2027-01-24'].s, 10);
  const sunRow = gas.rows('Check-ins').find((x) => x.Date === '2027-01-24');
  assert.equal(sunRow.Score, 10, 'the Check-ins row follows');
  assert.equal(me.totals.points, 40);
  assert.equal(gas.rows('Participants')[0].Points, 40);
  // Mid-week days never carry the penalty.
  assert.equal(me.history['2027-01-21'].f, 0);
});

test('setup rules: protein goal required, finishers 1-3 a week, sleep from 7 hours', () => {
  const { post } = world();
  const bad = register(post, { email: 'p1@b.co', setup: Object.assign({}, SETUP, { proteinG: '' }) });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /protein/i);
  const ok = register(post, { email: 'p2@b.co', setup: Object.assign({}, SETUP, { proteinG: 150, finishersPerWeek: 5, sleepHours: 6 }) });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.me.person.setup.proteinG, 150);
  assert.equal(ok.me.person.setup.finishersPerWeek, 2, '5 a week is not a choice');
  assert.equal(ok.me.person.setup.sleepHours, 7, 'under 7 hours is not a choice');
  const cfg = post({ action: 'config' }).config;
  assert.deepEqual(cfg.sleepChoices, [7, 7.5, 8, 8.5, 9]);
  assert.deepEqual(cfg.finisherChoices, [1, 2, 3]);
  const ids = ok.me.preview.map((i) => i.id);
  assert.ok(ids.includes('protein') && ids.includes('recovery'));
  assert.match(ok.me.preview.find((i) => i.id === 'protein').label, /150 g/);
});

test('an empty Check-ins tab drops Max Points for the new columns; other tabs keep columns Kevin adds', () => {
  const { gas, post } = world();
  const sheet = gas.sheet('Check-ins');
  const old = ['Key', 'ID', 'Name', 'Team', 'Date', 'Day', 'Done', 'Of', 'Points', 'Max Points', 'Answers', 'Updated', 'Coach Notes'];
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).clearContent();
  sheet.getRange(1, 1, 1, old.length).setValues([old]);
  const people = gas.sheet('Participants');
  people.getRange(1, people.getLastColumn() + 1).setValue('Phone'); // no participants yet
  assert.equal(post({ action: 'adminSetup', key: ADMIN }).ok, true);
  const now = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].filter(Boolean);
  assert.deepEqual(now, ['Key', 'ID', 'Name', 'Team', 'Date', 'Day', 'Done', 'Of', 'Score', 'Bonus', 'Points', 'Answers', 'Updated', 'Coach Notes']);
  const head = people.getRange(1, 1, 1, people.getLastColumn()).getValues()[0].filter(Boolean);
  assert.ok(head.includes('Phone'), 'an added column on an empty tab survives setup');
  register(post);
  assert.equal(post({ action: 'adminSetup', key: ADMIN }).ok, true);
  assert.deepEqual(people.getRange(1, 1, 1, people.getLastColumn()).getValues()[0].filter(Boolean), head, 'a tab with rows keeps its columns');
});

test('saves keep working on a Check-ins tab that setup has not updated yet', () => {
  const { gas, post } = world();
  const r = register(post);
  const sheet = gas.sheet('Check-ins');
  const old = ['Key', 'ID', 'Name', 'Team', 'Date', 'Day', 'Done', 'Of', 'Points', 'Max Points', 'Answers', 'Updated'];
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).clearContent();
  sheet.getRange(1, 1, 1, old.length).setValues([old]);
  gas.setNow('2027-01-19T19:00:00-07:00');
  assert.equal(post({ action: 'save', token: r.token, date: '2027-01-19', answers: { video: 1 } }).ok, true);
  const again = post({ action: 'save', token: r.token, date: '2027-01-19', answers: { video: 1, workout: 1 } });
  assert.equal(again.ok, true, again.error);
  const rows = gas.rows('Check-ins');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Points, again.entry.p);
  // With a row on it, setup only adds the new columns.
  assert.equal(post({ action: 'adminSetup', key: ADMIN }).ok, true);
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].filter(Boolean);
  assert.ok(head.includes('Score') && head.includes('Bonus'));
});

test('a week keeps its own finisher goal: later setup changes and Sunday switches cannot move the penalty', () => {
  const { gas, post } = world();
  const base = { goal: 'performance', track: { workout: true }, coaches: [] };
  const withFin = (goal) => ({ goal: 'performance', track: { workout: true, finishers: true }, finishersPerWeek: goal, coaches: [] });
  const a = register(post, { email: 'a@b.co', setup: base });
  const b = register(post, { email: 'b2@b.co', setup: withFin(1) });
  const c = register(post, { email: 'c@b.co', setup: withFin(2) });
  const d = register(post, { email: 'd@b.co', setup: withFin(3) });
  gas.setNow('2027-01-20T19:00:00-07:00'); // Wed: b meets a goal of 1
  post({ action: 'save', token: b.token, date: '2027-01-20', answers: { video: 1, workout: 1, finisher: 1 } });
  gas.setNow('2027-01-23T19:00:00-07:00'); // Sat
  post({ action: 'save', token: a.token, date: '2027-01-23', answers: { video: 1, workout: 1 } });
  post({ action: 'save', token: c.token, date: '2027-01-23', answers: { video: 1, workout: 1, finisher: 0 } });
  gas.setNow('2027-01-24T18:00:00-07:00'); // Sun: d logs, then switches finishers off the same day
  assert.equal(post({ action: 'save', token: d.token, date: '2027-01-24', answers: { video: 1, workout: 1 } }).entry.s, 5);
  const off = post({ action: 'setup', token: d.token, setup: base });
  assert.equal(off.ok, true, off.error);
  assert.equal(off.me.history['2027-01-24'].s, 5, "switching off on Sunday doesn't erase that week's missed finishers");
  gas.setNow('2027-01-25T08:00:00-07:00'); // Mon of week 2: setup changes, then last Sunday is filled in
  assert.equal(post({ action: 'setup', token: a.token, setup: withFin(2) }).ok, true);
  assert.equal(post({ action: 'setup', token: b.token, setup: withFin(3) }).ok, true);
  assert.equal(post({ action: 'setup', token: c.token, setup: base }).ok, true);
  const meA = post({ action: 'me', token: a.token }).me;
  assert.ok(!meA.checklists['2027-01-24'].some((i) => i.id === 'finisher'), 'finishers turned on Monday stay out of last Sunday');
  assert.ok(meA.checklists['2027-01-25'].some((i) => i.id === 'finisher'), 'and are on from Monday');
  const sunA = post({ action: 'save', token: a.token, date: '2027-01-24', answers: { video: 1, workout: 1 } }).entry;
  assert.deepEqual([sunA.s, sunA.f], [10, 0]);
  const sunB = post({ action: 'save', token: b.token, date: '2027-01-24', answers: { video: 1, workout: 1 } }).entry;
  assert.deepEqual([sunB.s, sunB.f], [10, 0], "a goal raised on Monday doesn't apply to last week");
  const meC = post({ action: 'me', token: c.token }).me;
  assert.ok(meC.checklists['2027-01-24'].some((i) => i.id === 'finisher'), 'last week still shows its finisher');
  const sunC = post({ action: 'save', token: c.token, date: '2027-01-24', answers: { video: 1, workout: 1 } }).entry;
  assert.deepEqual([sunC.s, sunC.f], [6, 2], "turning finishers off on Monday doesn't erase last week's missed ones");
  const meD = post({ action: 'me', token: d.token }).me;
  assert.ok(!meD.checklists['2027-01-25'].some((i) => i.id === 'finisher'));
});

test('setup turns the old 4-point bonus tasks into 1 point, once', () => {
  const { gas, post } = world();
  const days = gas.sheet('Days');
  const head = days.getRange(1, 1, 1, days.getLastColumn()).getValues()[0];
  const taskCol = head.indexOf('Bonus Task') + 1;
  const ptsCol = head.indexOf('Bonus Points') + 1;
  const n = days.getLastRow() - 1;
  const tasks = days.getRange(2, taskCol, n, 1).getValues().map((t) => String(t[0]).trim());
  days.getRange(2, ptsCol, n, 1).setValues(tasks.map((t) => [t ? 4 : '']));
  gas.state.properties.delete('RES27_BONUS_IS_1'); // as on the live sheet, seeded on 11/9
  const out = post({ action: 'adminSetup', key: ADMIN });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.bonusFixed, tasks.filter(Boolean).length);
  assert.ok(days.getRange(2, ptsCol, n, 1).getValues().every((v, i) => (tasks[i] ? v[0] === 1 : v[0] === '')));
  days.getRange(2, ptsCol).setValue(4); // later, Kevin makes Day 1's bonus worth 4 on purpose
  assert.equal(post({ action: 'adminSetup', key: ADMIN }).bonusFixed, 0);
  assert.equal(days.getRange(2, ptsCol).getValue(), 4);
});

test('re-seeding Days keeps pasted video links with their video, even when days move', () => {
  const { gas, post } = world();
  const days = gas.sheet('Days');
  const head = days.getRange(1, 1, 1, days.getLastColumn()).getValues()[0];
  const videoCol = head.indexOf('Video URL') + 1;
  const titleCol = head.indexOf('Title') + 1;
  days.getRange(4, videoCol).setValue('https://youtu.be/abcdefghijk'); // Day 3
  const title3 = days.getRange(4, titleCol).getValue();
  const moved = DAYS.map((x) => Object.assign({}, x));
  [moved[2].title, moved[4].title] = [moved[4].title, moved[2].title]; // Day 3's video now runs on Day 5
  const out = post({ action: 'adminSeedDays', key: ADMIN, days: moved, overwrite: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.keptVideos, 1);
  assert.equal(days.getRange(6, titleCol).getValue(), title3);
  assert.equal(days.getRange(6, videoCol).getValue(), 'https://youtu.be/abcdefghijk');
  assert.equal(days.getRange(4, videoCol).getValue(), '');
});

test('the client date is trusted within a day, not further', () => {
  const { gas, post } = world();
  const r = register(post);
  gas.setNow('2027-01-20T23:30:00-07:00');
  assert.equal(post({ action: 'me', token: r.token, today: '2027-01-21' }).me.program.today, '2027-01-21');
  assert.equal(post({ action: 'me', token: r.token, today: '2027-01-27' }).me.program.today, '2027-01-20');
});

test('changing the setup mid-challenge updates today, keeps earlier days', () => {
  const { gas, post } = world();
  const r = register(post);
  gas.setNow('2027-01-19T19:00:00-07:00');
  post({ action: 'save', token: r.token, date: '2027-01-18', answers: { video: 1, workout: 1, sleep: 1 } });
  post({ action: 'save', token: r.token, date: '2027-01-19', answers: { video: 1, workout: 1, mobility: 1 } });
  const next = Object.assign({}, SETUP, { track: Object.assign({}, SETUP.track, { mobility: false, skill: false }) });
  const up = post({ action: 'setup', token: r.token, setup: next, shirt: 'tee', size: 'L' });
  assert.equal(up.ok, true, up.error);
  const me = up.me;
  assert.equal(me.person.shirt, 'tee');
  assert.equal(me.person.size, 'L');
  assert.ok(!me.checklists['2027-01-19'].some((i) => i.id === 'mobility'), 'today follows the new setup');
  assert.equal(me.history['2027-01-19'].a.mobility, undefined);
  assert.equal(me.history['2027-01-19'].a.workout, 1, 'answers that still apply are kept');
  assert.ok(me.checklists['2027-01-18'].some((i) => i.id === 'mobility'), 'yesterday keeps its own list');
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
  settings.getRange(row, 2).setValue('2027-01-27');
  gas.state.cache.clear();
  const login = post({ action: 'login', email: 'kevin+test@example.com', password: 'secret1' });
  assert.equal(login.me.program.today, '2027-01-27');
  assert.equal(login.me.program.dayNumber, 10);
  assert.equal(login.me.program.preview, true);
  assert.equal(post({ action: 'save', token: login.token, date: '2027-01-27', answers: { video: 1 } }).ok, true);
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
  gas.setNow('2027-01-19T19:00:00-07:00');
  post({ action: 'save', token: keep.token, date: '2027-01-19', answers: { video: 1 } });
  post({ action: 'save', token: gone.token, date: '2027-01-19', answers: { video: 1 } });
  post({ action: 'adminSetType', key: ADMIN, email: 'gone@b.co', participantType: 'Test' });
  const r = post({ action: 'adminPurgeTests', key: ADMIN });
  assert.deepEqual(r.removed, { participants: 1, accounts: 1, appdata: 1, checkins: 1, questions: 0 });
  assert.deepEqual(gas.rows('Participants').map((p) => p.Email), ['keep@b.co']);
  assert.equal(gas.rows('Accounts').length, 1);
  assert.equal(gas.rows('Check-ins').length, 1);
  assert.equal(post({ action: 'me', token: keep.token }).ok, true);
  assert.equal(post({ action: 'me', token: gone.token }).code, 'auth');
});
