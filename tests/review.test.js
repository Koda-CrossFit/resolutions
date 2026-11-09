'use strict';

/**
 * Tests for the fixes from the 11/9 code review (backend). `node --test tests/`
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
  track: { nutrition: true, workout: true, sleep: true, finishers: false, hydration: false, skill: false, mobility: false, other: false },
  plan: 'recommended',
  sleepHours: 8,
  coaches: ['Kevin'],
};

function register(post, extra) {
  return post(Object.assign({
    action: 'register', memberType: 'remote', payment: 'venmo', first: 'Casey', last: 'Lane',
    email: 'casey.lane@example.com', password: 'secret1', shirt: 'tank', size: 'S', setup: SETUP,
  }, extra || {}));
}

function setSetting(gas, key, value) {
  const settings = gas.sheet('Settings');
  const values = settings.getDataRange().getValues();
  const row = values.findIndex((r) => r[0] === key) + 1;
  if (!row) throw new Error('no setting ' + key);
  settings.getRange(row, 2).setValue(value);
  gas.state.cache.clear();
}

test("sorting Participants (any way) never mixes up people's setup or history", () => {
  const { gas, post } = world();
  const zed = register(post, { email: 'zed@b.co', first: 'Zed', last: 'Zulu', setup: Object.assign({}, SETUP, { goal: 'performance' }) });
  const amy = register(post, { email: 'amy@b.co', first: 'Amy', last: 'Alpha', setup: Object.assign({}, SETUP, { goal: 'fatloss' }) });
  gas.setNow('2027-01-19T19:00:00-07:00');
  post({ action: 'save', token: zed.token, date: '2027-01-19', answers: { video: 1 } });
  post({ action: 'save', token: amy.token, date: '2027-01-19', answers: { video: 1, workout: 1 } });
  const sheet = gas.sheet('Participants');
  const width = sheet.getLastColumn();
  const rows = sheet.getRange(2, 1, 2, width).getValues();
  sheet.getRange(2, 1, 2, width).setValues([rows[1], rows[0]]);
  const z = post({ action: 'me', token: zed.token }).me;
  const a = post({ action: 'me', token: amy.token }).me;
  assert.equal(z.person.setup.goal, 'performance');
  assert.equal(a.person.setup.goal, 'fatloss');
  assert.equal(z.history['2027-01-19'].p, 3);
  assert.equal(a.history['2027-01-19'].p, 5);
  assert.equal(post({ action: 'save', token: zed.token, date: '2027-01-19', answers: { video: 1, sleep: 1 } }).entry.p, 4);
  const people = gas.rows('Participants');
  assert.equal(people.find((p) => p.Email === 'zed@b.co').Points, 4);
  assert.equal(people.find((p) => p.Email === 'amy@b.co').Points, 5);
});

test('if App Data gets scrambled, the app refuses instead of overwriting someone', () => {
  const { gas, post } = world();
  const zed = register(post, { email: 'zed@b.co' });
  register(post, { email: 'amy@b.co' });
  const app = gas.sheet('App Data');
  const setupCol = app.getRange(1, 1, 1, app.getLastColumn()).getValues()[0].indexOf('Setup') + 1;
  const a = app.getRange(2, setupCol).getValue();
  const b = app.getRange(3, setupCol).getValue();
  app.getRange(2, setupCol).setValue(b);
  app.getRange(3, setupCol).setValue(a);
  const r = post({ action: 'me', token: zed.token });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'server');
  assert.ok(gas.rows('Log').some((l) => /App Data does not match/.test(l.Detail)), 'logged for Kevin');
  assert.equal(app.getRange(2, setupCol).getValue(), b, 'nothing was overwritten');
});

test('made-up dates are refused and never count', () => {
  const { gas, post } = world();
  const r = register(post);
  gas.setNow('2027-02-08T19:00:00-07:00');
  for (const date of ['2027-01-32', '2027-01-99', '2027-02-00', '2027-13-01']) {
    const s = post({ action: 'save', token: r.token, date, answers: { video: 1 } });
    assert.equal(s.ok, false, date);
  }
  const fake = post({ action: 'me', token: r.token, today: '2027-01-32' }).me;
  assert.equal(fake.program.today, '2027-02-08');
  assert.equal(fake.totals.points, 0);
});

test('reset codes: a 6-hour wrong-guess budget across new codes, and HMAC-hashed codes', () => {
  const { gas, post } = world();
  register(post);
  const email = 'casey.lane@example.com';
  let bad = 0;
  for (let round = 0; round < 4; round++) {
    gas.setNow(new Date(Date.parse('2026-11-09T10:00:00-07:00') + round * 61000).toISOString());
    const s = post({ action: 'resetStart', email });
    if (!s.ok) {
      assert.equal(s.code, 'too_many');
      break;
    }
    for (let i = 0; i < 6; i++) {
      const f = post({ action: 'resetFinish', email, code: '999999', password: 'newpass1' });
      if (f.code === 'bad_code') bad++;
      if (f.code === 'too_many') break;
    }
  }
  assert.equal(bad, 12, 'exactly 12 wrong guesses allowed');
  assert.equal(post({ action: 'resetFinish', email, code: '999999', password: 'newpass1' }).code, 'too_many');
  const acct = gas.rows('Accounts')[0];
  assert.ok(String(acct['Reset Code']).length > 20 && !/^[0-9a-f]{64}$/.test(acct['Reset Code']), 'stored as an HMAC, not plain SHA-256');
});

test('a failed reset email keeps the old code and says so', () => {
  const { gas, post } = world();
  register(post);
  gas.context.MailApp.getRemainingDailyQuota = () => 1;
  const s = post({ action: 'resetStart', email: 'casey.lane@example.com' });
  assert.equal(s.code, 'mail');
  assert.equal(gas.rows('Accounts')[0]['Reset Code'], '');
  assert.ok(gas.rows('Log').some((l) => l.What === 'Email not sent'));
});

test("welcome email: reserve for Koda's other pages, logged and shown when not sent", () => {
  const { gas, post } = world();
  gas.context.MailApp.getRemainingDailyQuota = () => 20;
  const r = register(post);
  assert.equal(r.emailed, false);
  assert.equal(gas.state.mail.length, 0);
  assert.equal(gas.rows('Participants')[0]['Welcome Email'], 'NOT SENT (see Log)');
  assert.ok(gas.rows('Log').some((l) => l.What === 'Email not sent'));
  gas.context.MailApp.getRemainingDailyQuota = () => 90;
  const r2 = register(post, { email: 'two@b.co' });
  assert.equal(r2.emailed, true);
  assert.match(gas.state.mail[0].htmlBody, /venmo\.com\/\?txn=pay/);
  assert.match(gas.state.mail[0].htmlBody, /amount=99/);
  assert.equal(gas.rows('Participants')[1]['Welcome Email'], 'Sent');
  assert.match(r2.me.payUrl, /recipients=kevin-schuetz-5/);
});

test('a bonus Kevin adds after someone checked in still reaches them', () => {
  const { gas, post } = world();
  const r = register(post);
  gas.setNow('2027-01-22T07:00:00-07:00');
  post({ action: 'save', token: r.token, date: '2027-01-22', answers: { video: 1 } });
  const days = gas.sheet('Days');
  const headers = days.getRange(1, 1, 1, days.getLastColumn()).getValues()[0];
  days.getRange(6, headers.indexOf('Bonus Task') + 1).setValue('Post a photo of your meal prep');
  days.getRange(6, headers.indexOf('Bonus Points') + 1).setValue(4);
  gas.state.cache.clear();
  gas.setNow('2027-01-22T12:00:00-07:00');
  const me = post({ action: 'me', token: r.token }).me;
  assert.ok(me.checklists['2027-01-22'].some((i) => i.id === 'bonus'));
  const s = post({ action: 'save', token: r.token, date: '2027-01-22', answers: { bonus: 1 }, patch: true });
  assert.equal(s.entry.a.bonus, 1);
  assert.equal(s.entry.a.video, 1, 'patch keeps the earlier answer');
  assert.equal(s.entry.p, 7);
});

test("two phones saving the same day keep each other's answers (patch saves)", () => {
  const { gas, post } = world();
  const r = register(post);
  gas.setNow('2027-01-20T19:00:00-07:00');
  post({ action: 'save', token: r.token, date: '2027-01-20', answers: { video: 1, 'nutrition:m2': 1 }, patch: true });
  const s = post({ action: 'save', token: r.token, date: '2027-01-20', answers: { workout: 1 }, patch: true });
  assert.deepEqual(Object.keys(s.entry.a).sort(), ['nutrition:m2', 'video', 'workout']);
  const cleared = post({ action: 'save', token: r.token, date: '2027-01-20', answers: { video: null }, patch: true });
  assert.equal(cleared.entry.a.video, undefined);
  assert.equal(cleared.entry.a.workout, 1);
});

test('a sign-up that died between its writes can be finished by signing up again', () => {
  const { gas, post } = world();
  const first = register(post);
  assert.equal(first.ok, true);
  const id = gas.rows('Accounts')[0].ID;
  gas.sheet('Participants').deleteRow(2);
  gas.sheet('App Data').deleteRow(2);
  const again = register(post, { password: 'another1' });
  assert.equal(again.ok, true, again.error);
  assert.equal(gas.rows('Accounts').length, 1);
  assert.equal(gas.rows('Participants')[0].ID, id);
  assert.equal(post({ action: 'me', token: first.token }).code, 'auth', 'the old token ended');
  assert.equal(post({ action: 'login', email: 'casey.lane@example.com', password: 'another1' }).ok, true);
});

test('a blank current password is a clear message, not a server error', () => {
  const { post } = world();
  const r = register(post);
  assert.equal(post({ action: 'password', token: r.token, current: '', password: 'newpass9' }).code, 'bad_password');
});

test('shirt sizes lock after shirt_changes_until, and changes are logged', () => {
  const { gas, post } = world();
  const r = register(post);
  const ok = post({ action: 'setup', token: r.token, setup: SETUP, shirt: 'tee', size: 'L' });
  assert.equal(ok.ok, true, ok.error);
  assert.ok(gas.rows('Log').some((l) => l.What === 'Changed shirt' && /Ladies Tank S → T-Shirt L/.test(l.Detail)));
  setSetting(gas, 'shirt_changes_until', '2026-11-01');
  assert.equal(post({ action: 'setup', token: r.token, setup: SETUP, shirt: 'tee', size: 'XL' }).code, 'locked_shirt');
  assert.equal(post({ action: 'setup', token: r.token, setup: SETUP, shirt: 'tee', size: 'L' }).ok, true, 'same size is fine');
  assert.equal(post({ action: 'config' }).config.shirtChangesUntil, '2026-11-01');
});

test('setup moves v1.0 Participants app-data columns to App Data and drops venmo_url', () => {
  const { gas, post } = world();
  const sheet = gas.sheet('Participants');
  const col = sheet.getLastColumn() + 1;
  sheet.getRange(1, col, 1, 2).setValues([['Setup (app data)', 'History (app data)']]);
  gas.sheet('Settings').appendRow(['venmo_url', 'https://venmo.com/u/x', 'old']);
  const out = post({ action: 'adminSetup', key: ADMIN });
  assert.equal(out.ok, true, out.error);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  assert.ok(!headers.includes('Setup (app data)') && !headers.includes('History (app data)'));
  assert.ok(!gas.rows('Settings').some((r) => r.Setting === 'venmo_url'));
});
