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
    action: 'register', gym: 'ironview', memberType: 'member', first, last: 'Tester', email: first.toLowerCase() + '@example.com', password: 'secret1',
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
  // Teams belong to a gym since 11/23/2026, so a team's key starts with its gym's id.
  assert.equal(r.myTeam, 'ironview:iron');
  assert.deepEqual([r.board.week, r.board.weeks, r.board.weekFrom, r.board.weekTo], [2, 6, '2027-01-25', '2027-01-31']);
  const byKey = Object.fromEntries(r.board.teams.map((t) => [t.key, t]));
  assert.deepEqual(Object.keys(byKey).sort(), ['ironview:iron', 'ironview:steel'], 'Dee has no team');
  assert.equal(byKey['ironview:iron'].name, 'Iron', 'first spelling wins; "iron" and "Team Iron" grouped with it');
  assert.equal(byKey['ironview:iron'].people, 3);
  assert.equal(byKey['ironview:iron'].overall, Math.round(((annW1 + annW2 + beaW2) / 3) * 10) / 10, 'Gus has no points yet and still counts');
  assert.equal(byKey['ironview:iron'].week, Math.round(((annW2 + beaW2) / 3) * 10) / 10);
  assert.equal(byKey['ironview:steel'].people, 1, 'a removed person doesn’t count');
  assert.deepEqual([byKey['ironview:steel'].overall, byKey['ironview:steel'].week], [null, null], 'a one-person team would show Cal’s own score');
  assert.ok(calW1 > 0);
  assert.equal(r.board.minPeople, 3);
  // Two people: still no numbers (a teammate could subtract their own score).
  setCell(gas, 'dee@example.com', 'Team', 'Steel');
  gas.state.cache.clear();
  const two = post({ action: 'leaderboard', token: ann.token }).board.teams.find((t) => t.key === 'ironview:steel');
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
  assert.deepEqual(Object.keys(byKey).sort(), ['ironview:beta blue', 'ironview:beta gold']);
  assert.deepEqual([beta.board.week, beta.board.weeks, beta.board.weekFrom, beta.board.weekTo], [1, 1, '2026-11-09', '2026-11-15']);
  assert.deepEqual([byKey['ironview:beta blue'].people, byKey['ironview:beta blue'].overall], [3, Math.round((kevDay1 / 3) * 10) / 10]);
  assert.deepEqual([byKey['ironview:beta gold'].people, byKey['ironview:beta gold'].overall], [1, null], 'a team of one shows no numbers');

  const real = post({ action: 'leaderboard', token: mem.token });
  assert.deepEqual(real.board.teams.map((t) => t.key), ['ironview:iron']);
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
  assert.equal(after.myTeam, 'ironview:steel');
});

test('the leaderboard needs a sign-in', () => {
  const { post } = world('2027-01-27T19:00:00-07:00');
  assert.equal(post({ action: 'leaderboard', token: 'nope' }).code, 'auth');
});

/* Six gyms (Kevin, 11/23/2026): "overall leaderboards between gyms along with leaderboards within the gyms". */

const at = (gas, post, r, date, answers) => {
  gas.setNow(date + 'T20:00:00-07:00');
  const out = post({ action: 'save', token: r.token, date, answers });
  assert.equal(out.ok, true, out.error);
  return out.entry.p;
};

