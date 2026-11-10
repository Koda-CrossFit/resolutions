'use strict';

/**
 * Leaderboard (Kevin, 11/10/2026): team standings only — each team's average points per person,
 * for the whole challenge and this week. Nobody's own score goes to anyone else.
 *   node --test "tests/*.test.js"
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { createGas } = require('../dev/gas-mock.js');

const ADMIN = 'test-admin-key-123';
const DAYS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'days-2027.json'), 'utf8'));
const SETUP = { goal: 'health', track: { nutrition: true, workout: true, sleep: true }, plan: 'recommended', sleepHours: 7, coaches: [] };

function world(at, settings) {
  const gas = createGas();
  gas.setNow(at);
  const post = (body) => gas.post(Object.assign({ type: 'res27' }, body));
  const setup = post({ action: 'adminSetup', key: ADMIN, days: DAYS, settings });
  assert.equal(setup.ok, true, setup.error);
  return { gas, post };
}

function join(post, first, extra) {
  const r = post(Object.assign({
    action: 'register', memberType: 'member', first, last: 'Tester', email: first.toLowerCase() + '@example.com', password: 'secret1',
    shirt: 'tee', size: 'M', setup: SETUP,
  }, extra || {}));
  assert.equal(r.ok, true, r.error);
  return r;
}

/** Kevin's columns on Participants, by email. */
function setCell(gas, email, header, value) {
  const sheet = gas.sheet('Participants');
  const values = sheet.getDataRange().getValues();
  const head = values[0];
  const row = values.findIndex((r) => r[head.indexOf('Email')] === email);
  assert.ok(row > 0, 'no row for ' + email);
  sheet.getRange(row + 1, head.indexOf(header) + 1).setValue(value);
}

const ALL_YES = { video: 1, 'nutrition:m1': 1, 'nutrition:m2': 1, 'nutrition:m3': 1, 'nutrition:snack': 1, workout: 1, sleep: 1 };

test('team standings: average points per person, whole challenge and this week; small teams show no numbers; only teams leave the server', () => {
  // Real challenge, Wed Jan 27 2027 = Day 10 (week 2).
  const { gas, post } = world('2027-01-27T19:00:00-07:00');
  const ann = join(post, 'Ann');
  const bea = join(post, 'Bea');
  const cal = join(post, 'Cal');
  const dee = join(post, 'Dee'); // no team
  const gus = join(post, 'Gus'); // 'Team Iron' is Iron too
  const eve = join(post, 'Eve'); // removed from Steel
  setCell(gas, 'ann@example.com', 'Team', 'Iron');
  setCell(gas, 'bea@example.com', 'Team', ' iron ');
  setCell(gas, 'gus@example.com', 'Team', 'Team Iron');
  setCell(gas, 'cal@example.com', 'Team', 'Steel');
  setCell(gas, 'eve@example.com', 'Team', 'Steel');
  // Week 1 (Jan 18–24) and week 2 (Jan 25–31) points. The edit window is 2 days, so earlier days are
  // saved with the clock moved back.
  const save = (r, date, answers) => {
    gas.setNow(date + 'T20:00:00-07:00');
    const out = post({ action: 'save', token: r.token, date, answers });
    assert.equal(out.ok, true, out.error);
    return out.entry.p;
  };
  const annW1 = save(ann, '2027-01-20', ALL_YES); // 10 + bonus if any
  const annW2 = save(ann, '2027-01-26', { video: 1 });
  const beaW2 = save(bea, '2027-01-27', ALL_YES);
  const calW1 = save(cal, '2027-01-21', { workout: 1, sleep: 1 });
  save(dee, '2027-01-27', ALL_YES);
  save(eve, '2027-01-27', ALL_YES);
  setCell(gas, 'eve@example.com', 'Status', 'Removed'); // checked in, then removed by Kevin
  gas.setNow('2027-01-27T21:00:00-07:00');
  gas.state.cache.clear();

  const r = post({ action: 'leaderboard', token: ann.token });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.myTeam, 'iron');
  assert.deepEqual([r.board.week, r.board.weeks, r.board.weekFrom, r.board.weekTo], [2, 6, '2027-01-25', '2027-01-31']);
  const byKey = Object.fromEntries(r.board.teams.map((t) => [t.key, t]));
  assert.deepEqual(Object.keys(byKey).sort(), ['iron', 'steel'], 'Dee has no team');
  assert.equal(byKey.iron.name, 'Iron', 'first spelling wins; "iron" and "Team Iron" grouped with it');
  assert.equal(byKey.iron.people, 3);
  assert.equal(byKey.iron.overall, Math.round(((annW1 + annW2 + beaW2) / 3) * 10) / 10, 'Gus has no points yet and still counts');
  assert.equal(byKey.iron.week, Math.round(((annW2 + beaW2) / 3) * 10) / 10);
  assert.equal(byKey.steel.people, 1, 'a removed person doesn’t count');
  assert.deepEqual([byKey.steel.overall, byKey.steel.week], [null, null], 'a one-person team would show Cal’s own score');
  assert.ok(calW1 > 0);
  assert.equal(r.board.minPeople, 3);
  // Two people: still no numbers (a teammate could subtract their own score).
  setCell(gas, 'dee@example.com', 'Team', 'Steel');
  gas.state.cache.clear();
  const two = post({ action: 'leaderboard', token: ann.token }).board.teams.find((t) => t.key === 'steel');
  assert.deepEqual([two.people, two.overall, two.week], [2, null, null]);

  const text = JSON.stringify(r);
  for (const who of ['Ann', 'Bea', 'Cal', 'Dee', 'Eve', '@example.com', 'Tester']) assert.ok(!text.includes(who), 'no personal data: ' + who);
});

