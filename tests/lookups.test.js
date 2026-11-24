'use strict';

/**
 * Account lookups (review, 11/24/2026). Sign-in, the password reset and the sign-up's "already
 * signed up?" hint told anyone whether an email has an account, with no limit. Now every answer
 * sign-in and the reset give (but a sign-in or a new password) uses one of RES27_LOOKUPS_PER_HOUR,
 * an email with an account or not; past them, an email with no account gets the answer one with an
 * account would. The hint has its own RES27_EMAIL_HINTS_PER_HOUR. Answers that don't depend on the
 * email (busy, can't send) come before any lookup.
 *   node --test tests/lookups.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { createGas } = require('../dev/gas-mock.js');

const ADMIN = 'test-admin-key-123';
const DAYS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'days-2027.json'), 'utf8'));
const LIMIT = 120; // RES27_LOOKUPS_PER_HOUR
const HINTS = 120; // RES27_EMAIL_HINTS_PER_HOUR
const NOW = '2026-11-09T10:00:00-07:00';
const HOUR = '2026-11-09-10'; // NOW's hour in Mountain time, as the counters are keyed
const LK = 'res27:lk:' + HOUR;
const EH = 'res27:eh:' + HOUR;
const KNOWN = 'casey.lane@example.com';
const NOBODY = 'nobody.here@example.com';

function world() {
  const gas = createGas();
  gas.setNow(NOW);
  const post = (body) => gas.post(Object.assign({ type: 'res27' }, body));
  const setup = post({ action: 'adminSetup', key: ADMIN, days: DAYS });
  assert.equal(setup.ok, true, setup.error);
  const cache = gas.context.CacheService.getScriptCache();
  return { gas, post, cache };
}

function register(post, first, email) {
  const r = post({
    action: 'register', gym: 'ironview', memberType: 'member', first, last: 'Lane', email, password: 'secret1',
    shirt: 'tank', size: 'S', setup: { goal: 'health', track: { nutrition: true }, plan: 'recommended' },
  });
  assert.equal(r.ok, true, r.error);
  return r;
}

const used = (cache, key) => Number(cache.get(key) || 0);
/** All but `left` of this hour's sign-in and reset answers are used up. */
const useUp = (cache, left) => cache.put(LK, String(LIMIT - left), 3700);

test('the sign-up hint says whether an email is taken until its own hour runs out, then nothing either way', () => {
  const { gas, post, cache } = world();
  register(post, 'Casey', KNOWN);
  assert.deepEqual(post({ action: 'emailStatus', email: 'Casey.Lane@Example.com ' }), { ok: true, valid: true, exists: true });
  assert.deepEqual(post({ action: 'emailStatus', email: NOBODY }), { ok: true, valid: true, exists: false });
  assert.deepEqual([used(cache, EH), used(cache, LK)], [2, 0], 'each hint uses one of its own, none of sign-in’s');

  cache.put(EH, String(HINTS - 1), 3700);
  assert.equal(post({ action: 'emailStatus', email: KNOWN }).exists, true, 'the last one of the hour still answers');
  for (const email of [KNOWN, NOBODY]) {
    assert.deepEqual(post({ action: 'emailStatus', email }), { ok: true, valid: true, exists: null }, email + ': past the hour, not known');
  }
  // Not an email at all: answered without a lookup, so it uses nothing.
  const before = used(cache, EH);
  assert.deepEqual(post({ action: 'emailStatus', email: 'not an email' }), { ok: true, valid: false, exists: false });
  assert.equal(used(cache, EH), before);
  // A rush of sign-ups doesn't touch sign-in: an email with no account still hears so.
  assert.equal(post({ action: 'login', email: NOBODY, password: 'secret1' }).code, 'no_account');

  gas.setNow('2026-11-09T11:00:00-07:00'); // a new hour, a new allowance
  assert.equal(post({ action: 'emailStatus', email: KNOWN }).exists, true);
  assert.equal(post({ action: 'emailStatus', email: NOBODY }).exists, false);
});

