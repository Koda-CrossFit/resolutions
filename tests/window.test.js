'use strict';

/**
 * The weekly window (Kevin, 11/11/2026): a week stays open until midnight on the Monday after it,
 * Mountain time (or the phone's own midnight if that comes first); and a finished week keeps the
 * finisher goal it really had when it's caught up on that Monday.   node --test "tests/*.test.js"
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
  gas.setNow(at);
  const post = (body) => gas.post(Object.assign({ type: 'res27' }, body));
  assert.equal(post({ action: 'adminSetup', key: ADMIN, days: DAYS, settings: { welcome_email: false } }).ok, true);
  return { gas, post };
}

function join(post, setup) {
  const r = post({
    action: 'register', memberType: 'member', first: 'Win', last: 'Dow', email: 'win@example.com', password: 'secret1', shirt: 'tee', size: 'M',
    setup: Object.assign({ goal: 'health', track: { workout: true }, plan: 'recommended', sleepHours: 7, coaches: [] }, setup || {}),
  });
  assert.equal(r.ok, true, r.error);
  return r;
}

test('last week locks at midnight Mountain time, even for a phone that is still on Monday', () => {
  const { gas, post } = world('2027-01-25T20:00:00-07:00');
  const r = join(post);
  // Denver: Tuesday 00:30. A phone in Los Angeles still says Monday the 25th.
  gas.setNow('2027-01-26T00:30:00-07:00');
  const west = (date) => post({ action: 'save', token: r.token, date, answers: { video: 1 }, patch: true, today: '2027-01-25' });
  assert.equal(west('2027-01-24').code, 'locked_day', 'Sunday of week 1: pulled at Denver midnight');
  assert.equal(west('2027-01-25').ok, true, 'the phone’s own today (week 2) is fine');
  // Denver: Monday 23:00. A phone in New York already says Tuesday: its own midnight came first.
  gas.setNow('2027-01-25T23:00:00-07:00');
  const east = post({ action: 'save', token: r.token, date: '2027-01-24', answers: { video: 1 }, patch: true, today: '2027-01-26' });
  assert.equal(east.code, 'locked_day');
  // And a Denver phone at 23:00 Monday can still change last week.
  assert.equal(post({ action: 'save', token: r.token, date: '2027-01-24', answers: { video: 1 }, patch: true, today: '2027-01-25' }).ok, true);
});

test('catching up a finished week on Monday keeps the finisher goal it had, even after a setup change', () => {
  const { gas, post } = world('2027-01-18T20:00:00-07:00');
  const r = join(post, { track: { workout: true, finishers: true }, finishersPerWeek: 2 });
  const save = (date, answers) => {
    const out = post({ action: 'save', token: r.token, date, answers, patch: true });
    assert.equal(out.ok, true, out.error);
    return out.entry;
  };
  save('2027-01-18', { video: 1, workout: 1, finisher: 1 });
  gas.setNow('2027-01-19T20:00:00-07:00');
  save('2027-01-19', { video: 1, workout: 1, finisher: 1 }); // goal 2 met during week 1
  // Monday of week 2: raise the goal to 3 for the new week, then catch up Wed–Sun of week 1.
  gas.setNow('2027-01-25T19:00:00-07:00');
  const up = post({ action: 'setup', token: r.token, setup: { goal: 'health', track: { workout: true, finishers: true }, plan: 'recommended', sleepHours: 7, finishersPerWeek: 3, coaches: [] } });
  assert.equal(up.ok, true, up.error);
  const goalOf = (units) => (units.find((u) => u[0] === 'finisher') || [])[3];
  let sunday = null;
  for (const date of ['2027-01-20', '2027-01-21', '2027-01-22', '2027-01-23', '2027-01-24']) {
    const e = save(date, { video: 1, workout: 1 });
    assert.equal(goalOf(e.u), 2, date + ' keeps week 1’s goal of 2');
    sunday = e;
  }
  assert.deepEqual([sunday.f, sunday.s], [0, 10], 'week 1’s goal was met: no Sunday penalty');
  const me = post({ action: 'me', token: r.token }).me;
  assert.equal(goalOf(me.checklists['2027-01-25'].reduce((all, item) => all.concat(item.units), [])), 3, 'this week uses the new goal');
});
