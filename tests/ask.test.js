'use strict';

/**
 * "Ask a question" on the FAQs page (Kevin, 11/11/2026): the question is emailed to the person's
 * coach (Settings coach_emails), Reply-To the person; no coach → the gym's contact_email. Every
 * question is kept on the Questions tab.   node --test "tests/*.test.js"
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { createGas } = require('../dev/gas-mock.js');

const ADMIN = 'test-admin-key-123';
const DAYS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'days-2027.json'), 'utf8'));
const SETUP = { goal: 'health', track: { nutrition: true, workout: true, sleep: true }, plan: 'recommended', sleepHours: 7, coaches: [] };
const COACHES = 'Riley: riley.coach@example.com\nMaggie Kerr = <maggie.coach@example.com>, Jamie  jamie.coach@example.com';

function world(settings) {
  const gas = createGas();
  gas.setNow('2027-01-27T19:00:00-07:00'); // Day 10
  const post = (body) => gas.post(Object.assign({ type: 'res27' }, body));
  const setup = post({ action: 'adminSetup', key: ADMIN, days: DAYS, settings: Object.assign({ welcome_email: false }, settings || {}) });
  assert.equal(setup.ok, true, setup.error);
  return { gas, post };
}

function join(post, first, extra) {
  const r = post(Object.assign({
    action: 'register', memberType: 'member', first, last: 'Asker', email: first.toLowerCase() + '@example.com', password: 'secret1',
    shirt: 'tee', size: 'M', setup: SETUP,
  }, extra || {}));
  assert.equal(r.ok, true, r.error);
  return r;
}

function setCell(gas, email, header, value) {
  const sheet = gas.sheet('Participants');
  const values = sheet.getDataRange().getValues();
  const head = values[0];
  const row = values.findIndex((r) => r[head.indexOf('Email')] === email);
  sheet.getRange(row + 1, head.indexOf(header) + 1).setValue(value);
}

test('a question goes to the person’s coach, Reply-To the person, and is kept on the Questions tab', () => {
  const { gas, post } = world({ coach_emails: COACHES });
  const ann = join(post, 'Ann');
  setCell(gas, 'ann@example.com', 'Coach', 'Riley');
  setCell(gas, 'ann@example.com', 'Team', 'Iron');
  const r = post({ action: 'ask', token: ann.token, question: 'Can I have oat milk in my coffee?\nAnd is honey ok?' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.sent, r.to, r.coach], [true, 'coach', 'Riley']);
  assert.ok(!JSON.stringify(r).includes('@'), 'the coach’s address never goes back to the app');
  const mail = gas.state.mail[gas.state.mail.length - 1];
  assert.equal(mail.to, 'riley.coach@example.com');
  assert.equal(mail.replyTo, 'ann@example.com');
  assert.equal(mail.subject, 'Resolutions question from Ann Asker');
  assert.match(mail.htmlBody, /Can I have oat milk in my coffee\?<br>And is honey ok\?/);
  assert.match(mail.htmlBody, /Team Iron/);
  assert.match(mail.htmlBody, /Day 10 of 42/);
  assert.match(mail.htmlBody, /Reply to this email to answer Ann directly/);
  const q = gas.rows('Questions');
  assert.equal(q.length, 1);
  assert.deepEqual([q[0]['Name'], q[0]['Coach'], q[0]['Sent To'], q[0]['Emailed']], ['Ann Asker', 'Riley', 'riley.coach@example.com', 'Sent']);
  assert.match(q[0]['Question'], /oat milk/);
});

test('coach_emails formats, first-name matches, and the gym when there’s no coach or no address', () => {
  const { gas, post } = world({ coach_emails: COACHES });
  const people = [['Bea', 'Maggie Kerr', 'maggie.coach@example.com'], ['Cal', 'Jamie', 'jamie.coach@example.com'], ['Dee', 'riley s.', 'riley.coach@example.com'], ['Eve', '', 'kodaironview@gmail.com'], ['Fay', 'Nate', 'kodaironview@gmail.com'], ['Hal', 'Maggie Smith', 'kodaironview@gmail.com']];
  for (const [first, coach, to] of people) {
    const r = join(post, first);
    if (coach) setCell(gas, first.toLowerCase() + '@example.com', 'Coach', coach);
    const out = post({ action: 'ask', token: r.token, question: 'What counts as a workout?' });
    assert.equal(out.ok, true, out.error);
    const mail = gas.state.mail[gas.state.mail.length - 1];
    assert.equal(mail.to, to, first + ' → ' + to);
    assert.equal(out.to, to === 'kodaironview@gmail.com' ? 'gym' : 'coach');
    if (first === 'Eve') assert.match(mail.htmlBody, /No coach is assigned yet, so this came to the gym/);
    if (first === 'Fay') assert.match(mail.htmlBody, /Coach Nate has no email in coach_emails/);
  }
  assert.equal(gas.rows('Questions').length, 6, 'Maggie Smith is not Maggie Kerr');
});

test('limits: five per clock hour, twenty in 24 hours (counted on the Questions tab), forty an hour for the whole app', () => {
  const { gas, post } = world();
  const ann = join(post, 'Ann');
  const ask = (r, q) => post({ action: 'ask', token: r.token, question: q || 'Is this okay?' });
  for (let h = 0; h < 4; h++) {
    gas.setNow('2027-01-27T' + String(8 + h).padStart(2, '0') + ':05:00-07:00');
    for (let i = 0; i < 5; i++) assert.equal(ask(ann).ok, true, 'hour ' + h + ' #' + i);
    assert.equal(ask(ann).code, 'busy_asks', 'a sixth in the same hour');
  }
  gas.setNow('2027-01-27T13:05:00-07:00');
  assert.equal(ask(ann).code, 'busy_asks', 'twenty in the last 24 hours');
  gas.setNow('2027-01-28T08:06:00-07:00');
  assert.equal(ask(ann).ok, true, 'a day later the first hour has rolled off');
  // The whole app: forty an hour.
  gas.setNow('2027-01-28T15:00:00-07:00');
  const people = Array.from({ length: 9 }, (_, i) => join(post, 'P' + i));
  let ok = 0;
  let busy = 0;
  people.forEach((r) => {
    for (let i = 0; i < 5; i++) {
      const out = ask(r);
      if (out.ok) ok++;
      else if (out.code === 'busy_asks') busy++;
    }
  });
  assert.deepEqual([ok, busy], [40, 5]);
});

test('a question that could not be emailed is kept, and the app is not told it reached the coach', () => {
  const { gas, post } = world({ coach_emails: COACHES });
  const ann = join(post, 'Ann');
  setCell(gas, 'ann@example.com', 'Coach', 'Riley');
  gas.state.beforeMail = () => {
    throw new Error('Service invoked too many times for one day: email.');
  };
  const r = post({ action: 'ask', token: ann.token, question: 'Can I swap dinner and lunch?' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.sent, r.coach], [false, '']);
  const q = gas.rows('Questions');
  assert.deepEqual([q.length, q[0]['Emailed'], q[0]['Sent To']], [1, 'NOT SENT', 'riley.coach@example.com']);
});

test('the app only learns yes or no about the coach address; clearing a tester clears their questions', () => {
  const { gas, post } = world({ coach_emails: COACHES, beta_start: '2027-01-25', beta_days: 7 });
  const ann = join(post, 'Ann');
  setCell(gas, 'ann@example.com', 'Coach', 'Jamie');
  let me = post({ action: 'me', token: ann.token }).me;
  assert.equal(me.person.askToCoach, true);
  assert.ok(!JSON.stringify(me).includes('jamie.coach@'), 'no address in the app');
  setCell(gas, 'ann@example.com', 'Coach', 'Nate');
  me = post({ action: 'me', token: ann.token }).me;
  assert.equal(me.person.askToCoach, false);
  const tess = join(post, 'Tess', { beta: true });
  post({ action: 'ask', token: tess.token, question: 'My knee hurts after squats, should I skip?' });
  post({ action: 'ask', token: ann.token, question: 'Real question' });
  const out = post({ action: 'adminPurgeTests', key: ADMIN, email: 'tess@example.com' });
  assert.equal(out.removed.questions, 1);
  assert.deepEqual(gas.rows('Questions').map((r) => r['Name']), ['Ann Asker']);
});

test('empty, too long, too many: friendly errors; HTML is escaped; beta questions are marked', () => {
  const { gas, post } = world({ beta_start: '2027-01-25', beta_days: 7 });
  const ann = join(post, 'Ann');
  assert.equal(post({ action: 'ask', token: ann.token, question: '  ' }).code, 'bad_question');
  assert.equal(post({ action: 'ask', token: ann.token, question: 'x'.repeat(2001) }).code, 'bad_question');
  const r = post({ action: 'ask', token: ann.token, question: '<script>alert(1)</script> is <b>bold</b> ok?' });
  assert.equal(r.ok, true, r.error);
  const mail = gas.state.mail[gas.state.mail.length - 1];
  assert.ok(!/<script>|<b>bold/.test(mail.htmlBody), 'escaped');
  assert.match(mail.htmlBody, /&lt;script&gt;/);
  for (let i = 0; i < 4; i++) assert.equal(post({ action: 'ask', token: ann.token, question: 'Question ' + i }).ok, true);
  assert.equal(post({ action: 'ask', token: ann.token, question: 'One too many' }).code, 'busy_asks', 'five an hour');
  const tess = join(post, 'Tess', { beta: true });
  post({ action: 'ask', token: tess.token, question: 'Beta question' });
  assert.match(gas.state.mail[gas.state.mail.length - 1].subject, /^\[Beta\] Resolutions question from Tess Asker$/);
  assert.equal(post({ action: 'ask', token: 'nope', question: 'Hello?' }).code, 'auth');
});

test('setup adds the Questions tab and the coach_emails setting, and retires edit_days_back', () => {
  const { gas } = world();
  assert.ok(gas.sheet('Questions'), 'Questions tab');
  const keys = gas.sheet('Settings').getDataRange().getValues().map((r) => r[0]);
  assert.ok(keys.includes('coach_emails'));
  assert.ok(!keys.includes('edit_days_back'));
});