test('a sign-up with a taken email is still turned away when the hint had nothing to say', () => {
  const { post, cache } = world();
  register(post, 'Casey', KNOWN);
  cache.put(EH, String(HINTS), 3700);
  assert.equal(post({ action: 'emailStatus', email: KNOWN }).exists, null);
  const again = post({
    action: 'register', gym: 'ironview', memberType: 'member', first: 'Casey', last: 'Lane', email: KNOWN, password: 'secret1',
    shirt: 'tank', size: 'S', setup: { goal: 'health', track: { nutrition: true }, plan: 'recommended' },
  });
  assert.equal(again.code, 'exists');
});

test('sign-in: every answer but a sign-in uses one, an email with an account or not; past them, no account sounds like a wrong password', () => {
  const { gas, post, cache } = world();
  register(post, 'Casey', KNOWN);
  assert.equal(post({ action: 'login', email: NOBODY, password: 'secret1' }).code, 'no_account');
  assert.equal(used(cache, LK), 1);
  assert.equal(post({ action: 'login', email: KNOWN, password: 'wrong!' }).code, 'bad_password');
  assert.equal(used(cache, LK), 2, 'a known email’s wrong password uses one too');
  assert.equal(post({ action: 'login', email: KNOWN, password: 'secret1' }).ok, true);
  assert.equal(used(cache, LK), 2, 'a sign-in uses none');

  useUp(cache, 0);
  const nobody = post({ action: 'login', email: NOBODY, password: 'secret1' });
  const wrong = post({ action: 'login', email: KNOWN, password: 'wrong!' });
  assert.deepEqual([nobody.ok, nobody.code, nobody.error], [false, 'bad_password', wrong.error], 'the same answer for both');
  const ok = post({ action: 'login', email: KNOWN, password: 'secret1' });
  assert.equal(ok.ok, true, ok.error);
  // A locked account's answer uses one as well.
  gas.setNow('2026-11-09T11:00:00-07:00');
  for (let i = 0; i < 8; i++) post({ action: 'login', email: KNOWN, password: 'wrong!' });
  assert.equal(post({ action: 'login', email: KNOWN, password: 'wrong!' }).code, 'locked');
  assert.equal(used(cache, 'res27:lk:2026-11-09-11'), 9);
});

test('password reset: every request uses one; past them, no account looks like an account, and nothing is sent', () => {
  const { gas, post, cache } = world();
  register(post, 'Casey', KNOWN);
  register(post, 'Dee', 'dee.lane@example.com');
  gas.state.mail.length = 0;
  assert.equal(post({ action: 'resetStart', email: NOBODY }).code, 'no_account');
  assert.equal(post({ action: 'resetFinish', email: NOBODY, code: '123456', password: 'newpass1' }).code, 'no_account');
  assert.equal(post({ action: 'resetFinish', email: 'dee.lane@example.com', code: '123456', password: 'newpass1' }).code, 'expired');
  assert.equal(used(cache, LK), 3, 'an account’s "expired" uses one too');

  useUp(cache, 0);
  assert.deepEqual(post({ action: 'resetStart', email: NOBODY }), { ok: true }, 'looks like a code went out');
  assert.equal(gas.state.mail.length, 0, 'but nothing was sent');
  const nobody = post({ action: 'resetFinish', email: NOBODY, code: '123456', password: 'newpass1' });
  const noCode = post({ action: 'resetFinish', email: 'dee.lane@example.com', code: '123456', password: 'newpass1' });
  assert.deepEqual([nobody.code, nobody.error], [noCode.code, noCode.error], 'the same as an account with no code waiting');
  assert.equal(noCode.code, 'expired');

  // A real reset still works past the hour's lookups.
  assert.equal(post({ action: 'resetStart', email: KNOWN }).ok, true);
  assert.equal(gas.state.mail.length, 1);
  const code = /(\d{6})/.exec(gas.state.mail[0].subject)[1];
  const done = post({ action: 'resetFinish', email: KNOWN, code, password: 'brandnew' });
  assert.equal(done.ok, true, done.error);
});

