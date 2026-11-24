'use strict';

/**
 * The daily email (Kevin, 11/23/2026): each person gets the day's details and a link to log
 * yesterday, at 3 AM in their gym's time zone; it says they're overdue if they haven't entered the
 * day two days before ("3am on a wednesday would say they are overdue if they didn't enter monday's
 * points"). Sent through Resend or Brevo (mocked: nothing leaves this computer), with a signed
 * "Stop these daily emails" link.   node --test "tests/*.test.js"
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const { createGas } = require('../dev/gas-mock.js');

const ADMIN = 'test-admin-key-123';
const DAYS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'days-2027.json'), 'utf8'));
const SETUP = { goal: 'health', track: { nutrition: true, workout: true, sleep: true }, plan: 'recommended', sleepHours: 7, coaches: [] };
const KEY = 'fake-test-key-SECRET-DONOTLOG';
const MAIL = { daily_email: true, email_provider: 'resend', email_from: 'Koda Resolutions <resolutions@example.com>', welcome_email: false };
const BATCH = 'https://api.resend.com/emails/batch';
const BREVO = 'https://api.brevo.com/v3/smtp/email';
const SITE = 'https://koda-crossfit.github.io/resolutions/';
// 3:10 AM in each gym's time zone (January: Denver is UTC-7, Chicago UTC-6).
const chicago = (day, time) => day + 'T' + (time || '03:10') + ':00-06:00';
const denver = (day, time) => day + 'T' + (time || '03:10') + ':00-07:00';

function world(settings, at) {
  const gas = createGas();
  gas.setNow(at || '2027-01-10T10:00:00-07:00');
  gas.state.properties.set('RES27_EMAIL_API_KEY', KEY); // Kevin pastes it in Script Properties
  const post = (body) => gas.post(Object.assign({ type: 'res27' }, body));
  const setup = post({ action: 'adminSetup', key: ADMIN, days: DAYS, settings: Object.assign({}, MAIL, settings || {}) });
  assert.equal(setup.ok, true, setup.error);
  return { gas, post };
}

function join(post, first, gym, extra) {
  const r = post(Object.assign({
    action: 'register', gym, memberType: 'member', first, last: 'Mailer', email: first.toLowerCase() + '@example.com', password: 'secret1',
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
  assert.ok(row > 0, 'no row for ' + email);
  sheet.getRange(row + 1, head.indexOf(header) + 1).setValue(value);
  gas.state.cache.clear();
}

/** A cell on the Gyms tab, as Kevin would type it. */
function setGymCell(gas, id, header, value) {
  const sheet = gas.sheet('Gyms');
  const values = sheet.getDataRange().getValues();
  const head = values[0];
  const row = values.findIndex((r) => r[head.indexOf('Gym')] === id);
  assert.ok(row > 0, 'no Gyms row for ' + id);
  sheet.getRange(row + 1, head.indexOf(header) + 1).setValue(value);
  gas.state.cache.clear();
}

/** An account's Email cell on the Accounts tab (as a sheet from before 11/23/2026 could hold it). */
function setAccountEmail(gas, email, value) {
  const sheet = gas.sheet('Accounts');
  const values = sheet.getDataRange().getValues();
  const head = values[0];
  const row = values.findIndex((r) => r[head.indexOf('Email')] === email);
  assert.ok(row > 0, 'no account for ' + email);
  sheet.getRange(row + 1, head.indexOf('Email') + 1).setValue(value);
  gas.state.cache.clear();
}

function setSetting(gas, key, value) {
  const sheet = gas.sheet('Settings');
  const row = sheet.getDataRange().getValues().findIndex((r) => r[0] === key) + 1;
  assert.ok(row > 0, 'no setting ' + key);
  sheet.getRange(row, 2).setValue(value);
  gas.state.cache.clear();
}

/** The 3 AM trigger, at that moment. */
function run(gas, at) {
  gas.setNow(at);
  const out = gas.call('res27DailyEmails');
  assert.equal(out.ok, true);
  return Object.fromEntries(out.gyms.map((g) => [g.gym, g]));
}

/** Every email handed to Resend so far (each batch item), optionally only since index `from` of state.fetches. */
function sent(gas, from) {
  return gas.state.fetches.slice(from || 0).filter((f) => f.url === BATCH).flatMap((f) => JSON.parse(f.payload));
}
const to = (items) => items.map((i) => i.to[0]).sort();

/** One day's answers, saved that evening (the clock moves there and back). */
function saveDay(gas, post, token, date, answers) {
  const was = gas.now().toISOString();
  gas.setNow(date + 'T20:00:00-07:00');
  const r = post({ action: 'save', token, date, answers, patch: true });
  assert.equal(r.ok, true, r.error);
  gas.setNow(was);
}

const dailyLog = (gas) => gas.rows('Log').filter((l) => /^Daily email/.test(l.What));

/* ------------------------------------------------------------------ who gets it ---- */

test('who gets it: not Daily Email Off, not Removed, only their own gym, nothing before Day 1, the Monday after the end too; Test accounts on the beta’s days', () => {
  const { gas, post } = world({ beta_start: '2027-01-04', beta_days: 7 }, '2027-01-01T10:00:00-07:00');
  join(post, 'Ann', 'okc');
  join(post, 'Bea', 'okc');
  join(post, 'Cal', 'okc');
  join(post, 'Dee', 'tulsa');
  const eve = join(post, 'Eve', 'okc', { beta: true });
  assert.equal(eve.me.person.type, 'Test');
  setCell(gas, 'bea@example.com', 'Daily Email', 'Off');
  setCell(gas, 'cal@example.com', 'Status', 'Removed');

  // The beta (Mon Jan 4 – Sun Jan 10): only the beta tester, on the beta's days.
  let r = run(gas, chicago('2027-01-06'));
  assert.deepEqual(to(sent(gas)), ['eve@example.com']);
  assert.equal(sent(gas)[0].subject, '[Beta] Day 3 · ' + DAYS[2].title + ' · Koda Resolutions');
  assert.equal(r.tulsa.status, 'nobody', 'Dee is a member: her challenge hasn’t started');
  let mark = gas.state.fetches.length;
  run(gas, chicago('2027-01-11'));
  assert.deepEqual(sent(gas, mark).map((i) => [i.to[0], i.subject]), [['eve@example.com', '[Beta] Last day to log week 1 · Koda Resolutions']], 'the Monday after the beta');
  mark = gas.state.fetches.length;
  r = run(gas, chicago('2027-01-12'));
  assert.equal(gas.state.fetches.length, mark, 'nothing the day after that');
  r = run(gas, chicago('2027-01-17'));
  assert.ok(Object.values(r).every((g) => g.status === 'nobody' || g.status === 'not due'), 'nothing before Day 1');
  assert.equal(gas.state.fetches.length, mark);

  // Day 1 of the real challenge: Ann (OKC) and Dee (Tulsa); not Bea (Off), Cal (Removed), or Eve (still on the beta's calendar).
  mark = gas.state.fetches.length;
  r = run(gas, chicago('2027-01-18'));
  assert.deepEqual(to(sent(gas, mark)), ['ann@example.com', 'dee@example.com']);
  assert.deepEqual([r.okc.status, r.okc.sent, r.tulsa.sent], ['sent', 1, 1]);
  assert.equal(gas.state.fetches.slice(mark).length, 2, 'one request per gym');
  // Kevin clears beta_start: Test accounts are on the real challenge again, and get it too.
  setSetting(gas, 'beta_start', '');
  mark = gas.state.fetches.length;
  run(gas, chicago('2027-01-19'));
  assert.deepEqual(to(sent(gas, mark)), ['ann@example.com', 'dee@example.com', 'eve@example.com']);
  // The Monday after the last day (Sun Feb 28): "Last day to log week 6". The Tuesday: nothing.
  mark = gas.state.fetches.length;
  run(gas, chicago('2027-03-01'));
  const last = sent(gas, mark);
  assert.deepEqual(to(last), ['ann@example.com', 'dee@example.com', 'eve@example.com']);
  assert.ok(last.every((i) => i.subject === 'Last day to log week 6 · Koda Resolutions'));
  mark = gas.state.fetches.length;
  r = run(gas, chicago('2027-03-02'));
  assert.equal(gas.state.fetches.length, mark);
  assert.equal(r.okc.status, 'nobody');
});

/* ------------------------------------------------------------------ overdue ---- */