test('teams belong to a gym: "Iron" at OKC and "Iron" at Tulsa are two teams, and each person sees only their own gym’s teams', () => {
  const { gas, post } = world('2027-01-20T19:00:00-07:00');
  const okc = ['Ann', 'Bea', 'Cal'].map((n) => join(post, n, { gym: 'okc' }));
  const tul = ['Dee', 'Eve', 'Fay'].map((n) => join(post, n, { gym: 'tulsa' }));
  const ivy = join(post, 'Ivy');
  for (const n of ['ann', 'bea', 'cal', 'dee', 'eve', 'fay']) setCell(gas, n + '@example.com', 'Team', 'Iron');
  setCell(gas, 'ivy@example.com', 'Team', 'Iron');
  const okcPts = okc.map((r) => at(gas, post, r, '2027-01-20', ALL_YES));
  at(gas, post, tul[0], '2027-01-20', { video: 1 });
  gas.setNow('2027-01-20T21:00:00-07:00');
  gas.state.cache.clear();
  const seen = (r) => post({ action: 'leaderboard', token: r.token });
  const a = seen(okc[0]);
  assert.deepEqual([a.myGym, a.myTeam], ['okc', 'okc:iron']);
  assert.deepEqual(a.board.teams.map((t) => [t.key, t.name, t.people]), [['okc:iron', 'Iron', 3]], 'only OKC’s teams');
  assert.equal(a.board.teams[0].overall, Math.round((okcPts.reduce((x, y) => x + y, 0) / 3) * 10) / 10);
  assert.deepEqual(Object.keys(a.board.teams[0]).sort(), ['key', 'name', 'overall', 'people', 'week']);
  const d = seen(tul[0]);
  assert.deepEqual([d.myGym, d.myTeam, d.board.teams.map((t) => t.key)], ['tulsa', 'tulsa:iron', ['tulsa:iron']]);
  assert.notEqual(d.board.teams[0].overall, a.board.teams[0].overall, 'two different teams');
  const i = seen(ivy);
  assert.deepEqual([i.myTeam, i.board.teams.map((t) => [t.key, t.people, t.overall])], ['ironview:iron', [['ironview:iron', 1, null]]]);
  // Moved by Kevin to OKC: her Iron View team is cleared with the move (teams belong to a gym), so
  // she's on no team at OKC until Kevin sets one; then she's on OKC's Iron team (the board
  // refreshes within two minutes).
  const move = post({ action: 'adminSetGym', key: ADMIN, email: 'ivy@example.com', gym: 'okc' });
  assert.deepEqual([move.ok, move.teamCleared], [true, 'Iron']);
  gas.setNow('2027-01-20T21:03:00-07:00');
  const moved = seen(ivy);
  assert.deepEqual([moved.myTeam, moved.board.teams.map((t) => [t.key, t.people])], ['', [['okc:iron', 3]]]);
  setCell(gas, 'ivy@example.com', 'Team', 'Iron');
  gas.setNow('2027-01-20T21:06:00-07:00');
  assert.deepEqual(seen(ivy).board.teams.map((t) => [t.key, t.people]), [['okc:iron', 4]]);
});