test('password reset: once the hour’s resets are used up, every email is told it’s busy, before any lookup', () => {
  const { gas, post, cache } = world();
  register(post, 'Casey', KNOWN);
  gas.state.mail.length = 0;
  cache.put('res27:rs:' + HOUR, '30', 3700); // RES27_RESET_STARTS_PER_HOUR
  const known = post({ action: 'resetStart', email: KNOWN });
  const nobody = post({ action: 'resetStart', email: NOBODY });
  assert.deepEqual([known.code, nobody.code, nobody.error], ['busy', 'busy', known.error]);
  assert.equal(cache.get(LK), null, 'a busy answer looks nothing up');
  assert.equal(gas.state.mail.length, 0);
});

test('password reset: when no code can be emailed at all, every email hears so, before any lookup, logged once an hour', () => {
  const { gas, post, cache } = world();
  register(post, 'Casey', KNOWN);
  gas.state.mail.length = 0;
  gas.context.MailApp.getRemainingDailyQuota = () => 1; // the provider is off in this world, and Gmail is nearly out
  cache.put(LK, String(LIMIT + 5), 3700);
  const known = post({ action: 'resetStart', email: KNOWN });
  const nobody = post({ action: 'resetStart', email: NOBODY });
  assert.deepEqual([known.code, nobody.code, nobody.error], ['mail', 'mail', known.error]);
  assert.equal(used(cache, LK), LIMIT + 5, 'nothing looked up');
  assert.equal(gas.state.mail.length, 0);
  assert.equal(gas.rows('Accounts').find((a) => a.Email === KNOWN)['Reset Code'], '', 'no code made');
  const rows = gas.rows('Log').filter((l) => l.What === 'Email not sent' && l.Who === '(password reset)');
  assert.equal(rows.length, 1, 'one Log row for the hour, not one per try');
});

test('failed sign-ins and reset codes take the same time, an email with an account or not; successes don’t wait', () => {
  const { gas, post, cache } = world();
  register(post, 'Casey', KNOWN);
  useUp(cache, 0);
  const waits = (body) => {
    gas.state.sleeps.length = 0;
    const r = post(body);
    return { code: r.code || (r.ok ? 'ok' : ''), slept: gas.state.sleeps.reduce((a, b) => a + b, 0) };
  };
  const answers = [
    waits({ action: 'login', email: NOBODY, password: 'secret1' }),
    waits({ action: 'login', email: KNOWN, password: 'wrong!' }),
    waits({ action: 'resetFinish', email: NOBODY, code: '123456', password: 'newpass1' }),
    waits({ action: 'resetFinish', email: KNOWN, code: '123456', password: 'newpass1' }),
  ];
  assert.deepEqual(answers.map((a) => a.code), ['bad_password', 'bad_password', 'expired', 'expired']);
  for (const a of answers) assert.ok(a.slept > 1500 && a.slept <= 2000, 'held to about 2 s: ' + JSON.stringify(a));
  const ok = waits({ action: 'login', email: KNOWN, password: 'secret1' });
  assert.deepEqual(ok, { code: 'ok', slept: 0 }, 'a sign-in isn’t held');
  const blank = waits({ action: 'login', email: '', password: 'secret1' });
  assert.equal(blank.slept, 0, 'nor is an answer that comes before the lookup');
});