test('overdue: 3 AM Wednesday says Monday if nothing was logged for it (Kevin’s example); a Tuesday never does; a part-logged day isn’t overdue', () => {
  const { gas, post } = world();
  const ann = join(post, 'Ann', 'okc'); // logs nothing
  const bea = join(post, 'Bea', 'okc'); // logs Monday
  const cal = join(post, 'Cal', 'okc'); // logs one answer on Monday
  saveDay(gas, post, bea.token, '2027-01-18', { video: 1, workout: 1, sleep: 1, 'nutrition:m1': 1 });
  saveDay(gas, post, cal.token, '2027-01-18', { video: 0 });
  const boxOf = (item) => /You haven’t logged/.test(item.html);
  const byTo = (items) => Object.fromEntries(items.map((i) => [i.to[0], i]));

  run(gas, chicago('2027-01-18')); // Day 1: nothing two days back
  assert.ok(sent(gas).every((i) => !boxOf(i)));
  let mark = gas.state.fetches.length;
  run(gas, chicago('2027-01-19')); // Day 2: two days back is before Day 1
  assert.ok(sent(gas, mark).every((i) => !boxOf(i)));

  mark = gas.state.fetches.length;
  run(gas, chicago('2027-01-20')); // Wednesday
  let items = byTo(sent(gas, mark));
  assert.equal(boxOf(items['ann@example.com']), true);
  assert.equal(boxOf(items['bea@example.com']), false, 'she logged Monday');
  assert.equal(boxOf(items['cal@example.com']), false, 'something was logged for Monday');
  const ann20 = items['ann@example.com'];
  assert.match(ann20.html, /You haven’t logged Monday, January 18 \(Day 1\) yet\.<\/b> You can still fill it in until Monday at midnight\./);
  assert.ok(ann20.html.includes('href="' + SITE + '?gym=okc#/day/2027-01-18"'), 'a button to that day');
  assert.match(ann20.text, /You haven’t logged Monday, January 18 \(Day 1\) yet\. You can still fill it in until Monday at midnight\.\nLog Monday: https:\/\/koda-crossfit\.github\.io\/resolutions\/\?gym=okc#\/day\/2027-01-18/);
  assert.equal(items['bea@example.com'].subject, ann20.subject, 'otherwise the same email');
  assert.match(dailyLog(gas).pop().What, /^Daily email · OKC · 2027-01-20 · 3 sent, 0 failed, 1 overdue$/);

  mark = gas.state.fetches.length;
  run(gas, chicago('2027-01-21')); // Thursday: Tuesday the 19th, which nobody logged
  items = byTo(sent(gas, mark));
  assert.ok(Object.values(items).every(boxOf));
  assert.match(items['bea@example.com'].html, /You haven’t logged Tuesday, January 19 \(Day 2\) yet/);

  mark = gas.state.fetches.length;
  run(gas, chicago('2027-01-25')); // Monday: Saturday the 23rd, still open until tonight
  items = byTo(sent(gas, mark));
  assert.match(items['ann@example.com'].html, /You haven’t logged Saturday, January 23 \(Day 6\) yet\.<\/b> You can still fill it in until tonight at midnight\./);

  mark = gas.state.fetches.length;
  run(gas, chicago('2027-01-26')); // Tuesday: Sunday the 24th locked at Monday midnight
  items = sent(gas, mark);
  assert.equal(items.length, 3);
  assert.ok(items.every((i) => !boxOf(i)), 'a Tuesday email never has the box');
  assert.match(dailyLog(gas).pop().What, / · 3 sent, 0 failed, 0 overdue$/);
});

/* ------------------------------------------------------------------ what it says ---- */

test('what it says: Day N of 42, week and theme, title, about, action, bonus, the buttons (with the gym in the link), the Monday line, the gym’s footer and stop link', () => {
  const { gas, post } = world();
  const ann = join(post, 'Ann', 'okc');
  const ivy = join(post, 'Ivy', 'ironview');
  run(gas, chicago('2027-01-18'));
  run(gas, denver('2027-01-18'));
  const day1 = Object.fromEntries(sent(gas).map((i) => [i.to[0], i]));
  const a1 = day1['ann@example.com'];
  assert.equal(a1.subject, 'Day 1 · ' + DAYS[0].title + ' · Koda Resolutions');
  assert.ok(!/Log yesterday’s points/.test(a1.html), 'Day 1 has no yesterday');
  assert.ok(!/Last week locks tonight/.test(a1.html), 'nor a week before it');

  let mark = gas.state.fetches.length;
  run(gas, chicago('2027-01-20'));
  const a = sent(gas, mark)[0];
  const d3 = DAYS[2];
  assert.equal(a.subject, 'Day 3 · ' + d3.title + ' · Koda Resolutions');
  // Kevin, 11/23: one address for every gym, each gym's own name and reply-to.
  assert.equal(a.from, 'Koda OKC Resolutions <resolutions@example.com>');
  assert.equal(a.reply_to, 'kodaironview@gmail.com', 'OKC has no contact email of its own yet: Settings’');
  for (const bit of ['<h1 style="font-size:20px;margin:0 0 14px;color:#6A1FCB">' + d3.title + '</h1>', 'Day 3 of 42 · Week 1: ' + d3.theme, d3.about, 'Today’s action</p>' + d3.action, 'Bonus task (+1 point)</p>' + d3.bonus]) {
    assert.ok(a.html.includes(bit), 'html has ' + bit);
  }
  assert.ok(a.html.includes('href="' + SITE + '?gym=okc#/today"'), 'the today button, with the gym, so the page opens in OKC’s colors');
  assert.match(a.html, /Open today in the app<\/a>/, 'no video pasted yet');
  assert.ok(a.html.includes('href="' + SITE + '?gym=okc#/day/2027-01-19"') && /Log yesterday’s points/.test(a.html));
  assert.match(a.html, /Koda OKC · 7016 Ozzy Ave, Oklahoma City, OK 73105 · kodaironview@gmail\.com<br><a href="https:\/\/koda-crossfit\.github\.io\/resolutions\/\?gym=okc#\/email-off\?u=R[A-Z2-9]{6}&amp;s=[0-9a-f]{24}"[^>]*>Stop these daily emails<\/a>/);
  assert.match(a.headers['List-Unsubscribe'], new RegExp('^<' + SITE.replace(/[.?/]/g, '\\$&') + '\\?gym=okc#/email-off\\?u=' + ann.me.person.id + '&s=[0-9a-f]{24}>$'));
  for (const line of ['Day 3 of 42 · Week 1: ' + d3.theme, 'Today’s action: ' + d3.action, 'Bonus task (+1 point): ' + d3.bonus, 'Log yesterday’s points: ' + SITE + '?gym=okc#/day/2027-01-19', 'Stop these daily emails: ' + SITE + '?gym=okc#/email-off?u=' + ann.me.person.id]) {
    assert.ok(a.text.includes(line), 'text has ' + line);
  }
  // A video pasted for the day: the button says so.
  const days = gas.sheet('Days');
  const head = days.getRange(1, 1, 1, days.getLastColumn()).getValues()[0];
  days.getRange(5, head.indexOf('Video URL') + 1).setValue('https://youtu.be/AbCdEfGhIjK'); // Day 4
  gas.state.cache.clear();
  mark = gas.state.fetches.length;
  run(gas, chicago('2027-01-21'));
  assert.match(sent(gas, mark)[0].html, /Watch today’s video<\/a>/);

  // The second Monday: last week locks tonight.
  mark = gas.state.fetches.length;
  run(gas, chicago('2027-01-25'));
  assert.match(sent(gas, mark)[0].html, /Last week locks tonight at midnight: make sure every day is filled in\./);
  assert.match(sent(gas, mark)[0].text, /Last week locks tonight at midnight: make sure every day is filled in\./);
  // The Monday after the end: the last day to log week 6, yesterday is Feb 28.
  mark = gas.state.fetches.length;
  run(gas, chicago('2027-03-01'));
  const end = sent(gas, mark)[0];
  assert.equal(end.subject, 'Last day to log week 6 · Koda Resolutions');
  assert.ok(end.html.includes('Last day to log week 6</h1>') && /Last week locks tonight at midnight/.test(end.html) && end.html.includes('?gym=okc#/day/2027-02-28'));
  // Iron View's: its old frame and links without ?gym (the app's own look).
  const i1 = day1['ivy@example.com'];
  assert.match(i1.html, /background:#0C1A2B;padding:22px 28px;color:#FFFFFF">/);
  assert.match(i1.html, /Koda CrossFit Iron View · 740 S Pierce Ave #5, Louisville, CO 80027 · kodaironview@gmail\.com<br>/);
  assert.ok(i1.html.includes('href="' + SITE + '#/today"') && i1.headers['List-Unsubscribe'].startsWith('<' + SITE + '#/email-off?u=' + ivy.me.person.id + '&s='));
});

/* ------------------------------------------------------------------ when it goes ---- */

test('time zones: 3 AM Chicago sends the five Chicago gyms, Iron View waits for 3 AM Denver; each gym once a day; a missed run is caught up before noon', () => {
  const { gas, post } = world();
  join(post, 'Ivy', 'ironview');
  join(post, 'Ann', 'okc');
  join(post, 'Tom', 'tulsa');
  let r = run(gas, chicago('2027-01-20')); // 2:10 AM in Denver
  assert.deepEqual([r.ironview.status, r.okc.status, r.tulsa.status, r.native.status], ['not due', 'sent', 'sent', 'nobody']);
  assert.deepEqual(to(sent(gas)), ['ann@example.com', 'tom@example.com']);
  r = run(gas, chicago('2027-01-20', '03:20')); // the trigger again
  assert.deepEqual([r.ironview.status, r.okc.status, r.tulsa.status], ['not due', 'already sent', 'already sent']);
  assert.equal(sent(gas).length, 2);
  r = run(gas, denver('2027-01-20')); // 4:10 AM in Chicago
  assert.deepEqual([r.ironview.status, r.okc.status, r.tulsa.status], ['sent', 'already sent', 'already sent']);
  assert.deepEqual(to(sent(gas)), ['ann@example.com', 'ivy@example.com', 'tom@example.com']);
  assert.equal(gas.state.properties.get('RES27_DAILY_okc'), '2027-01-20');
  assert.equal(gas.state.properties.get('RES27_DAILY_ironview'), '2027-01-20');
  // Thursday, Google skipped the 3 AM runs: a run at 11:30 (Chicago) catches up every gym that's due.
  let mark = gas.state.fetches.length;
  r = run(gas, chicago('2027-01-21', '11:30'));
  assert.deepEqual([r.ironview.status, r.okc.status, r.tulsa.status], ['sent', 'sent', 'sent'], '10:30 in Denver');
  assert.equal(sent(gas, mark).length, 3);
  // Friday: the first run is at noon in Chicago: too late there (it only goes out in the morning), 11 AM in Denver.
  mark = gas.state.fetches.length;
  r = run(gas, chicago('2027-01-22', '12:05'));
  assert.deepEqual([r.ironview.status, r.okc.status, r.tulsa.status], ['sent', 'not due', 'not due']);
  assert.deepEqual(to(sent(gas, mark)), ['ivy@example.com']);
  // Before email_hour: not yet.
  r = run(gas, chicago('2027-01-23', '02:50'));
  assert.equal(r.okc.status, 'not due');
});

test('two runs can’t send the same day twice: the day is marked before sending, under the lock', () => {
  const { gas, post } = world();
  join(post, 'Ann', 'okc');
  join(post, 'Tom', 'tulsa');
  let nested = null;
  // A second trigger starts while the first is still sending OKC's emails.
  gas.state.fetchResponder = () => {
    if (!nested) nested = gas.call('res27DailyEmails');
    return undefined; // the default answer
  };
  gas.setNow(chicago('2027-01-20'));
  const first = gas.call('res27DailyEmails');
  const byGym = (out) => Object.fromEntries(out.gyms.map((g) => [g.gym, g.status]));
  assert.equal(byGym(nested).okc, 'already sent', 'the second run finds OKC’s day taken');
  assert.equal(byGym(nested).tulsa, 'sent', 'it does Tulsa, which the first hadn’t got to');
  assert.equal(byGym(first).tulsa, 'already sent', 'so the first one leaves Tulsa alone');
  assert.deepEqual(to(sent(gas)), ['ann@example.com', 'tom@example.com'], 'each person once');
});

test('nothing goes out unless daily_email is TRUE and a provider is set: one "Daily email skipped" line per gym per day instead (only when someone would get it)', () => {
  const { gas, post } = world({ daily_email: false });
  join(post, 'Ann', 'okc');
  run(gas, chicago('2027-01-17')); // before Day 1: nobody would get it, so no line
  assert.equal(dailyLog(gas).length, 0);
  run(gas, chicago('2027-01-18'));
  run(gas, chicago('2027-01-18', '03:25'));
  assert.equal(gas.state.fetches.length, 0);
  let lines = dailyLog(gas);
  assert.deepEqual(lines.map((l) => [l.What, l.Detail]), [['Daily email skipped: OKC · 2027-01-18', 'daily_email is FALSE in Settings (1 would have got it)']], 'once a day, and only OKC has someone');
  // Kevin turns it on that morning: the next run catches up.
  setSetting(gas, 'daily_email', true);
  const r = run(gas, chicago('2027-01-18', '07:00'));
  assert.equal(r.okc.status, 'sent');
  assert.equal(sent(gas).length, 1);
  // The other things that stop it, each named.
  const reasons = [
    ['email_provider', 'off', 'email_provider is off'],
    ['email_from', '', 'email_from is blank'],
  ];
  let day = 19;
  for (const [key, value, why] of reasons) {
    const w = world();
    join(w.post, 'Ann', 'okc');
    setSetting(w.gas, key, value);
    run(w.gas, chicago('2027-01-' + day++));
    assert.equal(w.gas.state.fetches.length, 0);
    assert.ok(dailyLog(w.gas)[0].Detail.startsWith(why), dailyLog(w.gas)[0].Detail);
  }
  const noKey = world();
  join(noKey.post, 'Ann', 'okc');
  noKey.gas.state.properties.delete('RES27_EMAIL_API_KEY');
  run(noKey.gas, chicago('2027-01-20'));
  assert.equal(noKey.gas.state.fetches.length, 0);
  assert.match(dailyLog(noKey.gas)[0].Detail, /^no API key \(add RES27_EMAIL_API_KEY in the Apps Script project’s Script Properties\)/);
  lines = dailyLog(gas);
  assert.match(lines[lines.length - 1].What, /^Daily email · OKC · 2027-01-18 · 1 sent/);
});

/* ------------------------------------------------------------------ the providers ---- */

test('Resend: batches of up to 100 (from, to, subject, html, text, reply_to, List-Unsubscribe), with the key as a Bearer token', () => {
  const { gas, post } = world();
  const people = [];
  for (let i = 0; i < 105; i++) people.push(join(post, 'Okc' + i, 'okc'));
  const r = run(gas, chicago('2027-01-18'));
  assert.deepEqual([r.okc.status, r.okc.sent, r.okc.failed], ['sent', 105, 0]);
  const calls = gas.state.fetches.filter((f) => f.url === BATCH);
  assert.deepEqual(calls.map((c) => JSON.parse(c.payload).length), [100, 5]);
  for (const c of calls) {
    assert.deepEqual([c.method, c.contentType, c.headers.Authorization, c.muteHttpExceptions], ['post', 'application/json', 'Bearer ' + KEY, true]);
  }
  const items = sent(gas);
  assert.equal(new Set(items.map((i) => i.to[0])).size, 105, 'everyone once');
  for (const i of items) {
    assert.deepEqual(Object.keys(i).sort(), ['from', 'headers', 'html', 'reply_to', 'subject', 'text', 'to']);
    assert.equal(i.to.length, 1, 'one person per email: nobody sees anyone else’s address');
    assert.match(i.headers['List-Unsubscribe'], /^<https:\/\/koda-crossfit\.github\.io\/resolutions\/\?gym=okc#\/email-off\?u=R[A-Z2-9]{6}&s=[0-9a-f]{24}>$/);
  }
  assert.equal(new Set(items.map((i) => i.headers['List-Unsubscribe'])).size, 105, 'each person their own link');
  assert.match(dailyLog(gas).pop().What, /^Daily email · OKC · 2027-01-18 · 105 sent, 0 failed, 0 overdue$/);
});

test('Brevo: one request per person, 50 at a time through fetchAll, with the api-key header', () => {
  const { gas, post } = world({ email_provider: 'brevo' });
  for (let i = 0; i < 55; i++) join(post, 'Tul' + i, 'tulsa');
  const r = run(gas, chicago('2027-01-18'));
  assert.deepEqual([r.tulsa.sent, r.tulsa.failed], [55, 0]);
  assert.deepEqual(gas.state.fetchAllSizes, [50, 5]);
  assert.equal(gas.state.counters.fetch, 0, 'no one-at-a-time requests');
  const reqs = gas.state.fetches;
  assert.equal(reqs.length, 55);
  for (const q of reqs) {
    assert.deepEqual([q.url, q.method, q.all, q.headers['api-key'], q.muteHttpExceptions], [BREVO, 'post', true, KEY, true]);
    const body = JSON.parse(q.payload);
    assert.deepEqual(body.sender, { name: 'Koda Tulsa Resolutions', email: 'resolutions@example.com' });
    assert.equal(body.to.length, 1);
    assert.match(body.to[0].email, /^tul\d+@example\.com$/);
    assert.match(body.to[0].name, /^Tul\d+ Mailer$/);
    assert.deepEqual(body.replyTo, { email: 'kodaironview@gmail.com' });
    assert.equal(body.subject, 'Day 1 · ' + DAYS[0].title + ' · Koda Resolutions');
    assert.match(body.htmlContent, /background:#141414/, 'Tulsa’s colors');
    assert.match(body.textContent, /Stop these daily emails: /);
    assert.match(body.headers['List-Unsubscribe'], /\?gym=tulsa#\/email-off\?u=/);
  }
});

test('failures are counted and listed on the one Log row, the run fails once those rows are written (so Google emails Kevin), and the API key never shows up in the Log, the console or a reply', () => {
  const { gas, post } = world();
  for (let i = 0; i < 103; i++) join(post, 'Okc' + i, 'okc');
  join(post, 'Tom', 'tulsa');
  // Resend: the second batch fails, and its error message even repeats the key.
  let batch = 0;
  gas.state.fetchResponder = (req) => {
    if (req.url !== BATCH) return undefined;
    batch += 1;
    if (batch === 2) return { code: 500, body: { statusCode: 500, name: 'application_error', message: 'Internal error for ' + KEY } };
    if (batch === 3) throw new Error('Address unavailable: ' + KEY); // Tulsa's: no answer at all
    return undefined;
  };
  gas.setNow(chicago('2027-01-18'));
  // (Tulsa's got no answer, so Tom may have it: unconfirmed, named, never sent again on its own. 11/24 review.)
  assert.throws(() => gas.call('res27DailyEmails'), /^Error: The daily email failed for OKC: 3 of 103 not sent \(the next runs until noon send it to them again; the Log tab lists them\); Tulsa: 1 of 1 got no answer from Resend, so they may have it, and nothing sends it to them again on its own \(check Resend’s log, then node dev\/live\.js email-send tulsa --date=2027-01-18 --yes sends it again; within 24 hours Resend skips anyone that batch already reached\): tom@example\.com\. The other gyms: /);
  const lines = dailyLog(gas);
  const okc = lines.find((l) => /· OKC ·/.test(l.What));
  assert.equal(okc.What, 'Daily email · OKC · 2027-01-18 · 100 sent, 3 failed, 0 overdue · the 3 it failed for are kept: the next run before noon sends it to them');
  assert.match(okc.Detail, /^500 Internal error for \[key\]: okc\d+@example\.com, okc\d+@example\.com, okc\d+@example\.com$/);
  const tulsa = lines.find((l) => /· Tulsa ·/.test(l.What));
  assert.equal(tulsa.What, 'Daily email · Tulsa · 2027-01-18 · 0 sent, 0 failed, 1 unconfirmed, 0 overdue · the 1 unconfirmed got no answer from Resend, so they may have it: check Resend’s log, then email-send tulsa --date=2027-01-18 --yes');
  assert.match(tulsa.Detail, /^unconfirmed, no answer \(Address unavailable: \[key\]\): tom@example\.com$/);
  assert.equal(lines.length, 2, 'one row per gym, none per person');
  assert.equal(gas.rows('Log').filter((l) => l.What === 'Error in the daily email').length, 1, 'and the failed run, after them');

  // Brevo: one person's request is refused, and the rest go.
  const b = world({ email_provider: 'brevo' });
  for (let i = 0; i < 4; i++) join(b.post, 'Tul' + i, 'tulsa');
  b.gas.state.fetchResponder = (req) => (/tul2@/.test(req.payload) ? { code: 401, body: { code: 'unauthorized', message: 'Key not found: ' + KEY } } : undefined);
  b.gas.setNow(chicago('2027-01-18'));
  assert.throws(() => b.gas.call('res27DailyEmails'), /The daily email failed for Tulsa: 1 of 4 not sent/);
  assert.match(dailyLog(b.gas)[0].What, / · 3 sent, 1 failed, 0 overdue · /);
  assert.equal(dailyLog(b.gas)[0].Detail, '401 Key not found: [key]: tul2@example.com');
  // A hand-run send reports failures too.
  b.gas.setNow(chicago('2027-01-19', '09:00'));
  const hand = b.post({ action: 'adminEmailSend', key: ADMIN, gym: 'tulsa', dryRun: false });
  assert.deepEqual([hand.ok, hand.sent, hand.failed], [true, 3, 1]);
  assert.deepEqual(hand.failures, [{ email: 'tul2@example.com', error: '401 Key not found: [key]' }]);

  for (const w of [gas, b.gas]) {
    const everything = JSON.stringify(w.rows('Log')) + JSON.stringify(w.state.logs) + JSON.stringify(w.rows('Settings'));
    assert.ok(!everything.includes(KEY), 'the key is nowhere on the sheet or in the console');
  }
  assert.ok(!JSON.stringify(hand).includes(KEY), 'nor in a reply');
  assert.ok(gas.state.fetches.every((f) => f.url !== BATCH || f.headers.Authorization === 'Bearer ' + KEY), '(it is sent to the provider, in the header)');
});

/* ------------------------------------------------------------------ stop the emails ---- */

test('emailOff: the link’s signature turns the daily email off (logged); a bad or unknown one gets the same answer; rate-limited; the Profile turns it back on', () => {
  const { gas, post } = world();
  const ann = join(post, 'Ann', 'okc');
  join(post, 'Bea', 'okc');
  run(gas, chicago('2027-01-18'));
  const link = sent(gas).find((i) => i.to[0] === 'ann@example.com').headers['List-Unsubscribe'];
  const [, u, s] = /\?u=(R[A-Z2-9]{6})&s=([0-9a-f]{24})>$/.exec(link);
  assert.equal(u, ann.me.person.id);
  // s is the first 24 hex of HMAC-SHA256(RES27_SECRET, 'email-off:' + id).
  assert.equal(s, crypto.createHmac('sha256', gas.state.properties.get('RES27_SECRET')).update('email-off:' + u).digest('hex').slice(0, 24));

  const bad = { ok: false, error: 'That link didn’t work. You can turn the daily emails off in your Profile instead.', code: 'bad_link' };
  const flip = s.slice(0, -1) + (s.slice(-1) === '0' ? '1' : '0');
  const bea = gas.rows('Participants').find((p) => p.Email === 'bea@example.com').ID;
  for (const body of [{ u, s: flip }, { u: 'RZZZZZZ', s }, { u: 'RZZZZZZ', s: gas.run((ctx) => ctx.res27EmailOffSig_('RZZZZZZ')) }, { u: bea, s }, { u }, {}, { u: u.toLowerCase(), s }]) {
    assert.deepEqual(post(Object.assign({ action: 'emailOff' }, body)), bad, JSON.stringify(body));
  }
  assert.equal(gas.rows('Participants').find((p) => p.Email === 'ann@example.com')['Daily Email'], 'On');
  assert.deepEqual(post({ action: 'emailOff', u, s }), { ok: true, first: 'Ann' });
  assert.equal(gas.rows('Participants').find((p) => p.Email === 'ann@example.com')['Daily Email'], 'Off');
  assert.deepEqual(post({ action: 'emailOff', u, s: s.toUpperCase() }), { ok: true, first: 'Ann' }, 'again (any case): still fine');
  const offs = gas.rows('Log').filter((l) => l.What === 'Daily email');
  assert.deepEqual(offs.map((l) => [l.Who, l.Detail]), [['ann@example.com', 'On → Off (the link in the email)']], 'logged once');
  assert.equal(post({ action: 'me', token: ann.token }).me.person.dailyEmail, false);
  let mark = gas.state.fetches.length;
  run(gas, chicago('2027-01-19'));
  assert.deepEqual(to(sent(gas, mark)), ['bea@example.com']);
  assert.equal(post({ action: 'setup', token: ann.token, dailyEmail: true }).me.person.dailyEmail, true);
  mark = gas.state.fetches.length;
  run(gas, chicago('2027-01-20'));
  assert.deepEqual(to(sent(gas, mark)), ['ann@example.com', 'bea@example.com']);
  // 120 an hour for the whole app, right or wrong.
  gas.setNow(chicago('2027-01-20', '15:00'));
  let busy = 0;
  for (let i = 0; i < 125; i++) if (post({ action: 'emailOff', u, s: flip }).code === 'busy') busy += 1;
  assert.equal(busy, 5);
  assert.equal(post({ action: 'emailOff', u, s }).code, 'busy', 'even a good link waits');
  gas.setNow(chicago('2027-01-20', '16:01'));
  assert.equal(post({ action: 'emailOff', u, s }).ok, true, 'the next hour');
});

/* ------------------------------------------------------------------ admin ---- */

test('adminEmailTriggers: one trigger every hour (each gym’s email goes on the first run past email_hour in its own zone); on again replaces it, and the old per-zone daily ones; off removes only these', () => {
  const { gas, post } = world({ daily_email: false });
  gas.run((ctx) => ctx.ScriptApp.newTrigger('sim1025Reminders').timeBased().everyMinutes(30).create()); // another page's trigger
  // One the first 1.8.0 build would have made (a daily trigger per time zone).
  gas.run((ctx) => ctx.ScriptApp.newTrigger('res27DailyEmails').timeBased().everyDays(1).atHour(3).nearMinute(15).inTimezone('America/Chicago').create());
  assert.equal(post({ action: 'adminEmailTriggers', key: 'nope-nope', on: true }).code, 'forbidden');
  let out = post({ action: 'adminEmailTriggers', key: ADMIN, on: true });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual([out.on, out.triggers.map((t) => t.every), out.hour, out.zones], [true, ['hour'], 3, ['America/Denver', 'America/Chicago']]);
  assert.equal(out.note, 'The triggers are on, but nothing goes out until this is fixed: daily_email is FALSE in Settings.');
  const mine = () => gas.state.triggers.filter((t) => t.handler === 'res27DailyEmails').map((t) => ({ kind: t.kind, everyHours: t.everyHours, everyDays: t.everyDays, atHour: t.atHour, timeZone: t.timeZone }));
  assert.deepEqual(mine(), [{ kind: 'time', everyHours: 1, everyDays: 0, atHour: null, timeZone: '' }], 'the old daily one is gone');
  // A new email_hour needs nothing here: the same hourly trigger, and the runs go by the new hour.
  setSetting(gas, 'email_hour', 5);
  setSetting(gas, 'daily_email', true);
  out = post({ action: 'adminEmailTriggers', key: ADMIN, on: true });
  assert.deepEqual(mine().map((t) => t.everyHours), [1], 'replaced, not added');
  assert.equal(out.note, undefined);
  assert.deepEqual(post({ action: 'adminEmailTriggers', key: ADMIN }).triggers.map((t) => t.every), ['hour'], 'listing it');
  assert.equal(post({ action: 'adminSummary', key: ADMIN }).email.triggers, 1);
  join(post, 'Ann', 'okc');
  assert.equal(run(gas, chicago('2027-01-18', '04:40')).okc.status, 'not due', 'before 5 in Oklahoma');
  assert.equal(run(gas, chicago('2027-01-18', '05:40')).okc.status, 'sent');
  out = post({ action: 'adminEmailTriggers', key: ADMIN, on: false });
  assert.deepEqual([out.on, out.triggers], [false, []]);
  assert.deepEqual(gas.state.triggers.map((t) => t.handler), ['sim1025Reminders'], 'the other page’s trigger stays');
  const logged = gas.rows('Log').filter((l) => /^Daily email triggers/.test(l.What));
  assert.equal(logged.length, 3);
  assert.equal(logged[1].Detail, 'every hour: each gym’s goes out after 5:00 in its own time zone (America/Denver, America/Chicago)');
  // res27AuthorizeEmail (run once in the editor) sends nothing.
  const fetched = gas.state.fetches.length;
  assert.match(gas.call('res27AuthorizeEmail'), /^Email permissions are on/);
  assert.equal(gas.state.fetches.length, fetched);
});

test('adminEmailPreview and adminEmailSend: a person’s email or the common one, a dry run of who gets what, a real send that marks the day (again only with force)', () => {
  const { gas, post } = world();
  join(post, 'Ann', 'okc'); // nothing logged: overdue on Wednesday
  const bea = join(post, 'Bea', 'okc');
  join(post, 'Tom', 'tulsa');
  saveDay(gas, post, bea.token, '2027-01-18', { video: 1 });
  gas.setNow(chicago('2027-01-20', '01:00')); // before the 3 AM run
  const p = post({ action: 'adminEmailPreview', key: ADMIN, gym: 'OKC', email: 'ann@example.com' });
  assert.equal(p.ok, true, p.error);
  assert.deepEqual([p.gym, p.date, p.recipients, p.overdue, p.person], ['okc', '2027-01-20', 2, 1, { email: 'ann@example.com', gets: true, overdue: true, why: '' }]);
  assert.equal(p.subject, 'Day 3 · ' + DAYS[2].title + ' · Koda Resolutions');
  assert.match(p.html, /You haven’t logged Monday, January 18/);
  const common = post({ action: 'adminEmailPreview', key: ADMIN, gym: 'okc' });
  assert.ok(!/You haven’t logged/.test(common.html) && /#\/email-off\?u=PREVIEW&amp;s=/.test(common.html), 'the common one, with a stop link that does nothing');
  assert.equal(post({ action: 'emailOff', u: 'PREVIEW', s: /u=PREVIEW&amp;s=([0-9a-f]{24})/.exec(common.html)[1] }).code, 'bad_link');
  assert.equal(post({ action: 'adminEmailPreview', key: ADMIN, gym: 'okc', email: 'tom@example.com' }).person.why, 'they’re at Tulsa, not OKC');
  const early = post({ action: 'adminEmailPreview', key: ADMIN, gym: 'okc', date: '2027-01-10' });
  assert.deepEqual([early.html, early.recipients], ['', 0]);
  assert.match(early.note, /^No daily email on 2027-01-10/);
  const ahead = post({ action: 'adminEmailPreview', key: ADMIN, gym: 'native', date: '2027-01-18' });
  assert.equal(ahead.recipients, 0);
  assert.match(ahead.html, /Koda Native/, 'a gym with nobody yet still shows what its email will look like');
  assert.equal(post({ action: 'adminEmailPreview', key: ADMIN, gym: 'okc', date: '01/20' }).ok, false);
  assert.equal(post({ action: 'adminEmailPreview', key: ADMIN, gym: 'nowhere' }).code, 'gym');

  const dry = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc' });
  assert.deepEqual([dry.dryRun, dry.count, dry.overdue, dry.problem], [true, 2, 1, '']);
  assert.deepEqual(dry.recipients.map((x) => [x.email, x.overdue]), [['ann@example.com', true], ['bea@example.com', false]]);
  assert.equal(gas.state.fetches.length, 0, 'a dry run sends nothing');
  const real = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', dryRun: false });
  assert.deepEqual([real.ok, real.sent, real.failed], [true, 2, 0]);
  assert.equal(gas.state.properties.get('RES27_DAILY_okc'), '2027-01-20', 'today’s is marked, so 3 AM won’t send it again');
  assert.match(dailyLog(gas).pop().What, /^Daily email · OKC · 2027-01-20 · 2 sent, 0 failed, 1 overdue · sent by hand$/);
  const again = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', dryRun: false });
  assert.deepEqual([again.ok, again.code], [false, 'already_sent']);
  assert.equal(post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', dryRun: false, force: true }).sent, 2);
  const r = run(gas, chicago('2027-01-20'));
  assert.deepEqual([r.okc.status, r.tulsa.status], ['already sent', 'sent']);
  assert.equal(sent(gas).filter((i) => i.to[0] === 'ann@example.com').length, 2, 'the forced one and the first, not a third');
  // Another day's, by hand (a resend of yesterday): everyone got it then, so only with force; sent,
  // and today's mark is left alone.
  const yesterday = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', date: '2027-01-19', dryRun: false });
  assert.deepEqual([yesterday.ok, yesterday.code], [false, 'past']);
  assert.match(yesterday.error, /^OKC’s email for 2027-01-19 is an earlier day’s: everyone who got it then would get it again\. To send it anyway, add force: true \(live\.js: --force\)\.$/);
  assert.equal(post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', date: '2027-01-19', dryRun: false, force: true }).sent, 2);
  assert.equal(gas.state.properties.get('RES27_DAILY_okc'), '2027-01-20');
  setSetting(gas, 'email_provider', 'off');
  assert.deepEqual(post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', dryRun: false, force: true }), { ok: false, error: 'Nothing was sent: email_provider is off.', code: 'no_provider' });
  assert.equal(post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc' }).problem, 'email_provider is off', 'the dry run says so too');
});

test('with a provider set, the other emails (welcome, codes, questions) go through it too; Gmail is the fallback when it fails (logged once an hour)', () => {
  const { gas, post } = world({ welcome_email: true }, '2026-12-01T10:00:00-07:00');
  const r = join(post, 'Ann', 'okc');
  assert.equal(r.emailed, true);
  assert.equal(gas.state.mail.length, 0, 'not through Gmail');
  const one = gas.state.fetches.filter((f) => f.url === 'https://api.resend.com/emails');
  assert.equal(one.length, 1);
  const body = JSON.parse(one[0].payload);
  assert.deepEqual([body.from, body.to, body.subject, body.reply_to], ['Koda OKC Resolutions <resolutions@example.com>', ['ann@example.com'], 'You’re in: Koda Resolutions 2027', 'kodaironview@gmail.com']);
  assert.match(body.html, /Koda OKC/);
  assert.equal(one[0].headers.Authorization, 'Bearer ' + KEY);
  // The provider is down: Gmail sends it, and the Log says so once.
  gas.state.fetchResponder = () => ({ code: 503, body: { message: 'Service unavailable' } });
  join(post, 'Bea', 'okc');
  join(post, 'Cal', 'okc');
  assert.deepEqual(gas.state.mail.map((m) => m.to), ['bea@example.com', 'cal@example.com']);
  const fails = gas.rows('Log').filter((l) => l.What === 'Email provider failed');
  assert.deepEqual(fails.map((l) => l.Detail), ['resend: 503 Service unavailable · sending with Gmail instead']);
  assert.equal(gas.rows('Log').filter((l) => l.What === 'Email not sent').length, 0);
  // Brevo: one request (not fetchAll).
  const b = world({ welcome_email: true, email_provider: 'brevo' }, '2026-12-01T10:00:00-07:00');
  join(b.post, 'Dee', 'tulsa');
  assert.deepEqual([b.gas.state.counters.fetch, b.gas.state.counters.fetchAll, b.gas.state.mail.length], [1, 0, 0]);
  const req = b.gas.state.fetches[0];
  assert.deepEqual([req.url, req.headers['api-key'], JSON.parse(req.payload).to], [BREVO, KEY, [{ email: 'dee@example.com' }]]);
  // mailapp (tests only) and off: Gmail, as before.
  const m = world({ welcome_email: true, email_provider: 'mailapp' }, '2026-12-01T10:00:00-07:00');
  join(m.post, 'Eve', 'ironview');
  assert.deepEqual([m.gas.state.fetches.length, m.gas.state.mail.length], [0, 1]);
});

test('one read of the sheet: a run reads Participants and App Data the same number of times for 3 people or 30', () => {
  const reads = (n) => {
    const { gas, post } = world();
    for (let i = 0; i < n; i++) join(post, 'Okc' + i, 'okc');
    gas.setNow(chicago('2027-01-18'));
    gas.state.counters.readCalls = {};
    gas.state.counters.sheetReads = 0;
    const out = gas.call('res27DailyEmails');
    assert.equal(out.gyms.find((g) => g.gym === 'okc').sent, n);
    return gas.state.counters.readCalls;
  };
  const few = reads(3);
  const many = reads(30);
  assert.deepEqual(many, few);
  assert.ok((few['Participants.getValues'] || 0) <= 3, JSON.stringify(few));
});

test('one gym’s trouble doesn’t stop the others: the run still fails (logged, so Google tells Kevin), and a later run that morning catches that gym up', () => {
  const { gas, post } = world();
  join(post, 'Ann', 'okc');
  join(post, 'Tom', 'tulsa');
  // While OKC's emails go out, something else holds the script lock for longer than the 30 seconds Tulsa waits.
  gas.state.fetchResponder = (req) => {
    if (/ann@example\.com/.test(req.payload)) gas.state.lockBusy = true;
    return undefined;
  };
  gas.setNow(chicago('2027-01-20'));
  assert.throws(() => gas.call('res27DailyEmails'), /The daily email failed for Tulsa: Lock timeout/);
  assert.deepEqual(to(sent(gas)), ['ann@example.com']);
  const err = gas.rows('Log').filter((l) => l.What === 'Error in the daily email');
  assert.equal(err.length, 1);
  assert.match(err[0].Detail, /"gym":"okc","date":"2027-01-20","status":"sent"/);
  assert.equal(gas.state.properties.get('RES27_DAILY_tulsa'), undefined, 'Tulsa’s day wasn’t taken, so it can still go');
  gas.state.lockBusy = false;
  gas.state.fetchResponder = null;
  const r = run(gas, denver('2027-01-20')); // the Denver trigger, 4:10 AM in Chicago
  assert.deepEqual([r.okc.status, r.tulsa.status], ['already sent', 'sent']);
  assert.deepEqual(to(sent(gas)), ['ann@example.com', 'tom@example.com']);
});

/* ------------------------------------------------------------------ the 11/23 review ---- */

test('a send that fails goes again: none of it out gives the day back for the next run; some out, and the next run (or email-send --yes) sends to just the ones it failed for; nobody gets a day twice', () => {
  const { gas, post } = world();
  for (let i = 0; i < 103; i++) join(post, 'Okc' + i, 'okc');
  join(post, 'Tom', 'tulsa');
  // What Resend took, so "nobody twice" can be checked; fail(n) turns down the nth batch request.
  const took = [];
  let calls = 0;
  const resend = (fail) => (req) => {
    if (req.url !== BATCH) return undefined;
    calls += 1;
    const no = fail(calls);
    if (no) return no;
    JSON.parse(req.payload).forEach((i) => took.push(i.subject + ' | ' + i.to[0]));
    return undefined;
  };
  // Tuesday 3:10 AM: OKC's second batch (3 people) fails, and Resend is down for Tulsa's.
  gas.state.fetchResponder = resend((n) => (n === 2 ? { code: 500, body: { message: 'Internal error' } } : n === 3 ? { code: 503, body: { message: 'Service unavailable' } } : null));
  gas.setNow(chicago('2027-01-19'));
  assert.throws(() => gas.call('res27DailyEmails'), /The daily email failed for OKC: 3 of 103 not sent .*; Tulsa: 1 of 1 not sent \(nothing went out, so the next run sends it again/);
  const failedTo = JSON.parse(gas.state.fetches.filter((f) => f.url === BATCH)[1].payload).map((i) => i.to[0]).sort();
  assert.equal(failedTo.length, 3);
  assert.equal(gas.state.properties.get('RES27_DAILY_okc'), '2027-01-19', 'OKC’s day stays marked: 100 have it');
  assert.equal(gas.state.properties.get('RES27_DAILY_tulsa'), undefined, 'Tulsa’s is given back: nobody has it');
  // (Tulsa's day keeps Tom on its list too, so a send by hand on a later day still reaches him.)
  const email = post({ action: 'adminSummary', key: ADMIN }).email;
  assert.deepEqual([email.lastSent.okc, email.lastSent.tulsa, email.retry], ['2027-01-19', '', { okc: [{ date: '2027-01-19', count: 3, unconfirmed: 0 }], tulsa: [{ date: '2027-01-19', count: 1, unconfirmed: 0 }] }]);
  // The dry run says who's waiting, and that a real send would go to just them.
  const dry = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc' });
  assert.deepEqual([dry.count, dry.retry, dry.retryRecipients.slice().sort(), dry.send, dry.alreadySent], [103, 3, failedTo, 'retry', true]);

  // 4:10 AM, Resend is fine again: the next run sends to those 3 and to Tom, and nobody else.
  gas.state.fetchResponder = resend(() => null);
  let mark = gas.state.fetches.length;
  let r = run(gas, chicago('2027-01-19', '04:10'));
  assert.deepEqual([r.okc.status, r.okc.sent, r.okc.failed, r.tulsa.status, r.tulsa.sent], ['retried', 3, 0, 'sent', 1]);
  assert.deepEqual(to(sent(gas, mark)), failedTo.concat(['tom@example.com']).sort());
  assert.equal(gas.state.properties.get('RES27_DAILY_RETRY_okc_2027-01-19'), undefined);
  assert.equal(gas.state.properties.get('RES27_DAILY_RETRY_tulsa_2027-01-19'), undefined, 'the run that sent Tulsa’s to everyone took its list');
  assert.ok(dailyLog(gas).some((l) => l.What === 'Daily email · OKC · 2027-01-19 · 3 sent, 0 failed, 0 overdue · sent again to the ones it failed for'));
  mark = gas.state.fetches.length;
  r = run(gas, chicago('2027-01-19', '05:10'));
  assert.deepEqual([r.okc.status, r.tulsa.status, gas.state.fetches.length], ['already sent', 'already sent', mark]);

  // Wednesday the same 3 fail again, and Kevin sends it by hand before the next run: just them.
  calls = 0;
  gas.state.fetchResponder = resend((n) => (n === 2 ? { code: 500, body: { message: 'Internal error' } } : null));
  gas.setNow(chicago('2027-01-20'));
  assert.throws(() => gas.call('res27DailyEmails'), /OKC: 3 of 103 not sent/);
  gas.setNow(chicago('2027-01-20', '03:40'));
  gas.state.fetchResponder = resend(() => null);
  mark = gas.state.fetches.length;
  const hand = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', dryRun: false });
  assert.deepEqual([hand.ok, hand.send, hand.sent, hand.failed], [true, 'retry', 3, 0]);
  assert.deepEqual(to(sent(gas, mark)), failedTo);
  assert.equal(run(gas, chicago('2027-01-20', '04:10')).okc.status, 'already sent', 'nobody left for the run');
  const again = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', dryRun: false });
  assert.deepEqual([again.ok, again.code], [false, 'already_sent']);
  assert.match(again.error, /has already gone out, and nobody is waiting for it to be sent again/);
  assert.equal(took.length, 2 * 103 + 2, 'two days for 103 at OKC, two for Tom');
  assert.equal(new Set(took).size, took.length, 'nobody got a day twice');
  // Thursday the first run is at 11:10 (Google skipped the others), and Tom's fails: no run after
  // it sends today's, so the alarm says to send it by hand, with the day in the command.
  gas.state.fetchResponder = (req) => (req.url === BATCH && /tom@example\.com/.test(req.payload) ? { code: 503, body: { message: 'Service unavailable' } } : undefined);
  gas.setNow(chicago('2027-01-21', '11:10'));
  assert.throws(() => gas.call('res27DailyEmails'), /Tulsa: 1 of 1 not sent \(that was the last run before noon, so send it by hand: node dev\/live\.js email-send tulsa --date=2027-01-21 --yes sends it to everyone; the Log tab lists them\)/);
  assert.equal(dailyLog(gas).pop().What, 'Daily email · Tulsa · 2027-01-21 · 0 sent, 1 failed, 1 overdue · nothing went out: send it by hand (email-send tulsa --date=2027-01-21 --yes)');
});

test('email-send by hand: a later day is refused, even with force (that morning’s run sends it); one address (email) gets any day’s email, and nothing is marked', () => {
  const { gas, post } = world();
  join(post, 'Ann', 'okc'); // nothing logged: overdue on Wednesday
  join(post, 'Bea', 'okc');
  gas.setNow(chicago('2027-01-19', '22:00')); // the evening before Day 3
  const dry = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', date: '2027-01-20' });
  assert.deepEqual([dry.when, dry.today, dry.count, dry.send, dry.code], ['future', '2027-01-19', 2, '', 'future']);
  assert.match(dry.refused, /^That day hasn’t come yet: OKC’s email for 2027-01-20 goes out that morning, with the hourly run\. To try it before then, send it to one address/);
  for (const force of [false, true]) {
    const r = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', date: '2027-01-20', dryRun: false, force });
    assert.deepEqual([r.ok, r.code], [false, 'future'], 'force: ' + force);
  }
  assert.equal(gas.state.fetches.length, 0);
  // One address: Ann's own Day 3 email (her Overdue box too), now, and nothing is marked or kept.
  const look = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', date: '2027-01-20', email: 'ann@example.com' });
  assert.deepEqual([look.dryRun, look.send, look.recipients.map((x) => x.email), gas.state.fetches.length], [true, 'one', ['ann@example.com'], 0]);
  const one = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', date: '2027-01-20', email: 'ANN@example.com', dryRun: false });
  assert.equal(one.ok, true, one.error);
  assert.deepEqual([one.send, one.sent, one.failed, one.to], ['one', 1, 0, { email: 'ann@example.com', onList: true, overdue: true, why: '' }]);
  assert.deepEqual(to(sent(gas)), ['ann@example.com']);
  assert.match(sent(gas)[0].html, /You haven’t logged Monday, January 18/);
  assert.equal(gas.state.properties.get('RES27_DAILY_okc'), undefined, 'not marked');
  assert.equal(dailyLog(gas).pop().What, 'Daily email · OKC · 2027-01-20 · 1 sent, 0 failed, 1 overdue · sent by hand to ann@example.com only');
  // That morning's run still sends it to both.
  let mark = gas.state.fetches.length;
  run(gas, chicago('2027-01-20'));
  assert.deepEqual(to(sent(gas, mark)), ['ann@example.com', 'bea@example.com']);
  // An address that isn't on the list (Kevin's own inbox), weeks ahead: the gym's common email, whose stop link does nothing.
  gas.setNow('2026-12-01T10:00:00-07:00');
  mark = gas.state.fetches.length;
  const sample = post({ action: 'adminEmailSend', key: ADMIN, gym: 'tulsa', date: '2027-01-25', email: 'kevin.inbox@example.com', dryRun: false });
  assert.deepEqual([sample.ok, sample.sent, sample.to.onList, sample.to.why], [true, 1, false, 'nobody on Participants has that email']);
  const item = sent(gas, mark)[0];
  assert.deepEqual([item.to[0], item.from, item.subject], ['kevin.inbox@example.com', 'Koda Tulsa Resolutions <resolutions@example.com>', 'Day 8 · ' + DAYS[7].title + ' · Koda Resolutions']);
  assert.match(item.headers['List-Unsubscribe'], /#\/email-off\?u=PREVIEW&s=/);
  assert.equal(gas.state.properties.get('RES27_DAILY_tulsa'), undefined);
  // No email that day at all (before Day 1), or an address that isn't one: refused.
  assert.equal(post({ action: 'adminEmailSend', key: ADMIN, gym: 'tulsa', email: 'kevin.inbox@example.com', dryRun: false }).code, 'no_email');
  assert.equal(post({ action: 'adminEmailSend', key: ADMIN, gym: 'tulsa', date: '2027-01-25', email: 'kevin@inbox', dryRun: false }).error, 'That email isn’t valid.');
});

test('Resend batches are permissive: an address Resend turns down doesn’t stop the rest of its gym, and only that one counts as failed', () => {
  const { gas, post } = world();
  for (let i = 0; i < 5; i++) join(post, 'Okc' + i, 'okc');
  // Resend turns down one of the five, as it would a mistyped address.
  gas.state.fetchResponder = (req) => {
    if (req.url !== BATCH) return undefined;
    const items = JSON.parse(req.payload);
    const at = items.findIndex((i) => i.to[0] === 'okc2@example.com');
    return { code: 200, body: { data: items.filter((x, k) => k !== at).map(() => ({ id: crypto.randomUUID() })), errors: [{ index: at, message: 'Invalid `to` field.' }] } };
  };
  gas.setNow(chicago('2027-01-18'));
  assert.throws(() => gas.call('res27DailyEmails'), /The daily email failed for OKC: 1 of 5 not sent/);
  assert.equal(gas.state.fetches.find((f) => f.url === BATCH).headers['x-batch-validation'], 'permissive');
  const line = dailyLog(gas)[0];
  assert.equal(line.What, 'Daily email · OKC · 2027-01-18 · 4 sent, 1 failed, 0 overdue · the 1 it failed for are kept: the next run before noon sends it to them');
  assert.equal(line.Detail, 'refused: Invalid `to` field.: okc2@example.com');
  assert.equal(JSON.parse(gas.state.properties.get('RES27_DAILY_RETRY_okc_2027-01-18')).ids.length, 1);

  // What the header changes (the mock answers as Resend does): without it one bad address turns
  // the whole batch down; with it the rest go, and the bad one is the only failure.
  gas.state.fetchResponder = null;
  const out = gas.run((ctx) => {
    const m = (address, id) => ({ to: address, id, subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', replyTo: 'kodaironview@gmail.com', fromName: 'Koda OKC Resolutions', unsubscribe: 'https://example.com/off' });
    const messages = [m('one@example.com', 'R1'), m('jess@gmail.com.', 'R2'), m('three@example.com', 'R3')];
    const strict = ctx.UrlFetchApp.fetch(BATCH, { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + KEY }, muteHttpExceptions: true,
      payload: JSON.stringify(messages.map((x) => ({ from: 'Koda OKC Resolutions <resolutions@example.com>', to: [x.to], subject: x.subject, html: x.html }))) });
    const r = ctx.res27DeliverDaily_(ctx.res27Settings_(), messages, Date.now());
    return JSON.parse(JSON.stringify({ strict: strict.getResponseCode(), sent: r.sent, failed: r.failed, failedIds: r.failedIds, failures: r.failures }));
  });
  assert.equal(out.strict, 422, 'strict: the whole batch');
  assert.deepEqual([out.sent, out.failed, out.failedIds], [2, 1, ['R2']]);
  assert.match(out.failures[0].error, /^refused: Invalid `to` field/);
});

test('a gym Name with a comma goes in quotes in From (unquoted it reads as two addresses, and Resend would turn down that gym’s emails); a Contact Email typo isn’t used as the reply-to', () => {
  const { gas, post } = world({ welcome_email: true });
  setGymCell(gas, 'okc', 'Name', 'Koda OKC, Oklahoma City');
  setGymCell(gas, 'okc', 'Contact Email', 'hello@okc'); // no .com
  join(post, 'Ann', 'okc'); // its welcome email goes through Resend
  const welcome = gas.state.fetches.filter((f) => f.url === 'https://api.resend.com/emails').map((f) => JSON.parse(f.payload));
  assert.deepEqual(welcome.map((w) => [w.from, w.reply_to]), [['"Koda OKC, Oklahoma City Resolutions" <resolutions@example.com>', 'kodaironview@gmail.com']]);
  assert.equal(gas.state.mail.length, 0, 'Resend took it: no Gmail fallback');
  const r = run(gas, chicago('2027-01-18'));
  assert.deepEqual([r.okc.status, r.okc.sent, r.okc.failed], ['sent', 1, 0]);
  assert.deepEqual([sent(gas)[0].from, sent(gas)[0].reply_to], ['"Koda OKC, Oklahoma City Resolutions" <resolutions@example.com>', 'kodaironview@gmail.com']);
  // A plain name stays the way Resend's docs show it.
  assert.equal(gas.run((ctx) => ctx.res27FromLine_('Koda Tulsa Resolutions', 'resolutions@example.com')), 'Koda Tulsa Resolutions <resolutions@example.com>');
});

test('sign-up refuses addresses an email service would turn down; one that got in before the stricter check still signs in, and its daily email is skipped rather than fail the gym', () => {
  const { gas, post } = world();
  const base = { action: 'register', gym: 'okc', memberType: 'member', first: 'Nia', last: 'Noel', password: 'secret1', shirt: 'tee', size: 'M', setup: SETUP };
  for (const email of ['jess@gmail.com.', 'jess@gmail.com,', 'jo..hn@gmail.com', 'john@gmail.com>', 'jöhn@gmail.com', 'john@gmail.c0m', 'jess.@gmail.com', '.jess@gmail.com', 'gee@gmail..com', 'a;b@gmail.com', 'a(b)@gmail.com', 'two@@gmail.com', 'x@-gmail.com', 'x@gmail']) {
    const r = post(Object.assign({}, base, { email }));
    assert.deepEqual([r.ok, r.error], [false, 'Please enter a valid email address.'], email);
    assert.equal(post({ action: 'emailStatus', email }).valid, false, email);
  }
  for (const email of ['Casey.Lane@Example.com', 'kevin+test@example.com', "o'neil@sub.example.co", 'a_b-c@x-y.example.org']) {
    const r = post(Object.assign({}, base, { email }));
    assert.equal(r.ok, true, email + ': ' + r.error);
  }
  // An account whose address got in under the old check ("jess@gmail.com."), as 1.7 could have stored it.
  join(post, 'Jess', 'okc');
  setCell(gas, 'jess@example.com', 'Email', 'jess@gmail.com.');
  setAccountEmail(gas, 'jess@example.com', 'jess@gmail.com.');
  assert.equal(post({ action: 'login', email: 'jess@gmail.com.', password: 'secret1' }).ok, true, 'still signs in');
  assert.deepEqual(['valid', 'exists'].map((k) => post({ action: 'emailStatus', email: 'jess@gmail.com.' })[k]), [false, true]);
  assert.equal(post({ action: 'adminEmailPreview', key: ADMIN, gym: 'okc', email: 'jess@gmail.com.', date: '2027-01-18' }).person.why, 'their email address isn’t valid');
  const r = run(gas, chicago('2027-01-18'));
  assert.deepEqual([r.okc.status, r.okc.sent, r.okc.failed], ['sent', 4, 0]);
  assert.ok(!to(sent(gas)).includes('jess@gmail.com.'));
});

test('the Daily Email cell is on only when blank, TRUE or On / Yes / Y / 1: anything else Kevin types stops it, and the summary counts it off', () => {
  const { gas, post } = world();
  const on = { ann: '', bea: 'On', cal: 'yes', dee: 'Y', eve: true, fay: '1' };
  const off = { gus: 'Off (asked 1/20)', hal: 'Unsubscribed', ida: 'No emails', jay: 'Stop emails', kim: 'Opted out', lou: 'none', max: 'Off.', ned: false, oli: '0', pat: 'Off' };
  for (const [name, value] of Object.entries(Object.assign({}, on, off))) {
    join(post, name[0].toUpperCase() + name.slice(1), 'okc');
    setCell(gas, name + '@example.com', 'Daily Email', value);
  }
  run(gas, chicago('2027-01-18'));
  assert.deepEqual(to(sent(gas)), Object.keys(on).map((n) => n + '@example.com'));
  const okc = post({ action: 'adminSummary', key: ADMIN }).gyms.find((g) => g.id === 'okc');
  assert.deepEqual([okc.dailyOn, okc.dailyOff], [6, 10]);
});

/* ------------------------------------------------------------------ the 11/24 review ---- */

test('an address from before the stricter check (11/24 review #1): skipped but named on the day’s Log row (once a day even when nobody else is at that gym), kept out of "daily email on" and listed, and its questions reply to the gym without promising Reply reaches them', () => {
  const { gas, post } = world();
  setGymCell(gas, 'okc', 'Contact Email', 'hello@okc.example.com');
  const ann = join(post, 'Ann', 'okc');
  join(post, 'Bea', 'okc');
  const jess = join(post, 'Jess', 'okc');
  setCell(gas, 'jess@example.com', 'Email', 'jess@gmail.com.'); // as 1.7's looser check let it in
  setAccountEmail(gas, 'jess@example.com', 'jess@gmail.com.');
  let sum = post({ action: 'adminSummary', key: ADMIN });
  const okc = sum.gyms.find((g) => g.id === 'okc');
  assert.deepEqual([okc.people, okc.dailyOn, okc.dailyOff, okc.badEmail], [3, 2, 0, 1], 'she isn’t counted as getting it');
  assert.deepEqual(sum.badEmail, ['Jess Mailer <jess@gmail.com.> (OKC)']);
  let r = run(gas, chicago('2027-01-18'));
  assert.deepEqual([r.okc.status, r.okc.sent, r.okc.failed, r.okc.skipped], ['sent', 2, 0, 1]);
  const line = dailyLog(gas).pop();
  assert.equal(line.What, 'Daily email · OKC · 2027-01-18 · 2 sent, 0 failed, 0 overdue · 1 skipped, address not valid');
  assert.equal(line.Detail, 'skipped, address not valid (fix Email on Participants and Accounts): jess@gmail.com.');
  gas.setNow(chicago('2027-01-19', '01:00'));
  const dry = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc' });
  assert.deepEqual([dry.count, dry.skipped], [2, ['jess@gmail.com.']], 'the dry run names her too');
  // A gym where she'd be the only one: the day still gets one row naming her (it's marked), not one an hour.
  const nia = join(post, 'Nia', 'norman');
  setCell(gas, 'nia@example.com', 'Email', 'nia@gmail.com,');
  r = run(gas, chicago('2027-01-19'));
  assert.deepEqual([r.norman.status, r.norman.sent, r.norman.skipped], ['sent', 0, 1]);
  r = run(gas, chicago('2027-01-19', '04:10'));
  assert.equal(r.norman.status, 'already sent');
  const norman = dailyLog(gas).filter((l) => /· Norman ·/.test(l.What));
  assert.deepEqual(norman.map((l) => [l.What, l.Detail]), [['Daily email · Norman · 2027-01-19 · 0 sent, 0 failed, 0 overdue · 1 skipped, address not valid', 'skipped, address not valid (fix Email on Participants and Accounts): nia@gmail.com,']]);
  sum = post({ action: 'adminSummary', key: ADMIN });
  assert.deepEqual(sum.badEmail, ['Jess Mailer <jess@gmail.com.> (OKC)', 'Nia Mailer <nia@gmail.com,> (Norman)']);
  // Ask: her question still reaches the gym, but replies go to OKC's own contact (not Settings',
  // which is Iron View's), and the email says so instead of "Reply … directly". Ann's replies to Ann.
  const questions = () => gas.state.fetches.filter((f) => f.url === 'https://api.resend.com/emails').map((f) => JSON.parse(f.payload)).filter((p) => /question/.test(p.subject));
  assert.equal(post({ action: 'ask', token: jess.token, question: 'Can I swap my rest day?' }).ok, true);
  const q = questions().pop();
  assert.deepEqual([q.to[0], q.reply_to], ['hello@okc.example.com', 'hello@okc.example.com']);
  assert.ok(!/answer Jess directly/.test(q.html + q.text));
  assert.match(q.html, /Jess’s email address on file \(jess@gmail\.com\.\) isn’t one we can send to, so replies go to Koda OKC, not to Jess\./);
  assert.match(q.text, /\nJess’s email address on file \(jess@gmail\.com\.\) isn’t one we can send to, so replies go to Koda OKC, not to Jess\.$/);
  assert.equal(post({ action: 'ask', token: ann.token, question: 'Is oat milk ok?' }).ok, true);
  const qa = questions().pop();
  assert.deepEqual([qa.reply_to, /Reply to this email to answer Ann directly\./.test(qa.html)], ['ann@example.com', true]);
  assert.ok(nia.ok);
});

test('no answer is unconfirmed (11/24 review #2): a timeout, a 502 or 504 (and Resend’s 409) count as neither sent nor failed; 500, 503 and refusals are failures', () => {
  const { gas } = world();
  const answers = {
    thrown: () => {
      throw new Error('Timeout: ' + BATCH);
    },
    502: { code: 502, body: 'Bad gateway' },
    504: { code: 504, body: 'Gateway timeout' },
    409: { code: 409, body: { name: 'concurrent_idempotent_requests', message: 'Same idempotency key used while original request is still in progress.' } },
    500: { code: 500, body: { message: 'Internal error' } },
    503: { code: 503, body: { message: 'Service unavailable' } },
    422: { code: 422, body: { message: 'Invalid' } },
  };
  const seen = {};
  for (const [name, a] of Object.entries(answers)) {
    gas.state.fetchResponder = () => (typeof a === 'function' ? a() : a);
    seen[name] = gas.run((ctx) => {
      const m = { to: 'one@example.com', id: 'R1', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', replyTo: 'kodaironview@gmail.com', fromName: 'Koda OKC Resolutions', unsubscribe: 'https://example.com/off' };
      const r = ctx.res27DeliverDaily_(ctx.res27Settings_(), [m], Date.now(), { gymId: 'okc', date: '2027-01-20' });
      return [r.sent, r.failed, r.unconfirmed, r.failedIds.length, r.unconfirmedChunks.length];
    });
  }
  assert.deepEqual(seen, { thrown: [0, 0, 1, 0, 1], 502: [0, 0, 1, 0, 1], 504: [0, 0, 1, 0, 1], 409: [0, 0, 1, 0, 1], 500: [0, 1, 0, 1, 0], 503: [0, 1, 0, 1, 0], 422: [0, 1, 0, 1, 0] });
});

test('a batch whose answer is lost (11/24 review #2): its day isn’t given back and nobody on it is sent it again on their own; the Log row and the alarm name them with the command (and --date); each batch has an Idempotency-Key, the same on a resend of that batch, so Resend sends it once', () => {
  const { gas, post } = world();
  for (let i = 0; i < 103; i++) join(post, 'Okc' + i, 'okc');
  join(post, 'Nat', 'native');
  const tom = join(post, 'Tom', 'tulsa');
  // Wednesday 3:10: Resend takes OKC's first batch but the answer never comes back; OKC's second
  // goes; Native's never reaches Resend at all; Tulsa's is taken, and a gateway answers 502.
  let n = 0;
  gas.state.fetchResponder = (req) => {
    if (req.url !== BATCH) return undefined;
    n += 1;
    if (n === 3) throw new Error('Address unavailable: ' + BATCH);
    return n === 1 ? { lost: true } : n === 4 ? { lost: 502 } : undefined;
  };
  gas.setNow(chicago('2027-01-20'));
  let alarm = '';
  try {
    gas.call('res27DailyEmails');
  } catch (e) {
    alarm = e.message;
  }
  assert.match(alarm, /^The daily email failed for OKC: 100 of 103 got no answer from Resend, so they may have it, and nothing sends it to them again on its own \(check Resend’s log, then node dev\/live\.js email-send okc --date=2027-01-20 --yes sends it again; within 24 hours Resend skips anyone that batch already reached\): okc0@example\.com, okc1@example\.com, (okc\d+@example\.com, ){7}okc9@example\.com and 90 more; Native: 1 of 1 got no answer from Resend, .*?email-send native --date=2027-01-20 --yes.*?\): nat@example\.com; Tulsa: 1 of 1 got no answer from Resend, .*?email-send tulsa --date=2027-01-20 --yes.*?\): tom@example\.com\. The other gyms: /);
  const keys = gas.state.fetches.filter((f) => f.url === BATCH).map((f) => f.headers['Idempotency-Key']);
  assert.equal(keys.length, 4);
  assert.ok(keys.every((k) => /^res27\/(okc|native|tulsa)\/2027-01-20\/[0-9a-f]{32}$/.test(k)) && new Set(keys).size === 4, keys.join(' '));
  for (const g of ['okc', 'native', 'tulsa']) assert.equal(gas.state.properties.get('RES27_DAILY_' + g), '2027-01-20', g + '’s day stays marked: they may have it');
  const okcLine = dailyLog(gas).find((l) => /· OKC ·/.test(l.What));
  assert.equal(okcLine.What, 'Daily email · OKC · 2027-01-20 · 3 sent, 0 failed, 100 unconfirmed, 103 overdue · the 100 unconfirmed got no answer from Resend, so they may have it: check Resend’s log, then email-send okc --date=2027-01-20 --yes');
  assert.match(okcLine.Detail, /^unconfirmed, no answer \(Timeout: https:\/\/api\.resend\.com\/emails\/batch\): okc0@example\.com, okc1@example\.com, /);
  assert.equal(dailyLog(gas).find((l) => /· Tulsa ·/.test(l.What)).Detail, 'unconfirmed, no answer (502 502 Gateway error): tom@example.com');
  // The later runs send none of them anything.
  const quiet = gas.state.fetches.length;
  const later = run(gas, chicago('2027-01-20', '04:10'));
  assert.deepEqual([later.okc.status, later.native.status, later.tulsa.status, gas.state.fetches.length], ['already sent', 'already sent', 'already sent', quiet]);
  assert.deepEqual(post({ action: 'adminSummary', key: ADMIN }).email.retry, {
    okc: [{ date: '2027-01-20', count: 0, unconfirmed: 100 }], native: [{ date: '2027-01-20', count: 0, unconfirmed: 1 }], tulsa: [{ date: '2027-01-20', count: 0, unconfirmed: 1 }] });
  const delivered = () => gas.state.delivered.map((d) => d.to);
  assert.equal(delivered().length, 104, 'Resend sent OKC’s 103 and Tom: Nat’s never got there');
  // Kevin does what the alarm says. OKC: the same batch, with its key, so Resend hands back its first
  // answer and sends nothing again; Native: a batch Resend never saw, so it goes out now.
  gas.setNow(chicago('2027-01-20', '08:00'));
  const dry = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', date: '2027-01-20' });
  assert.deepEqual([dry.retry, dry.unconfirmed, dry.unconfirmedRecipients.length, dry.send], [0, 100, 100, 'retry']);
  let mark = gas.state.fetches.length;
  const hand = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', date: '2027-01-20', dryRun: false });
  assert.deepEqual([hand.ok, hand.send, hand.sent, hand.failed, hand.unconfirmed], [true, 'retry', 100, 0, 0]);
  assert.deepEqual(gas.state.fetches.slice(mark).map((f) => [f.headers['Idempotency-Key'], f.replayed === true, JSON.parse(f.payload).length]), [[keys[0], true, 100]]);
  assert.equal(dailyLog(gas).pop().What, 'Daily email · OKC · 2027-01-20 · 100 sent, 0 failed, 100 overdue · sent by hand · sent again to the ones it failed for and the unconfirmed ones');
  mark = gas.state.fetches.length;
  const nat = post({ action: 'adminEmailSend', key: ADMIN, gym: 'native', date: '2027-01-20', dryRun: false });
  assert.deepEqual([nat.sent, gas.state.fetches[mark].headers['Idempotency-Key'], !!gas.state.fetches[mark].replayed], [1, keys[2], false]);
  // Tulsa: Tom logged Monday since, so his email has changed (no Overdue box): Resend won't take that
  // key with other emails (409), and he stays unconfirmed rather than risk a second copy.
  saveDay(gas, post, tom.token, '2027-01-18', { video: 1 });
  const tulsa = post({ action: 'adminEmailSend', key: ADMIN, gym: 'tulsa', date: '2027-01-20', dryRun: false });
  assert.deepEqual([tulsa.sent, tulsa.failed, tulsa.unconfirmed], [0, 0, 1]);
  assert.match(tulsa.unconfirmedTo[0].error, /^409 Same idempotency key used with a different request payload/);
  assert.deepEqual(post({ action: 'adminSummary', key: ADMIN }).email.retry, { tulsa: [{ date: '2027-01-20', count: 0, unconfirmed: 1 }] });
  const counts = {};
  delivered().forEach((e) => (counts[e] = (counts[e] || 0) + 1));
  assert.equal(Object.keys(counts).length, 105);
  assert.ok(Object.values(counts).every((c) => c === 1), 'nobody got Wednesday twice (before the review, the next run sent them all a second copy)');
});

test('each day keeps its own list (11/24 review #3): the next morning’s send leaves the day before’s alone and email-send --date=<that day> --yes reaches just them; the alarm and Log rows give --date, and say to send it by hand when no run is left; a list waits 7 days, and goes once the challenge is over, each drop on the Log', () => {
  const { gas, post } = world();
  for (let i = 0; i < 4; i++) join(post, 'Okc' + i, 'okc');
  assert.equal(post({ action: 'adminEmailTriggers', key: ADMIN, on: true }).on, true);
  let refuse = 'okc1@example.com';
  gas.state.fetchResponder = (req) => {
    if (req.url !== BATCH) return undefined;
    const at = JSON.parse(req.payload).findIndex((i) => i.to[0] === refuse);
    return at >= 0 ? { refuse: [at] } : undefined;
  };
  // Tuesday's only run is at 11:10 (Google skipped the others): okc1 is turned down, no run is left.
  gas.setNow(chicago('2027-01-19', '11:10'));
  assert.throws(() => gas.call('res27DailyEmails'), /OKC: 1 of 4 not sent \(that was the last run before noon, so send it by hand: node dev\/live\.js email-send okc --date=2027-01-19 --yes sends it to them; the Log tab lists them\)/);
  assert.equal(dailyLog(gas).pop().What, 'Daily email · OKC · 2027-01-19 · 3 sent, 1 failed, 0 overdue · the 1 it failed for are kept: send it by hand (email-send okc --date=2027-01-19 --yes)');
  // Wednesday 3:10: that day's email goes, and Tuesday's list stays.
  refuse = '';
  assert.equal(run(gas, chicago('2027-01-20')).okc.status, 'sent');
  assert.deepEqual(post({ action: 'adminSummary', key: ADMIN }).email.retry, { okc: [{ date: '2027-01-19', count: 1, unconfirmed: 0 }] });
  // 7:30, the alarm's command: Tuesday's, to okc1 only.
  gas.setNow(chicago('2027-01-20', '07:30'));
  const mark = gas.state.fetches.length;
  const hand = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', date: '2027-01-19', dryRun: false });
  assert.deepEqual([hand.ok, hand.send, hand.sent, hand.failed, hand.nextRun], [true, 'retry', 1, 0, false]);
  assert.deepEqual(sent(gas, mark).map((i) => [i.to[0], i.subject.slice(0, 6)]), [['okc1@example.com', 'Day 2 ']]);
  assert.deepEqual(post({ action: 'adminSummary', key: ADMIN }).email.retry, {});
  assert.equal(post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', date: '2027-01-19', dryRun: false }).code, 'past', 'nobody is waiting any more');
  // Thursday, by hand: in the morning a failure is left for the next run; in the afternoon there's
  // none left, so it says to send it by hand (11/24 review: it said "the next run before noon").
  refuse = 'okc2@example.com';
  gas.setNow(chicago('2027-01-21', '09:00'));
  const am = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', dryRun: false });
  assert.deepEqual([am.send, am.sent, am.failed, am.nextRun], ['all', 3, 1, true]);
  assert.match(dailyLog(gas).pop().What, /· sent by hand · the 1 it failed for are kept: the next run before noon sends it to them$/);
  gas.setNow(chicago('2027-01-21', '13:00'));
  const pm = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', dryRun: false });
  assert.deepEqual([pm.send, pm.sent, pm.failed, pm.nextRun], ['retry', 0, 1, false]);
  assert.match(dailyLog(gas).pop().What, /· sent by hand · sent again to the ones it failed for · the 1 it failed for are kept: send it by hand \(email-send okc --date=2027-01-21 --yes\)$/);
  // Nobody sends Thursday's: it waits 7 days, then the list goes, and the Log says who never got it.
  refuse = '';
  run(gas, chicago('2027-01-28'));
  assert.deepEqual(post({ action: 'adminSummary', key: ADMIN }).email.retry, { okc: [{ date: '2027-01-21', count: 1, unconfirmed: 0 }] });
  run(gas, chicago('2027-01-29', '00:30')); // (any run, even one with nothing due, looks at the lists)
  let drop = gas.rows('Log').filter((l) => /dropped the list/.test(l.What));
  assert.deepEqual(drop.map((l) => [l.What, l.Detail]), [['Daily email · OKC · 2027-01-21 · dropped the list of 1 waiting for a resend: it waited 7 days and nobody sent it by hand', 'never got it: okc2@example.com']]);
  assert.deepEqual(post({ action: 'adminSummary', key: ADMIN }).email.retry, {});
  // The Monday after the last day: okc3's fails; the next morning the challenge is over, and so is the list.
  refuse = 'okc3@example.com';
  gas.setNow(chicago('2027-03-01'));
  assert.throws(() => gas.call('res27DailyEmails'), /OKC: 1 of 4 not sent/);
  refuse = '';
  run(gas, chicago('2027-03-01', '23:30'));
  assert.equal(gas.rows('Log').filter((l) => /dropped the list/.test(l.What)).length, 1, 'still that day');
  run(gas, chicago('2027-03-02', '00:30'));
  drop = gas.rows('Log').filter((l) => /dropped the list/.test(l.What)).pop();
  assert.deepEqual([drop.What, drop.Detail], ['Daily email · OKC · 2027-03-01 · dropped the list of 1 waiting for a resend: the challenge is over', 'never got it: okc3@example.com']);
  assert.deepEqual(post({ action: 'adminSummary', key: ADMIN }).email.retry, {});
  // A beta's lists go when the beta is over (after the Monday after its last day).
  const over = gas.run((ctx) => {
    const cfg = Object.assign({}, ctx.res27Settings_(), { beta_start: '2026-11-30', beta_days: 7 });
    return [ctx.res27RetryOver_(cfg, '2026-12-03', '2026-12-07'), ctx.res27RetryOver_(cfg, '2026-12-07', '2026-12-08'), ctx.res27RetryOver_(cfg, '2026-11-20', '2026-12-01')];
  });
  assert.deepEqual(over, ['', 'the beta is over', 'that day isn’t part of the challenge or a beta any more']);
  const got = gas.state.delivered.map((d) => d.to + ' ' + d.subject);
  assert.equal(new Set(got).size, got.length, 'nobody got the same day twice');
});

test('a forced send by hand while a run’s send is failing (11/24 review #4): the run doesn’t give back the day the forced send claimed, so nobody gets it twice; a forced send has new Idempotency-Keys (it is a deliberate second copy)', () => {
  const { gas, post } = world();
  for (let i = 0; i < 4; i++) join(post, 'Okc' + i, 'okc');
  let hand = null;
  let nested = false;
  gas.state.fetchResponder = (req) => {
    if (req.url !== BATCH) return undefined;
    if (!nested) {
      nested = true;
      // While the 3:10 run's request is out, Kevin's email-send okc --yes --force goes through...
      hand = post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', dryRun: false, force: true });
      return { code: 503, body: { message: 'Service unavailable' } }; // ...and then the run's request fails.
    }
    return undefined;
  };
  gas.setNow(chicago('2027-01-19'));
  const out = gas.call('res27DailyEmails');
  assert.deepEqual([hand.ok, hand.sent, hand.failed], [true, 4, 0]);
  const okc = out.gyms.find((g) => g.gym === 'okc');
  assert.deepEqual([okc.sent, okc.failed, okc.superseded], [0, 0, true], 'the forced send covers the run’s misses, so no alarm');
  assert.equal(gas.state.properties.get('RES27_DAILY_okc'), '2027-01-19', 'the forced send’s mark stays');
  assert.equal(dailyLog(gas).pop().What, 'Daily email · OKC · 2027-01-19 · 0 sent, 4 failed, 0 overdue · a forced send by hand went to everyone meanwhile, so nobody is kept for a resend');
  assert.equal(run(gas, chicago('2027-01-19', '04:10')).okc.status, 'already sent');
  assert.deepEqual(gas.state.delivered.map((d) => d.to).sort(), ['okc0@example.com', 'okc1@example.com', 'okc2@example.com', 'okc3@example.com'], 'each once (before the review, the 4:10 run sent them all a second copy)');
  const keys = gas.state.fetches.filter((f) => f.url === BATCH).map((f) => f.headers['Idempotency-Key']);
  assert.match(keys[0], /^res27\/okc\/2027-01-19\/[0-9a-f]{32}$/);
  assert.match(keys[1], /^res27\/okc\/2027-01-19\/again-[0-9a-f]{8}\/[0-9a-f]{32}$/, 'the forced one');
  assert.equal(keys[0].slice(-32), keys[1].slice(-32), 'the same people');
  // --force again: a second copy for everyone, as asked (with the day's own key Resend would send nothing).
  gas.state.fetchResponder = null;
  assert.equal(post({ action: 'adminEmailSend', key: ADMIN, gym: 'okc', dryRun: false, force: true }).sent, 4);
  assert.equal(gas.state.delivered.length, 8);
  // A run whose own claim is still the day's gives it back as before when nothing went out.
  const w = world();
  join(w.post, 'Ann', 'okc');
  w.gas.state.fetchResponder = () => ({ code: 503, body: { message: 'Service unavailable' } });
  w.gas.setNow(chicago('2027-01-19'));
  assert.throws(() => w.gas.call('res27DailyEmails'), /OKC: 1 of 1 not sent \(nothing went out, so the next run sends it again/);
  assert.deepEqual([w.gas.state.properties.get('RES27_DAILY_okc'), w.gas.state.properties.get('RES27_DAILY_CLAIM_okc')], [undefined, undefined]);
});