test('gym standings: every gym listed, ranked by its average points per person (everyone there counts, team or not); fewer than 3 people shows no numbers; test and real apart; nothing personal', () => {
  const { gas, post } = world('2027-01-26T19:00:00-07:00', { beta_start: '2027-01-25', beta_days: 7 }); // Tue of week 2
  const okc = ['Ann', 'Bea', 'Cal'].map((n) => join(post, n, { gym: 'okc' }));
  const tul = ['Dee', 'Eve', 'Fay', 'Gus'].map((n) => join(post, n, { gym: 'tulsa' }));
  const nor = ['Hal', 'Ida'].map((n) => join(post, n, { gym: 'norman' }));
  const beta = ['Kim', 'Lou', 'Max'].map((n) => join(post, n, { gym: 'native', beta: true }));
  setCell(gas, 'ann@example.com', 'Team', 'Iron'); // a team doesn't change the gym's average
  // Week 1 (Jan 18–24) and week 2 (Jan 25–31).
  const okcW1 = at(gas, post, okc[0], '2027-01-19', ALL_YES);
  const okcW2 = at(gas, post, okc[1], '2027-01-26', ALL_YES) + at(gas, post, okc[2], '2027-01-26', ALL_YES);
  const tulW2 = at(gas, post, tul[0], '2027-01-26', { video: 1, workout: 1 });
  at(gas, post, nor[0], '2027-01-26', ALL_YES);
  at(gas, post, beta[0], '2027-01-26', ALL_YES);
  setCell(gas, 'gus@example.com', 'Status', 'Removed');
  gas.setNow('2027-01-26T21:00:00-07:00');
  gas.state.cache.clear();

  const r = post({ action: 'leaderboard', token: tul[1].token });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.myGym, 'tulsa');
  assert.deepEqual(Object.keys(r.board).sort(), ['gyms', 'minPeople', 'teams', 'updated', 'week', 'weekFrom', 'weekTo', 'weeks']);
  const g = r.board.gyms;
  assert.deepEqual(g.map((x) => Object.keys(x).join()), Array(6).fill('id,name,short,people,overall,week,withheld'));
  const round = (n) => Math.round(n * 10) / 10;
  assert.deepEqual(g.slice(0, 2), [
    { id: 'okc', name: 'Koda OKC', short: 'OKC', people: 3, overall: round((okcW1 + okcW2) / 3), week: round(okcW2 / 3), withheld: false },
    { id: 'tulsa', name: 'Koda Tulsa', short: 'Tulsa', people: 3, overall: round(tulW2 / 3), week: round(tulW2 / 3), withheld: false },
  ], 'ranked by the whole challenge; Gus (removed) doesn’t count; Ann’s one-person team shows no numbers, so OKC’s don’t give her away (3 aren’t on a shown team)');
  assert.deepEqual(g.slice(2).map((x) => [x.id, x.people, x.overall, x.week, x.withheld]), [
    ['ironview', 0, null, null, false], ['native', 0, null, null, false], ['norman', 2, null, null, false], ['downtown', 0, null, null, false],
  ], 'every gym is listed; under 3 people no numbers (Norman’s would give away someone’s own); then in gym order');
  // Beta testers see the beta testers by gym, and the real people never see them.
  const b = post({ action: 'leaderboard', token: beta[1].token });
  assert.deepEqual(b.board.gyms.map((x) => [x.id, x.people]), [['native', 3], ['ironview', 0], ['okc', 0], ['norman', 0], ['downtown', 0], ['tulsa', 0]]);
  assert.equal(b.board.gyms[0].overall, round(at(gas, post, beta[0], '2027-01-26', ALL_YES) / 3));
  assert.equal(g.find((x) => x.id === 'native').people, 0);
  const text = JSON.stringify(r) + JSON.stringify(b);
  for (const who of ['Ann', 'Bea', 'Dee', 'Hal', 'Kim', '@example.com', 'Tester']) assert.ok(!text.includes(who), 'no personal data: ' + who);
});

test('gym standings can’t be used to subtract out someone’s score: with only 1 or 2 people off the shown teams, the gym’s numbers are withheld', () => {
  const { gas, post } = world('2027-01-20T19:00:00-07:00');
  const people = ['Ann', 'Bea', 'Cal', 'Dee', 'Eve'].map((n) => join(post, n, { gym: 'okc' }));
  for (const n of ['ann', 'bea', 'cal']) setCell(gas, n + '@example.com', 'Team', 'Iron');
  people.forEach((r) => at(gas, post, r, '2027-01-20', ALL_YES));
  const okcRow = () => {
    gas.setNow('2027-01-20T21:00:00-07:00');
    gas.state.cache.clear();
    const r = post({ action: 'leaderboard', token: people[0].token });
    return [r.board.gyms.find((g) => g.id === 'okc'), r.board.teams];
  };
  // Iron (3) has numbers; Dee and Eve have no team: OKC's total minus Iron's would be theirs.
  let [okc, teams] = okcRow();
  assert.deepEqual([okc.people, okc.overall, okc.week, okc.withheld], [5, null, null, true]);
  assert.notEqual(teams[0].overall, null, 'the team keeps its numbers');
  // Dee and Eve on a team of two (no numbers): still only two off the shown teams.
  setCell(gas, 'dee@example.com', 'Team', 'Steel');
  setCell(gas, 'eve@example.com', 'Team', 'Steel');
  [okc] = okcRow();
  assert.equal(okc.withheld, true);
  // A third person off the shown teams: the gym's numbers show again.
  const fay = join(post, 'Fay', { gym: 'okc' });
  at(gas, post, fay, '2027-01-20', ALL_YES);
  [okc] = okcRow();
  assert.deepEqual([okc.people, okc.withheld, okc.overall !== null], [6, false, true]);
  // Everyone on a shown team: nothing left to subtract.
  for (const n of ['dee', 'eve', 'fay']) setCell(gas, n + '@example.com', 'Team', 'Iron');
  [okc] = okcRow();
  assert.deepEqual([okc.withheld, okc.overall !== null], [false, true]);
});