test('beta testers see the beta teams; members never see test accounts', () => {
  const { gas, post } = world('2026-11-10T09:00:00-07:00', { beta_start: '2026-11-09', beta_days: 7 });
  const kev = join(post, 'Kev', { beta: true });
  join(post, 'Ivy', { beta: true });
  join(post, 'Jo', { beta: true });
  const tess = join(post, 'Tess', { beta: true });
  const mem = join(post, 'Mem');
  for (const who of ['kev', 'ivy', 'jo']) setCell(gas, who + '@example.com', 'Team', 'Beta Blue');
  setCell(gas, 'tess@example.com', 'Team', 'Beta Gold');
  setCell(gas, 'mem@example.com', 'Team', 'Iron');
  const kevDay1 = post({ action: 'save', token: kev.token, date: '2026-11-09', answers: ALL_YES, patch: true }).entry.p;
  gas.state.cache.clear();

  const beta = post({ action: 'leaderboard', token: tess.token });
  const byKey = Object.fromEntries(beta.board.teams.map((t) => [t.key, t]));
  assert.deepEqual(Object.keys(byKey).sort(), ['beta blue', 'beta gold']);
  assert.deepEqual([beta.board.week, beta.board.weeks, beta.board.weekFrom, beta.board.weekTo], [1, 1, '2026-11-09', '2026-11-15']);
  assert.deepEqual([byKey['beta blue'].people, byKey['beta blue'].overall], [3, Math.round((kevDay1 / 3) * 10) / 10]);
  assert.deepEqual([byKey['beta gold'].people, byKey['beta gold'].overall], [1, null], 'a team of one shows no numbers');

  const real = post({ action: 'leaderboard', token: mem.token });
  assert.deepEqual(real.board.teams.map((t) => t.key), ['iron']);
  assert.equal(real.board.week, 0, 'before Day 1: no week yet');
});

test('the standings are cached a couple of minutes, then pick up team changes', () => {
  const { gas, post } = world('2027-01-27T19:00:00-07:00');
  const ann = join(post, 'Ann');
  setCell(gas, 'ann@example.com', 'Team', 'Iron');
  gas.state.cache.clear();
  assert.equal(post({ action: 'leaderboard', token: ann.token }).board.teams[0].name, 'Iron');
  setCell(gas, 'ann@example.com', 'Team', 'Steel');
  assert.equal(post({ action: 'leaderboard', token: ann.token }).board.teams[0].name, 'Iron', 'cached');
  gas.setNow('2027-01-27T19:03:00-07:00');
  const after = post({ action: 'leaderboard', token: ann.token });
  assert.equal(after.board.teams[0].name, 'Steel');
  assert.equal(after.myTeam, 'steel');
});

test('the leaderboard needs a sign-in', () => {
  const { post } = world('2027-01-27T19:00:00-07:00');
  assert.equal(post({ action: 'leaderboard', token: 'nope' }).code, 'auth');
});