test('a code whose send fails: "couldn’t send" while the hour’s lookups last, "we sent a code" past them; the provider is tried again next time', () => {
  const { gas, post, cache } = world();
  register(post, 'Casey', KNOWN);
  register(post, 'Dee', 'dee.lane@example.com');
  assert.equal(post({ action: 'adminSetup', key: ADMIN, settings: { email_provider: 'resend', email_from: 'Koda Resolutions <resolutions@kodacrossfitironview.com>' } }).ok, true);
  gas.state.properties.set('RES27_EMAIL_API_KEY', 'fake-test-key');
  gas.context.MailApp.getRemainingDailyQuota = () => 1; // Gmail can't step in
  let down = true;
  gas.state.fetchResponder = () => (down ? { code: 500, body: { statusCode: 500, name: 'application_error', message: 'down' } } : undefined);
  assert.equal(post({ action: 'resetStart', email: KNOWN }).code, 'mail', 'within the hour’s lookups it says so');
  useUp(cache, 0);
  const dee = post({ action: 'resetStart', email: 'dee.lane@example.com' });
  const nobody = post({ action: 'resetStart', email: NOBODY });
  assert.deepEqual([dee, nobody], [{ ok: true }, { ok: true }], 'past them, the same answer as a sent code');
  assert.equal(gas.rows('Accounts').find((a) => a.Email === 'dee.lane@example.com')['Reset Code'], '', 'no code was kept for an email that never went out');
  assert.ok(gas.rows('Log').some((l) => l.What === 'Email not sent' && l.Who === 'dee.lane@example.com'), 'the Log names it');
  // The provider is back: the next reset goes through it (nothing turns resets away for the hour).
  down = false;
  const fetchesBefore = gas.state.fetches.length;
  gas.setNow('2026-11-09T10:02:00-07:00');
  assert.equal(post({ action: 'resetStart', email: KNOWN }).ok, true);
  assert.ok(gas.state.fetches.length > fetchesBefore, 'it tried the provider again');
  assert.ok(gas.state.delivered.some((m) => m.to === KNOWN), 'and the code went out');
});

test('sign-in refuses a password longer than any account can have, before any lookup or hashing', () => {
  const { gas, post, cache } = world();
  register(post, 'Casey', KNOWN);
  useUp(cache, 0);
  const utils = gas.context.Utilities;
  const real = utils.computeHmacSha256Signature;
  let hmacs = 0;
  utils.computeHmacSha256Signature = function () { hmacs += 1; return real.apply(this, arguments); };
  try {
    const huge = 'x'.repeat(1000000);
    for (const email of [KNOWN, NOBODY]) {
      hmacs = 0;
      gas.state.sleeps.length = 0;
      const r = post({ action: 'login', email, password: huge });
      assert.deepEqual([r.code, r.error, hmacs, gas.state.sleeps.length], ['bad_request', 'That password is too long.', 0, 0], email);
    }
    assert.equal(used(cache, LK), LIMIT, 'no lookup used');
    // A normal wrong password does the same hashing for an email with an account and one without.
    const counts = [KNOWN, NOBODY].map((email) => { hmacs = 0; post({ action: 'login', email, password: 'wrong!' }); return hmacs; });
    assert.equal(counts[0], counts[1]);
    assert.ok(counts[0] >= 300, 'the full 300 rounds: ' + counts[0]);
    // Change password's "current" gets the same cap, so a signed-in account can't tie the script up.
    const me = post({ action: 'login', email: KNOWN, password: 'secret1' });
    assert.equal(me.ok, true, me.error);
    hmacs = 0;
    const change = post({ action: 'password', token: me.token, current: huge, password: 'newpass9' });
    assert.equal(change.code, 'bad_password');
    assert.ok(hmacs <= 2, 'only the sign-in token’s check, no password hashing: ' + hmacs);
  } finally {
    utils.computeHmacSha256Signature = real;
  }
});

test('the Log gets one row the hour sign-in and reset answers run out', () => {
  const { gas, post, cache } = world();
  useUp(cache, 1);
  for (let i = 0; i < 5; i++) post({ action: 'login', email: 'probe' + i + '@example.com', password: 'secret1' });
  const rows = gas.rows('Log').filter((l) => l.What === 'Lookup limit reached');
  assert.equal(rows.length, 1);
  assert.match(rows[0].Detail, /120/);
});
