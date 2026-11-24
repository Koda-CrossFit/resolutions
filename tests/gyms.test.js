'use strict';

/**
 * Six gyms, one app (Kevin, 11/23/2026): the person's gym picks their colors, coaches, payment
 * details, videos and leaderboards. The Gyms tab holds each gym's details; Iron View's row starts
 * from Settings; everyone from before (a blank Gym cell) is Iron View.   node --test "tests/*.test.js"
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const { createGas } = require('../dev/gas-mock.js');

const ADMIN = 'test-admin-key-123';
const ROOT = path.join(__dirname, '..');
const DAYS = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'days-2027.json'), 'utf8'));
const SETUP = { goal: 'health', track: { nutrition: true, workout: true, sleep: true }, plan: 'recommended', sleepHours: 7, coaches: [] };
const NOW = '2026-11-23T10:00:00-07:00'; // before Day 1 (Jan 18, 2027)

function world(settings, at) {
  const gas = createGas();
  gas.setNow(at || NOW);
  const post = (body) => gas.post(Object.assign({ type: 'res27' }, body));
  const setup = post({ action: 'adminSetup', key: ADMIN, days: DAYS, settings: Object.assign({ welcome_email: false }, settings || {}) });
  assert.equal(setup.ok, true, setup.error);
  return { gas, post, setup };
}

function join(post, first, gym, extra) {
  const r = post(Object.assign({
    action: 'register', gym, memberType: 'member', first, last: 'Gymmer', email: first.toLowerCase() + '@example.com', password: 'secret1',
    shirt: 'tee', size: 'M', setup: SETUP,
  }, extra || {}));
  assert.equal(r.ok, true, r.error);
  return r;
}

/** A cell on the Gyms tab, as Kevin would type it. */
function setGym(gas, id, header, value) {
  const sheet = gas.sheet('Gyms');
  const values = sheet.getDataRange().getValues();
  const head = values[0];
  const row = values.findIndex((r) => r[head.indexOf('Gym')] === id);
  assert.ok(row > 0, 'no Gyms row for ' + id);
  sheet.getRange(row + 1, head.indexOf(header) + 1).setValue(value);
  gas.state.cache.clear();
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

function headers(gas, tab) {
  const sheet = gas.sheet(tab);
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function deleteColumn(gas, tab, header) {
  gas.sheet(tab).deleteColumn(headers(gas, tab).indexOf(header) + 1);
}

/** OKC with payment details and coaches of its own, Tulsa with nothing yet. */
function okcSetUp(gas) {
  setGym(gas, 'okc', 'Venmo', '@koda-okc');
  setGym(gas, 'okc', 'Zelle', 'pay@okc.example.com');
  setGym(gas, 'okc', 'Remote Price', 89);
  setGym(gas, 'okc', 'Coaches', 'Avery, Blake');
  setGym(gas, 'okc', 'Coach Emails', 'Avery: avery.coach@example.com');
  setGym(gas, 'okc', 'Contact Email', 'hello@okc.example.com');
}

/* ------------------------------------------------------------------ names, tab, migration ---- */

test('gym names: the id, the short name or the full name, any case; anything else is no gym; a blank cell is Iron View', () => {
  const { gas, post } = world();
  const ids = gas.run((ctx) => ['okc', 'OKC', 'Koda OKC', ' koda okc ', 'Iron View', 'ironview', 'IRON VIEW', 'Koda Iron View', 'Koda CrossFit Tulsa', 'tulsa', 'Downtown', 'native', 'Koda Norman', '', 'Koda', 'OKCC', 'Austin', null].map(ctx.res27GymId_));
  assert.deepEqual(ids, ['okc', 'okc', 'okc', 'okc', 'ironview', 'ironview', 'ironview', 'ironview', 'tulsa', 'tulsa', 'downtown', 'native', 'norman', '', '', '', '', '']);
  // On Participants: blank is Iron View (everyone before 11/23); a typo counts as Iron View and the summary lists it.
  const ann = join(post, 'Ann', 'ironview');
  join(post, 'Bea', 'okc');
  const cal = join(post, 'Cal', 'tulsa');
  setCell(gas, 'ann@example.com', 'Gym', '');
  setCell(gas, 'cal@example.com', 'Gym', 'Tusla');
  assert.equal(post({ action: 'me', token: ann.token }).me.person.gym, 'ironview');
  assert.equal(post({ action: 'me', token: cal.token }).me.person.gym, 'ironview');
  setCell(gas, 'bea@example.com', 'Gym', 'koda okc');
  const s = post({ action: 'adminSummary', key: ADMIN });
  assert.deepEqual(s.unknownGym, ['Cal Gymmer <cal@example.com> (Gym: Tusla)']);
  assert.equal(s.gyms.find((g) => g.id === 'okc').people, 1, '"koda okc" is OKC');
});

test('setup makes the Gyms tab: six rows, Iron View’s from Settings, the rest name/city/address/time zone only; typed values are never overwritten', () => {
  const { gas, post, setup } = world({ venmo: '@iv-venmo', coach_emails: 'Riley: riley.coach@example.com', card_url: 'https://pay.example.com/iv' });
  assert.equal(setup.gymsSeeded, 6);
  assert.deepEqual(headers(gas, 'Gyms'), ['Gym', 'Name', 'City', 'Address', 'Time Zone', 'Contact Email', 'Coaches', 'Coach Emails', 'Venmo', 'Zelle', 'Card URL', 'Remote Price', 'Notes']);
  const rows = gas.rows('Gyms');
  assert.deepEqual(rows.map((r) => r.Gym), ['ironview', 'okc', 'native', 'norman', 'downtown', 'tulsa']);
  const iv = rows[0];
  assert.deepEqual([iv.Name, iv.City, iv.Address, iv['Time Zone']], ['Koda Iron View', 'Louisville, CO', '740 S Pierce Ave #5, Louisville, CO 80027', 'America/Denver']);
  assert.deepEqual([iv['Contact Email'], iv.Coaches, iv['Coach Emails'], iv.Venmo, iv.Zelle, iv['Card URL'], Number(iv['Remote Price'])],
    ['kodaironview@gmail.com', 'Kevin, Riley, Jamie, Maggie', 'Riley: riley.coach@example.com', '@iv-venmo', 'kodaironview@gmail.com', 'https://pay.example.com/iv', 99], 'the values stored by this same setup');
  const okc = rows[1];
  assert.deepEqual([okc.Name, okc.City, okc.Address, okc['Time Zone']], ['Koda OKC', 'Oklahoma City, OK', '7016 Ozzy Ave, Oklahoma City, OK 73105', 'America/Chicago']);
  for (const r of rows.slice(1)) {
    assert.deepEqual([r['Contact Email'], r.Coaches, r['Coach Emails'], r.Venmo, r.Zelle, r['Card URL'], r['Remote Price']], ['', '', '', '', '', '', ''], r.Gym + ' has no money or coaches of Iron View’s');
  }
  assert.equal(rows.find((r) => r.Gym === 'downtown').Address, '', 'Kevin fills in Downtown’s address');
  assert.ok(rows.slice(1).every((r) => r['Time Zone'] === 'America/Chicago'));

  // Kevin types in OKC's details and changes Iron View's Venmo; setup (it runs on every `setting`) keeps them.
  setGym(gas, 'okc', 'Venmo', '@koda-okc');
  setGym(gas, 'ironview', 'Venmo', '@new-iv');
  gas.sheet('Gyms').deleteRow(rows.find((r) => r.Gym === 'tulsa')._row);
  const again = post({ action: 'adminSetup', key: ADMIN, settings: { venmo: '@settings-only' } });
  assert.equal(again.ok, true, again.error);
  assert.equal(again.gymsSeeded, 1, 'only the missing Tulsa row comes back');
  const after = gas.rows('Gyms');
  assert.equal(after.length, 6);
  assert.equal(after.find((r) => r.Gym === 'okc').Venmo, '@koda-okc');
  assert.equal(after.find((r) => r.Gym === 'ironview').Venmo, '@new-iv', 'Settings no longer reaches a row that’s there');
  assert.equal(post({ action: 'config' }).config.venmo, '@new-iv');
});

test('migration: setup puts Gym right after Type (and after Team on Check-ins), adds Daily Email, fills blank gyms with Iron View and logs how many', () => {
  const { gas, post } = world();
  const ann = join(post, 'Ann', 'ironview');
  join(post, 'Bob', 'ironview');
  gas.setNow('2027-01-19T19:00:00-07:00');
  assert.equal(post({ action: 'save', token: ann.token, date: '2027-01-19', answers: { video: 1 } }).ok, true);
  gas.setNow(NOW);
  // The sheet as 1.7 left it: no Gym or Daily Email on Participants, no Gym on Check-ins.
  deleteColumn(gas, 'Participants', 'Gym');
  deleteColumn(gas, 'Participants', 'Daily Email');
  deleteColumn(gas, 'Check-ins', 'Gym');
  gas.state.cache.clear();
  // Before setup runs, the app still works (the new columns are only written once they exist).
  assert.equal(post({ action: 'me', token: ann.token }).me.person.gym, 'ironview');
  assert.equal(post({ action: 'setup', token: ann.token, dailyEmail: false }).ok, true);
  assert.equal(gas.rows('Log').filter((l) => l.What === 'Daily email').length, 0, 'nothing stored, so nothing logged');

  const out = post({ action: 'adminSetup', key: ADMIN });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.gymsFilled, 2);
  const head = headers(gas, 'Participants');
  assert.equal(head.indexOf('Gym'), head.indexOf('Type') + 1, 'Gym is right after Type');
  assert.equal(head.indexOf('Payment'), head.indexOf('Gym') + 1);
  assert.ok(head.includes('Daily Email'));
  const people = gas.rows('Participants');
  assert.deepEqual(people.map((p) => [p.Email, p.Gym, p['Daily Email']]), [['ann@example.com', 'Iron View', ''], ['bob@example.com', 'Iron View', '']], 'blank Daily Email = on');
  assert.equal(people[0]['Coach Ranking'], 'No preference', 'columns after the new one kept their values');
  const log = gas.rows('Log').filter((l) => l.What === 'Filled blank gyms');
  assert.equal(log.length, 1);
  assert.match(log[0].Detail, /^2 participants with no Gym set to Iron View/);
  const ch = headers(gas, 'Check-ins');
  assert.equal(ch.indexOf('Gym'), ch.indexOf('Team') + 1, 'Check-ins: Gym right after Team');
  assert.equal(gas.rows('Check-ins')[0].Date, '2027-01-19', 'the check-in row kept its cells');

  // Typed gyms stay; only blanks are filled, and a second run with none blank logs nothing.
  setCell(gas, 'bob@example.com', 'Gym', 'OKC');
  setCell(gas, 'ann@example.com', 'Gym', '');
  assert.equal(post({ action: 'adminSetup', key: ADMIN }).gymsFilled, 1);
  assert.deepEqual(gas.rows('Participants').map((p) => p.Gym), ['Iron View', 'OKC']);
  assert.equal(post({ action: 'adminSetup', key: ADMIN }).gymsFilled, 0);
  assert.equal(gas.rows('Log').filter((l) => l.What === 'Filled blank gyms').length, 2);
  const bob = post({ action: 'login', email: 'bob@example.com', password: 'secret1' });
  assert.equal(bob.me.person.gym, 'okc');
  // A new sheet has them in place: ..., Type, Gym, Payment, ... and Daily Email after Welcome Email.
  const fresh = world();
  const h = headers(fresh.gas, 'Participants');
  assert.deepEqual(h.slice(h.indexOf('Type'), h.indexOf('Type') + 3), ['Type', 'Gym', 'Payment']);
  assert.deepEqual(h.slice(-3), ['Welcome Email', 'Daily Email', 'Notes']);
});

/* --------------------------------------------------------------------- config ---- */

test('config.gyms: the six in order with their public details (never coach emails); the old top-level keys are Iron View’s', () => {
  const { gas, post } = world({ coach_emails: 'Riley: riley.coach@example.com' });
  okcSetUp(gas);
  const cfg = post({ action: 'config' }).config;
  assert.deepEqual(cfg.gyms.map((g) => g.id), ['ironview', 'okc', 'native', 'norman', 'downtown', 'tulsa']);
  for (const g of cfg.gyms) assert.deepEqual(Object.keys(g), ['id', 'name', 'short', 'city', 'address', 'coaches', 'venmo', 'zelle', 'cardUrl', 'remotePrice', 'contactEmail']);
  const okc = cfg.gyms[1];
  assert.deepEqual(okc, { id: 'okc', name: 'Koda OKC', short: 'OKC', city: 'Oklahoma City, OK', address: '7016 Ozzy Ave, Oklahoma City, OK 73105', coaches: ['Avery', 'Blake'], venmo: '@koda-okc', zelle: 'pay@okc.example.com', cardUrl: '', remotePrice: 89, contactEmail: 'hello@okc.example.com' });
  const tulsa = cfg.gyms[5];
  assert.deepEqual([tulsa.venmo, tulsa.zelle, tulsa.cardUrl, tulsa.coaches, tulsa.remotePrice, tulsa.contactEmail], ['', '', '', [], 99, 'kodaironview@gmail.com'], 'blank: no payment, no coaches; price and contact from Settings');
  const iv = cfg.gyms[0];
  assert.deepEqual([cfg.venmo, cfg.zelle, cfg.cardUrl, cfg.coaches, cfg.remotePrice, cfg.contactEmail], [iv.venmo, iv.zelle, iv.cardUrl, iv.coaches, iv.remotePrice, iv.contactEmail]);
  assert.equal(cfg.venmo, '@kevin-schuetz-5');
  const text = JSON.stringify(cfg);
  assert.ok(!/coach\.coach@|avery\.coach@|riley\.coach@|coachEmails|Coach Emails/.test(text), 'no coach addresses in the public config');
});

test('assets/content.js has the same six gyms as RES27_GYMS (id, name, short, city, in order)', (t) => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets', 'content.js'), 'utf8'), { window });
  const front = window.RES27_CONTENT && window.RES27_CONTENT.gyms;
  // The app builder adds C.gyms to content.js after this backend change; until then this is a todo.
  if (!Array.isArray(front)) return t.todo('assets/content.js has no gyms list (C.gyms) yet');
  const { gas } = world();
  const back = gas.run((ctx) => JSON.parse(JSON.stringify(ctx.RES27_GYMS)));
  const pick = (g) => ({ id: g.id, name: g.name, short: g.short, city: g.city });
  // content.js ran in its own context, so its arrays have that context's Array: copy into this one
  // (Array.from) before the strict comparison, which also compares prototypes.
  assert.deepEqual(Array.from(front, pick), back.map(pick));
});

/* --------------------------------------------------------------------- sign-up ---- */

test('register needs a gym; writes Gym (short name) and Daily Email On; ranks only that gym’s coaches, and skips ranking at a gym with none', () => {
  const { gas, post } = world();
  okcSetUp(gas);
  const base = { action: 'register', memberType: 'member', first: 'Nia', last: 'Noel', password: 'secret1', shirt: 'tee', size: 'M', setup: Object.assign({}, SETUP, { coaches: ['Blake', 'Kevin', 'Avery'] }) };
  // (No gym key at all is an old cached page's Iron View sign-up: see the next test.)
  for (const gym of ['', 'nowhere', 'Koda', null]) {
    const r = post(Object.assign({}, base, { email: 'nia@example.com', gym }));
    assert.deepEqual([r.ok, r.code, r.error], [false, 'gym', 'Pick your gym.'], String(gym));
  }
  assert.equal(gas.rows('Participants').length, 0, 'nothing written');
  const okc = post(Object.assign({}, base, { email: 'nia@example.com', gym: 'okc' }));
  assert.equal(okc.ok, true, okc.error);
  assert.deepEqual([okc.me.person.gym, okc.me.person.dailyEmail], ['okc', true]);
  assert.deepEqual(okc.me.person.setup.coaches, ['Blake', 'Avery'], 'Kevin coaches at Iron View, not OKC');
  const iv = post(Object.assign({}, base, { email: 'ivy@example.com', gym: 'ironview' }));
  assert.deepEqual(iv.me.person.setup.coaches, ['Kevin']);
  const tulsa = post(Object.assign({}, base, { email: 'tia@example.com', gym: 'Tulsa' }));
  assert.equal(tulsa.ok, true, 'a short name works too');
  assert.deepEqual(tulsa.me.person.setup.coaches, [], 'Tulsa lists no coaches');
  const rows = gas.rows('Participants');
  assert.deepEqual(rows.map((r) => [r.Email, r.Gym, r['Daily Email'], r['Coach Ranking']]), [
    ['nia@example.com', 'OKC', 'On', '1. Blake  2. Avery'],
    ['ivy@example.com', 'Iron View', 'On', '1. Kevin'],
    ['tia@example.com', 'Tulsa', 'On', ''],
  ], 'a gym with no coaches leaves Coach Ranking blank');
  assert.match(gas.rows('Log').find((l) => l.Who === 'nia@example.com').Detail, /· OKC$/);
});

test('a page cached from before the gyms (no gym in the request at all) signs up at Iron View, the only gym it ever showed; until setup adds the Gym column, other gyms wait', () => {
  const { gas, post } = world();
  // The 1.4 page's sign-up: no gym field, an Iron View coach ranking, Iron View's ways to pay.
  const old = post({ action: 'register', memberType: 'remote', payment: 'venmo', first: 'Old', last: 'Page', email: 'old@example.com', password: 'secret1', shirt: 'tee', size: 'M', setup: Object.assign({}, SETUP, { coaches: ['Riley'] }) });
  assert.equal(old.ok, true, old.error);
  assert.deepEqual([old.me.person.gym, old.me.person.setup.coaches], ['ironview', ['Riley']]);
  const row = gas.rows('Participants')[0];
  assert.deepEqual([row.Gym, row.Payment, row['Daily Email']], ['Iron View', 'Venmo', 'On']);
  // A sheet that setup hasn't brought up to the gyms yet (the deploy order slipped): Iron View
  // still signs up, another gym is asked to wait instead of being stored as Iron View.
  deleteColumn(gas, 'Participants', 'Gym');
  gas.state.cache.clear();
  const okc = post({ action: 'register', gym: 'okc', memberType: 'member', first: 'New', last: 'Okc', email: 'newokc@example.com', password: 'secret1', shirt: 'tee', size: 'M', setup: SETUP });
  assert.deepEqual([okc.ok, okc.code, okc.error], [false, 'not_ready', 'We’re still setting up sign-ups for Koda OKC. Please try again in a few minutes.']);
  assert.equal(post({ action: 'register', gym: 'ironview', memberType: 'member', first: 'New', last: 'Iv', email: 'newiv@example.com', password: 'secret1', shirt: 'tee', size: 'M', setup: SETUP }).ok, true);
  assert.equal(post({ action: 'adminSetup', key: ADMIN }).ok, true);
  assert.equal(post({ action: 'register', gym: 'okc', memberType: 'member', first: 'New', last: 'Okc', email: 'newokc@example.com', password: 'secret1', shirt: 'tee', size: 'M', setup: SETUP }).ok, true, 'after setup');
  assert.deepEqual(gas.rows('Participants').map((p) => [p.Email, p.Gym]), [['old@example.com', 'Iron View'], ['newiv@example.com', 'Iron View'], ['newokc@example.com', 'OKC']]);
});

test('payment is per gym: its own Venmo and Zelle, and a card at every gym (a secure link by email until the gym has a checkout link); never Iron View’s Venmo', () => {
  const { gas, post } = world({ welcome_email: true });
  okcSetUp(gas);
  const remote = (email, gym, payment) => post({ action: 'register', gym, memberType: 'remote', payment, first: 'Rem', last: 'Ote', email, password: 'secret1', shirt: 'tee', size: 'L', setup: SETUP });
  const mailTo = (email) => gas.state.mail.find((m) => m.to === email) || {};
  // Kevin, 11/23/2026: "put a placeholder for the card link, we'll add one later". No gym has a Card
  // URL yet, and every gym offers a card: after Iron View's and OKC's own Venmo and Zelle, and at
  // Tulsa (no payment details at all) on its own.
  const offered = gas.run((ctx) => JSON.parse(JSON.stringify(['ironview', 'okc', 'tulsa'].map((id) => ctx.res27GymPayments_(ctx.res27Gym_(id))))));
  assert.deepEqual(offered, [['venmo', 'zelle', 'card'], ['venmo', 'zelle', 'card'], ['card']]);
  // So a remote sign-up always picks one: none, or one the gym doesn't offer, is refused.
  assert.equal(remote('a@example.com', 'ironview', '').error, 'Choose how you’d like to pay the $99.');
  assert.equal(remote('a@example.com', 'ironview', 'paypal').error, 'Choose how you’d like to pay the $99.');
  assert.equal(remote('a@example.com', 'ironview', 'zelle').ok, true);
  // OKC: its own Venmo and Zelle at $89.
  const b = remote('b@example.com', 'okc', 'venmo');
  assert.equal(b.ok, true, b.error);
  assert.match(b.me.payUrl, /recipients=koda-okc&amount=89&note=Koda%20Resolutions%202027%20-%20Rem%20Ote/);
  const mailB = mailTo('b@example.com');
  assert.match(mailB.htmlBody, /Your \$89 remote spot:<\/b> pay on Venmo to <b>@koda-okc<\/b>/);
  assert.ok(!/kevin-schuetz/.test(mailB.htmlBody), 'never Iron View’s Venmo');
  assert.equal(mailB.replyTo, 'hello@okc.example.com');
  // A card with no checkout link yet, at OKC and at Tulsa: the sign-up goes through, and the welcome
  // email says a secure link is coming by email (Iron View's line from before it had a link), with
  // no card button.
  const c = remote('c@example.com', 'okc', 'card');
  assert.equal(c.ok, true, c.error);
  assert.match(mailTo('c@example.com').htmlBody, /Your \$89 remote spot:<\/b> pay by card\. We’ll email you a secure link within a day\. We’ll mark you paid in the app\.<\/div>/);
  const tulsaVenmo = remote('t@example.com', 'tulsa', 'venmo');
  assert.deepEqual([tulsaVenmo.code, tulsaVenmo.error], ['bad_request', 'Choose how you’d like to pay the $99.'], 'Tulsa has no Venmo (and never Iron View’s)');
  const t = remote('t@example.com', 'tulsa', 'card');
  assert.equal(t.ok, true, t.error);
  assert.equal(t.me.payUrl, '', 'no Venmo button');
  const mailT = mailTo('t@example.com').htmlBody;
  assert.match(mailT, /Your \$99 remote spot:<\/b> pay by card\. We’ll email you a secure link within a day\. We’ll mark you paid in the app\./);
  assert.ok(!/by card<\/a>|venmo\.com|kevin-schuetz|kodaironview@gmail.com<\/b>|how to pay/.test(mailT), 'no card button, nothing of Iron View’s, never "how to pay"');
  const rows = gas.rows('Participants');
  assert.deepEqual(rows.map((r) => [r.Gym, r.Payment, r.Paid]), [['Iron View', 'Zelle', ''], ['OKC', 'Venmo', ''], ['OKC', 'Credit Card', ''], ['Tulsa', 'Credit Card', '']]);
  const later = gas.run((ctx) => ctx.RES27_PAY_LATER);
  assert.ok(!rows.some((r) => r.Payment === later) && !gas.rows('Log').some((l) => String(l.Detail).includes(later)), 'no new sign-up is "' + later + '"');
  // Kevin pastes Tulsa's card link: the app gets it, and the welcome email has the button, as before.
  setGym(gas, 'tulsa', 'Card URL', 'https://pay.example.com/tulsa');
  assert.equal(post({ action: 'config' }).config.gyms.find((g) => g.id === 'tulsa').cardUrl, 'https://pay.example.com/tulsa');
  assert.equal(remote('d@example.com', 'tulsa', 'venmo').code, 'bad_request');
  const d = remote('d@example.com', 'tulsa', 'card');
  assert.equal(d.ok, true, d.error);
  const mailD = mailTo('d@example.com').htmlBody;
  assert.match(mailD, /Your \$99 remote spot:<\/b> pay by card:<br><a href="https:\/\/pay\.example\.com\/tulsa" style="display:inline-block;background:#02AFAD;color:#000000[^"]*">Pay \$99 by card<\/a>\. We’ll mark you paid in the app\./);
  assert.ok(!/secure link/.test(mailD), 'with a link, no "we’ll email you a secure link"');
  // Members never pay, at any gym.
  assert.equal(post({ action: 'register', gym: 'tulsa', memberType: 'member', first: 'Mem', last: 'Ber', email: 'e@example.com', password: 'secret1', shirt: 'tee', size: 'L', setup: SETUP }).ok, true);
  const member = gas.rows('Participants').find((r) => r.Email === 'e@example.com');
  assert.deepEqual([member.Payment, member.Paid], ['', 'n/a']);
});

/* --------------------------------------------------------------------- emails ---- */

// The frame as 1.7 built it, for "Iron View unchanged".
function oldFrame(cfg, heading, bodyHtml) {
  const h = (t) => String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const name = h(cfg.program_name || 'Koda Resolutions 2027');
  return '<div style="background:#F4F6F8;padding:24px 12px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#0F1925">' +
    '<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E8ED;border-radius:16px;overflow:hidden">' +
    '<div style="background:#0C1A2B;padding:22px 28px;color:#FFFFFF">' +
    '<div style="font-size:12px;letter-spacing:2px;color:#AEB7C2;text-transform:uppercase">Koda CrossFit Iron View</div>' +
    '<div style="font-size:24px;font-weight:800;letter-spacing:.5px;margin-top:4px">' + name + '</div></div>' +
    '<div style="padding:26px 28px;font-size:15px;line-height:1.55">' +
    '<h1 style="font-size:20px;margin:0 0 14px;color:#0C1A2B">' + h(heading) + '</h1>' + bodyHtml + '</div>' +
    '<div style="padding:16px 28px;border-top:1px solid #E4E8ED;font-size:12px;color:#8B95A3">Koda CrossFit Iron View · 740 S Pierce Ave #5, Louisville, CO 80027' +
    (cfg.contact_email ? ' · ' + h(cfg.contact_email) : '') + '</div></div></div>';
}

test('emails come in the gym’s frame: its colors, name, address and contact; Iron View’s is exactly the frame it always had', () => {
  const { gas } = world();
  okcSetUp(gas);
  const frames = gas.run((ctx) => {
    const cfg = ctx.res27Settings_();
    return {
      cfg: JSON.parse(JSON.stringify(cfg)),
      plain: ctx.res27EmailFrame_(cfg, 'Welcome <you>', '<p>Body</p>'),
      iv: ctx.res27EmailFrame_(cfg, 'Welcome <you>', '<p>Body</p>', ctx.res27Gym_('ironview')),
      okc: ctx.res27EmailFrame_(cfg, 'Welcome', '<p>Body</p>', ctx.res27Gym_('okc')),
      downtown: ctx.res27EmailFrame_(cfg, 'Welcome', '<p>Body</p>', ctx.res27Gym_('downtown')),
    };
  });
  const old = oldFrame(frames.cfg, 'Welcome <you>', '<p>Body</p>');
  assert.equal(frames.plain, old, 'no gym given: Iron View, unchanged');
  assert.equal(frames.iv, old);
  assert.match(frames.okc, /background:#000000;padding:22px 28px;color:#FFFFFF;border-bottom:4px solid #7C28E6/);
  assert.match(frames.okc, /color:#C4A5F3;text-transform:uppercase">Koda OKC</);
  assert.match(frames.okc, /<h1 style="font-size:20px;margin:0 0 14px;color:#6A1FCB">Welcome<\/h1>/);
  assert.match(frames.okc, />Koda OKC · 7016 Ozzy Ave, Oklahoma City, OK 73105 · hello@okc\.example\.com<\/div>/);
  assert.match(frames.downtown, />Koda Downtown · kodaironview@gmail\.com<\/div>/, 'no address yet: just the name and contact');
});

test('email colors are readable: every text color on its background is at least 4.5:1 (WCAG)', () => {
  const { gas } = world();
  const gyms = gas.run((ctx) => JSON.parse(JSON.stringify(ctx.RES27_GYMS)));
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  for (const g of gyms) {
    const m = g.mail;
    for (const [what, fg, bg] of [['header text', '#FFFFFF', m.head], ['gym line', m.headSub, m.head], ['button text', m.buttonText, m.button], ['heading', m.ink, '#FFFFFF']]) {
      assert.ok(ratio(fg, bg) >= 4.5, g.id + ' ' + what + ' ' + fg + ' on ' + bg + ' is ' + ratio(fg, bg).toFixed(2));
    }
  }
  assert.equal(gyms.find((g) => g.id === 'downtown').mail.buttonText, '#000000', 'Downtown’s green takes black text, as on their site');
});

/* ------------------------------------------------------------------ profile changes ---- */

test('gym changes: allowed before Day 1 (a ranking from the old gym is cleared), refused from Day 1 ("Ask Kevin"); the daily email switches any time', () => {
  const { gas, post } = world();
  okcSetUp(gas);
  const r = join(post, 'Ann', 'ironview', { setup: Object.assign({}, SETUP, { coaches: ['Riley', 'Kevin'] }) });
  assert.deepEqual(r.me.person.setup.coaches, ['Riley', 'Kevin']);
  // Just the gym: the Iron View ranking doesn't fit OKC, so it's cleared. (10:30 PM in Denver,
  // 11:30 PM in Oklahoma: the day before Day 1 at every gym.)
  gas.setNow('2027-01-17T22:30:00-07:00');
  const moved = post({ action: 'setup', token: r.token, gym: 'okc' });
  assert.equal(moved.ok, true, moved.error);
  assert.deepEqual([moved.me.person.gym, moved.me.person.setup.coaches], ['okc', []]);
  let row = gas.rows('Participants')[0];
  assert.deepEqual([row.Gym, row['Coach Ranking']], ['OKC', 'No preference']);
  assert.equal(gas.rows('Log').filter((l) => l.What === 'Changed gym').map((l) => l.Detail).join(), 'Iron View → OKC · coach ranking cleared');
  // With a new ranking made for the new gym, in the same request: kept.
  const back = post({ action: 'setup', token: r.token, gym: 'ironview', setup: Object.assign({}, SETUP, { coaches: ['Maggie'] }) });
  assert.deepEqual([back.me.person.gym, back.me.person.setup.coaches], ['ironview', ['Maggie']]);
  // A ranking from the old gym sent with the move: cleared.
  const okcAgain = post({ action: 'setup', token: r.token, gym: 'okc', setup: Object.assign({}, SETUP, { coaches: ['Maggie', 'Avery'] }) });
  assert.deepEqual(okcAgain.me.person.setup.coaches, []);
  assert.equal(post({ action: 'setup', token: r.token, gym: 'nowhere' }).code, 'gym');

  // 12:30 AM in Oklahoma (11:30 PM in Denver): Day 1 has started there, and Ann (at OKC now) could
  // already log it, so her gym is set. An Iron View member, still on the day before, can't move into
  // a gym whose Day 1 has started either (11/24/2026 review: she couldn't have moved back).
  gas.setNow('2027-01-17T23:30:00-07:00');
  const early = post({ action: 'setup', token: r.token, gym: 'ironview' });
  assert.deepEqual([early.ok, early.code], [false, 'locked_gym']);
  const ivy = join(post, 'Ivy', 'ironview');
  const ivyMoves = post({ action: 'setup', token: ivy.token, gym: 'norman' });
  assert.deepEqual([ivyMoves.ok, ivyMoves.code, ivyMoves.error], [false, 'locked_gym', 'Day 1 has already started at Koda Norman, so you can’t move there now. Ask Kevin.']);
  assert.equal(gas.rows('Participants').find((p) => p.Email === 'ivy@example.com').Gym, 'Iron View');

  // Day 1 (Denver): the gym is locked; the same gym, setup changes and the daily email still work.
  gas.setNow('2027-01-18T00:05:00-07:00');
  const locked = post({ action: 'setup', token: r.token, gym: 'ironview' });
  assert.deepEqual([locked.ok, locked.code, locked.error], [false, 'locked_gym', 'Your gym can’t change once the challenge has started. Ask Kevin.']);
  assert.equal(post({ action: 'setup', token: r.token, gym: 'okc', setup: SETUP }).ok, true, 'the gym they’re at is fine');
  const off = post({ action: 'setup', token: r.token, dailyEmail: false });
  assert.equal(off.ok, true, off.error);
  assert.equal(off.me.person.dailyEmail, false);
  row = gas.rows('Participants')[0];
  assert.deepEqual([row.Gym, row['Daily Email']], ['OKC', 'Off']);
  assert.equal(post({ action: 'setup', token: r.token, dailyEmail: true }).me.person.dailyEmail, true);
  assert.equal(gas.rows('Participants')[0]['Daily Email'], 'On');
  assert.deepEqual(gas.rows('Log').filter((l) => l.What === 'Daily email').map((l) => l.Detail), ['On → Off (Profile)', 'Off → On (Profile)']);
  assert.equal(gas.rows('Log').filter((l) => l.What === 'Changed setup').length, 3, 'only requests with a setup log a setup change');
});

test('Day 1 locks a gym change by the phone’s date too, and nobody moves into a gym whose Day 1 has started (11/24 review #8)', () => {
  const { gas, post } = world();
  const ivan = join(post, 'Ivan', 'ironview');
  const ivy = join(post, 'Ivy', 'ironview');
  // 10:30 PM in Denver on Jan 17 is 12:30 AM on Jan 18 in New York. A phone there is on Day 1 (the
  // server takes its date, a day from Denver's), so it can log Day 1...
  gas.setNow('2027-01-17T22:30:00-07:00');
  const east = post({ action: 'me', token: ivan.token, today: '2027-01-18' }).me.program;
  assert.deepEqual([east.today, east.phase, east.dayNumber], ['2027-01-18', 'during', 1]);
  assert.equal(post({ action: 'save', token: ivan.token, date: '2027-01-18', answers: { video: 1 }, patch: true, today: '2027-01-18' }).ok, true);
  // ...so its gym is set (Day 1's points would move with it), though OKC is still on Jan 17.
  const moveEast = post({ action: 'setup', token: ivan.token, gym: 'okc', today: '2027-01-18' });
  assert.deepEqual([moveEast.ok, moveEast.code, moveEast.error], [false, 'locked_gym', 'Your gym can’t change once the challenge has started. Ask Kevin.']);
  assert.equal(gas.rows('Participants').find((p) => p.Email === 'ivan@example.com').Gym, 'Iron View');
  // A Mountain phone at the same moment: every gym is still on Jan 17, so Ivy can move, and back.
  assert.equal(post({ action: 'setup', token: ivy.token, gym: 'okc', today: '2027-01-17' }).me.person.gym, 'okc');
  assert.equal(post({ action: 'setup', token: ivy.token, gym: 'ironview', today: '2027-01-17' }).me.person.gym, 'ironview');
  assert.equal(post({ action: 'setup', token: ivy.token, gym: 'okc', today: '2027-01-17' }).me.person.gym, 'okc');
  // 11:30 PM in Denver: Day 1 has started at OKC (12:30 AM there). Ivy, at OKC, is set; nobody moves
  // into a Central gym now either, Iron View's on a Mountain phone included (they couldn't move back).
  gas.setNow('2027-01-17T23:30:00-07:00');
  assert.equal(post({ action: 'setup', token: ivy.token, gym: 'ironview', today: '2027-01-17' }).code, 'locked_gym');
  const into = post({ action: 'setup', token: ivan.token, gym: 'tulsa', today: '2027-01-17' });
  assert.deepEqual([into.ok, into.code, into.error], [false, 'locked_gym', 'Day 1 has already started at Koda Tulsa, so you can’t move there now. Ask Kevin.']);
  // Kevin can still move anyone (set-gym).
  assert.equal(post({ action: 'adminSetGym', key: ADMIN, email: 'ivy@example.com', gym: 'ironview' }).gym, 'ironview');
  assert.deepEqual(gas.rows('Log').filter((l) => l.What === 'Changed gym').map((l) => l.Detail), ['Iron View → OKC', 'OKC → Iron View', 'Iron View → OKC', 'OKC → Iron View (by Kevin)']);
});

test('before setup has added the Gym column, a gym change is refused the way a sign-up at that gym is (11/24 review #5): nothing is cleared and the gym stays; after setup it goes', () => {
  const { gas, post } = world({}, '2027-01-05T10:00:00-07:00');
  const ann = join(post, 'Ann', 'ironview', { setup: Object.assign({}, SETUP, { coaches: ['Riley'] }) });
  setCell(gas, 'ann@example.com', 'Team', 'Thunder');
  setCell(gas, 'ann@example.com', 'Coach', 'Riley');
  const before = gas.rows('Participants')[0];
  assert.equal(before['Coach Ranking'], '1. Riley');
  deleteColumn(gas, 'Participants', 'Gym'); // the six-gym page went out before `live.js setup`
  gas.state.cache.clear();
  const r = post({ action: 'setup', token: ann.token, gym: 'okc' });
  assert.deepEqual([r.ok, r.code, r.error], [false, 'not_ready', 'We’re still setting up sign-ups for Koda OKC. Please try again in a few minutes.']);
  const row = gas.rows('Participants')[0];
  assert.deepEqual([row.Team, row.Coach, row['Coach Ranking']], ['Thunder', 'Riley', '1. Riley'], 'before the review these were cleared while the gym stayed');
  assert.deepEqual(post({ action: 'me', token: ann.token }).me.person.setup.coaches, ['Riley']);
  assert.equal(gas.rows('Log').filter((l) => l.What === 'Changed gym').length, 0);
  // The rest of the Profile still saves.
  assert.equal(post({ action: 'setup', token: ann.token, gym: 'ironview', dailyEmail: false }).ok, true);
  assert.equal(post({ action: 'adminSetup', key: ADMIN }).ok, true);
  const moved = post({ action: 'setup', token: ann.token, gym: 'okc' });
  assert.equal(moved.ok, true, moved.error);
  assert.deepEqual([moved.me.person.gym, moved.cleared], ['okc', { ranking: true, team: 'Thunder', coach: 'Riley' }]);
});

test('adminSetGym: Kevin moves someone any time, by id, short or full name; a ranking that doesn’t fit is cleared; logged', () => {
  const { gas, post } = world({}, '2027-01-27T19:00:00-07:00');
  okcSetUp(gas);
  const r = join(post, 'Ann', 'ironview', { setup: Object.assign({}, SETUP, { coaches: ['Riley'] }) });
  assert.equal(post({ action: 'adminSetGym', key: 'nope-nope', email: 'ann@example.com', gym: 'okc' }).code, 'forbidden');
  const bad = post({ action: 'adminSetGym', key: ADMIN, email: 'ann@example.com', gym: 'Austin' });
  assert.equal(bad.code, 'gym');
  assert.match(bad.error, /^No gym is called "Austin"\. Use one of: ironview \(Iron View\), okc \(OKC\), native \(Native\), norman \(Norman\), downtown \(Downtown\), tulsa \(Tulsa\)\.$/);
  assert.equal(post({ action: 'adminSetGym', key: ADMIN, email: 'nobody@example.com', gym: 'okc' }).error, 'No participant with that email.');
  const out = post({ action: 'adminSetGym', key: ADMIN, email: 'ANN@example.com', gym: 'Koda OKC' });
  assert.deepEqual(out, { ok: true, email: 'ann@example.com', was: 'ironview', gym: 'okc', coachRankingCleared: true, teamCleared: '', coachCleared: '' });
  const me = post({ action: 'me', token: r.token }).me;
  assert.deepEqual([me.person.gym, me.person.setup.coaches], ['okc', []]);
  assert.deepEqual([gas.rows('Participants')[0].Gym, gas.rows('Participants')[0]['Coach Ranking']], ['OKC', 'No preference']);
  assert.equal(gas.rows('Log').filter((l) => l.What === 'Changed gym')[0].Detail, 'Iron View → OKC (by Kevin) · coach ranking cleared');
  assert.equal(post({ action: 'adminSetGym', key: ADMIN, email: 'ann@example.com', gym: 'tulsa' }).coachRankingCleared, false);
  assert.equal(gas.rows('Participants')[0]['Coach Ranking'], '', 'Tulsa lists no coaches');
});

test('a gym change clears Team and Coach (Kevin set them for the old gym; teams belong to a gym) and says so: in the Profile’s reply and Log line, and in adminSetGym’s reply and Log line', () => {
  const { gas, post } = world();
  okcSetUp(gas);
  const ann = join(post, 'Ann', 'tulsa');
  join(post, 'Bea', 'tulsa');
  setCell(gas, 'ann@example.com', 'Team', 'Thunder');
  setCell(gas, 'ann@example.com', 'Coach', 'Sam');
  setCell(gas, 'bea@example.com', 'Team', 'Thunder');
  const moved = post({ action: 'setup', token: ann.token, gym: 'okc' });
  assert.equal(moved.ok, true, moved.error);
  assert.deepEqual(moved.cleared, { ranking: false, team: 'Thunder', coach: 'Sam' });
  assert.deepEqual([moved.me.person.gym, moved.me.person.team, moved.me.person.coach], ['okc', '', '']);
  const annRow = () => gas.rows('Participants').find((p) => p.Email === 'ann@example.com');
  assert.deepEqual([annRow().Gym, annRow().Team, annRow().Coach], ['OKC', '', '']);
  const lastMove = () => gas.rows('Log').filter((l) => l.What === 'Changed gym').pop().Detail;
  assert.equal(lastMove(), 'Tulsa → OKC · Team Thunder and Coach Sam cleared');
  // No gym change (the same gym, the daily email): Team and Coach stay.
  setCell(gas, 'ann@example.com', 'Team', 'Bolt');
  const same = post({ action: 'setup', token: ann.token, gym: 'OKC', dailyEmail: false });
  assert.deepEqual([same.ok, same.cleared, annRow().Team], [true, undefined, 'Bolt']);
  // Kevin moves Bea (Team Thunder, no coach): the reply and the Log line say what was cleared.
  const out = post({ action: 'adminSetGym', key: ADMIN, email: 'bea@example.com', gym: 'okc' });
  assert.deepEqual([out.ok, out.teamCleared, out.coachCleared], [true, 'Thunder', '']);
  assert.equal(gas.rows('Participants').find((p) => p.Email === 'bea@example.com').Team, '');
  assert.equal(lastMove(), 'Tulsa → OKC (by Kevin) · Team Thunder cleared');
  // set-gym to the gym someone is already at clears nothing.
  setCell(gas, 'bea@example.com', 'Team', 'Bolt');
  const again = post({ action: 'adminSetGym', key: ADMIN, email: 'bea@example.com', gym: 'okc' });
  assert.deepEqual([again.teamCleared, again.coachCleared, gas.rows('Participants').find((p) => p.Email === 'bea@example.com').Team], ['', '', 'Bolt']);
});

test('a plain-text Gyms cell that keeps the apostrophe setup put before @kevin-schuetz-5 (or one Kevin typed) still reads as the handle, so Iron View’s Venmo link works', () => {
  const gas = createGas({ textKeepsApostrophe: true });
  gas.setNow(NOW);
  const post = (body) => gas.post(Object.assign({ type: 'res27' }, body));
  assert.equal(post({ action: 'adminSetup', key: ADMIN, days: DAYS, settings: { welcome_email: false } }).ok, true);
  assert.equal(gas.rows('Gyms')[0].Venmo, "'@kevin-schuetz-5", 'stored the way a plain-text cell may keep it');
  const cfg = post({ action: 'config' }).config;
  assert.deepEqual([cfg.gyms[0].venmo, cfg.venmo], ['@kevin-schuetz-5', '@kevin-schuetz-5']);
  const r = post({ action: 'register', gym: 'ironview', memberType: 'remote', payment: 'venmo', first: 'Rem', last: 'Ote', email: 'rem@example.com', password: 'secret1', shirt: 'tee', size: 'L', setup: SETUP });
  assert.equal(r.ok, true, r.error);
  assert.match(r.me.payUrl, /recipients=kevin-schuetz-5&amount=99/);
  setGym(gas, 'okc', 'Zelle', "'+1 405 555 0100");
  assert.equal(post({ action: 'config' }).config.gyms[1].zelle, '+1 405 555 0100');
});

test('setup on an older sheet: Daily Email goes right after Welcome Email, a new column never lands on one of Kevin’s (blank header cells included), his own columns keep their format, and an inserted column starts without a dropdown', () => {
  const { gas, post } = world();
  join(post, 'Ann', 'ironview');
  // The sheet as 1.7 left it (no Gym, no Daily Email), with Kevin's own columns after Notes: a
  // spacer with a blank header (and a note under it), Shirt Ordered, and Picked Up (his dates).
  deleteColumn(gas, 'Participants', 'Gym');
  deleteColumn(gas, 'Participants', 'Daily Email');
  deleteColumn(gas, 'Participants', 'Last Seen'); // stands in for any column a new version adds with no neighbor
  const sheet = gas.sheet('Participants');
  const notes = headers(gas, 'Participants').indexOf('Notes') + 1;
  sheet.getRange(2, notes + 1).setValue('call back');
  sheet.getRange(1, notes + 2, 1, 2).setValues([['Shirt Ordered', 'Picked Up']]);
  sheet.getRange(2, notes + 2).setValue('No');
  sheet.getRange(2, notes + 3, sheet.getMaxRows() - 1, 1).setNumberFormat('m/d/yyyy');
  sheet.getRange(2, notes + 3).setValue(new Date(2026, 11, 5));
  gas.state.cache.clear();
  gas.state.validationsCleared.length = 0;
  assert.equal(post({ action: 'adminSetup', key: ADMIN }).ok, true);
  const head = headers(gas, 'Participants');
  assert.equal(head.indexOf('Gym'), head.indexOf('Type') + 1);
  assert.equal(head.indexOf('Daily Email'), head.indexOf('Welcome Email') + 1, 'next to Welcome Email, where the spec puts it');
  assert.deepEqual(head.slice(head.indexOf('Notes')), ['Notes', '', 'Shirt Ordered', 'Picked Up', 'Last Seen'], 'the new column after the last one in use');
  const row = gas.rows('Participants')[0];
  assert.deepEqual([row[''], row['Shirt Ordered'], row.Gym, row['Daily Email']], ['call back', 'No', 'Iron View', '']);
  const pickedUp = head.indexOf('Picked Up') + 1;
  assert.equal(sheet.getRange(2, pickedUp).getNumberFormat(), 'm/d/yyyy', 'Kevin’s own format');
  assert.ok(row['Picked Up'] instanceof Date || Object.prototype.toString.call(row['Picked Up']) === '[object Date]');
  const letter = (n) => (n > 26 ? String.fromCharCode(64 + Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + ((n - 1) % 26));
  assert.deepEqual(gas.state.validationsCleared.filter((v) => v.tab === 'Participants').map((v) => v.range.replace(/\d+/g, '')),
    [letter(head.indexOf('Gym') + 1) + ':' + letter(head.indexOf('Gym') + 1), letter(head.indexOf('Daily Email') + 1) + ':' + letter(head.indexOf('Daily Email') + 1)]);
  assert.equal(post({ action: 'login', email: 'ann@example.com', password: 'secret1' }).me.person.dailyEmail, true, 'blank = on');
});

test('a gym’s Time Zone is one of the US zones (any case); anything else is the gym’s own zone, so its email can never go out at a GMT hour', () => {
  const { gas } = world();
  setGym(gas, 'downtown', 'Time Zone', 'America/Austin');
  setGym(gas, 'okc', 'Time Zone', 'america/new_york');
  setGym(gas, 'tulsa', 'Time Zone', 'GMT');
  const tz = gas.run((ctx) => JSON.parse(JSON.stringify(ctx.res27Gyms_().list.map((g) => [g.id, g.tz]))));
  assert.deepEqual(tz, [['ironview', 'America/Denver'], ['okc', 'America/New_York'], ['native', 'America/Chicago'], ['norman', 'America/Chicago'], ['downtown', 'America/Chicago'], ['tulsa', 'America/Chicago']]);
});

/* ------------------------------------------------------------------ videos, questions ---- */

test('videos per gym: a label that names a gym anywhere is that gym’s ("OKC Fat Loss" is OKC’s Fat Loss version, "Tulsa, Native" both gyms’, a renamed gym by its new name); other gyms never see it; finishers too', () => {
  const { gas, post } = world({}, '2027-01-19T19:00:00-07:00'); // Day 2
  setGym(gas, 'downtown', 'Name', 'Koda Austin');
  const days = gas.sheet('Days');
  const head = days.getRange(1, 1, 1, days.getLastColumn()).getValues()[0];
  days.getRange(2, head.indexOf('Video URL') + 1).setValue([
    'https://youtu.be/AAAAAAAAAAA',
    'Fat Loss: https://youtu.be/BBBBBBBBBBB',
    'OKC Fat Loss: https://youtu.be/CCCCCCCCCCC',
    'OKC only: https://youtu.be/DDDDDDDDDDD',
    'Tulsa, Native: https://youtu.be/EEEEEEEEEEE',
    'Austin: https://youtu.be/GGGGGGGGGGG',
  ].join('\n'));
  days.getRange(3, head.indexOf('Video URL') + 1).setValue(['https://youtu.be/HHHHHHHHHHH', 'Iron View & Norman Guys: https://youtu.be/FFFFFFFFFFF'].join('\n'));
  const fin = gas.sheet('Finishers');
  const finHead = fin.getRange(1, 1, 1, fin.getLastColumn()).getValues()[0];
  fin.getRange(2, finHead.indexOf('Video URL') + 1).setValue(['https://youtu.be/IIIIIIIIIII', 'OKC: https://youtu.be/JJJJJJJJJJJ'].join('\n'));
  gas.state.cache.clear();
  let n = 0;
  const me = (gym) => join(post, 'V' + n++ + gym, gym).me;
  const vids = (list) => list.map((v) => [v.label, v.youtube]);
  const seen = {};
  for (const gym of ['ironview', 'okc', 'native', 'norman', 'downtown', 'tulsa']) {
    const m = me(gym);
    seen[gym] = { day1: vids(m.days[0].videos), day2: vids(m.days[1].videos), finisher: vids(m.finishers[0].videos) };
  }
  const shared1 = [['', 'AAAAAAAAAAA'], ['Fat Loss', 'BBBBBBBBBBB']];
  assert.deepEqual(seen.okc.day1, [['Fat Loss', 'CCCCCCCCCCC'], ['', 'DDDDDDDDDDD']]);
  assert.deepEqual([seen.tulsa.day1, seen.native.day1], [[['', 'EEEEEEEEEEE']], [['', 'EEEEEEEEEEE']]]);
  assert.deepEqual(seen.downtown.day1, [['', 'GGGGGGGGGGG']], 'Koda Austin, its name on the Gyms tab');
  assert.deepEqual([seen.ironview.day1, seen.norman.day1], [shared1, shared1], 'no line of their own: the shared ones, none of the other gyms’');
  assert.deepEqual([seen.ironview.day2, seen.norman.day2], [[['Guys', 'FFFFFFFFFFF']], [['Guys', 'FFFFFFFFFFF']]]);
  assert.deepEqual(seen.okc.day2, [['', 'HHHHHHHHHHH']]);
  assert.deepEqual([seen.okc.finisher, seen.tulsa.finisher], [[['', 'JJJJJJJJJJJ']], [['', 'IIIIIIIIIII']]]);
});

test('videos per gym: a line labeled with a gym replaces the shared ones for that gym only; other gyms keep the shared ones', () => {
  const { gas, post } = world({}, '2027-01-18T19:00:00-07:00'); // Day 1
  const days = gas.sheet('Days');
  const head = days.getRange(1, 1, 1, days.getLastColumn()).getValues()[0];
  days.getRange(2, head.indexOf('Video URL') + 1).setValue([
    'https://youtu.be/AAAAAAAAAAA',
    'Fat Loss: https://youtu.be/BBBBBBBBBBB',
    'OKC: https://youtu.be/CCCCCCCCCCC',
    'Koda Tulsa | https://youtu.be/DDDDDDDDDDD',
    'tulsa: https://youtu.be/EEEEEEEEEEE',
  ].join('\n'));
  gas.state.cache.clear();
  const videosOf = (gym) => join(post, 'P' + gym, gym).me.days[0].videos.map((v) => [v.label, v.youtube]);
  assert.deepEqual(videosOf('ironview'), [['', 'AAAAAAAAAAA'], ['Fat Loss', 'BBBBBBBBBBB']]);
  assert.deepEqual(videosOf('norman'), [['', 'AAAAAAAAAAA'], ['Fat Loss', 'BBBBBBBBBBB']], 'no line of its own: the shared ones');
  assert.deepEqual(videosOf('okc'), [['', 'CCCCCCCCCCC']]);
  assert.deepEqual(videosOf('tulsa'), [['', 'DDDDDDDDDDD'], ['', 'EEEEEEEEEEE']]);
  // Six shared lines and gym lines after them: the gym lines don't push shared ones out, and vice versa.
  const many = ['1', '2', '3', '4', '5', '6'].map((n) => 'https://youtu.be/SHARED00000'.slice(0, -1) + n).concat(['Native: https://youtu.be/NNNNNNNNNNN']);
  days.getRange(2, head.indexOf('Video URL') + 1).setValue(many.join('\n'));
  gas.state.cache.clear();
  assert.equal(videosOf('downtown').length, 6);
  assert.deepEqual(videosOf('native'), [['', 'NNNNNNNNNNN']]);
});

test('a video label that joins gyms with a hyphen or dash ("OKC-Tulsa") is those gyms’ (11/24 review #6); a dash elsewhere in a label stays; any gym name counts, so "Not OKC" is OKC’s', () => {
  const { gas, post } = world({}, '2027-01-18T19:00:00-07:00'); // Day 1
  const labels = ['OKC-Tulsa', 'OKC–Tulsa', 'OKC — Tulsa', 'Iron View-OKC', 'Iron-View', 'Tulsa-only', 'OKC Fat-Loss', 'OKC - Fat Loss', 'Fat-Loss', 'Guys - Part 1',
    'Not OKC', 'OKC/Tulsa', 'Okc Guys + Tulsa Girls', 'OKC (Fat Loss)', 'Iron View & Norman Guys'];
  const read = gas.run((ctx) => labels.map((l) => {
    const r = ctx.res27VideoLabel_(l);
    return [r.gyms.join(','), r.label];
  }));
  assert.deepEqual(read, [['okc,tulsa', ''], ['okc,tulsa', ''], ['okc,tulsa', ''], ['ironview,okc', ''], ['ironview', ''], ['tulsa', ''], ['okc', 'Fat-Loss'], ['okc', 'Fat Loss'], ['', 'Fat-Loss'], ['', 'Guys - Part 1'],
    ['okc', 'Not'], ['okc,tulsa', ''], ['okc,tulsa', 'Guys Girls'], ['okc', '(Fat Loss)'], ['ironview,norman', 'Guys']]);
  const days = gas.sheet('Days');
  const head = days.getRange(1, 1, 1, days.getLastColumn()).getValues()[0];
  days.getRange(2, head.indexOf('Video URL') + 1).setValue(['https://youtu.be/AAAAAAAAAAA', 'OKC-Tulsa: https://youtu.be/BBBBBBBBBBB', 'OKC – Tulsa Fat-Loss: https://youtu.be/CCCCCCCCCCC'].join('\n'));
  gas.state.cache.clear();
  const videosOf = (gym) => join(post, 'D' + gym, gym).me.days[0].videos.map((v) => [v.label, v.youtube]);
  assert.deepEqual(videosOf('okc'), [['', 'BBBBBBBBBBB'], ['Fat-Loss', 'CCCCCCCCCCC']]);
  assert.deepEqual(videosOf('tulsa'), [['', 'BBBBBBBBBBB'], ['Fat-Loss', 'CCCCCCCCCCC']]);
  assert.deepEqual(videosOf('norman'), [['', 'AAAAAAAAAAA']], 'before the review, every gym saw the OKC-Tulsa line');
});

test('Ask a question goes to the person’s gym: its coach emails, else its contact email, else Settings’', () => {
  const { gas, post } = world({ coach_emails: 'Riley: riley.coach@example.com' }, '2027-01-27T19:00:00-07:00');
  okcSetUp(gas);
  const ask = (r) => {
    const out = post({ action: 'ask', token: r.token, question: 'Is oat milk ok?' });
    assert.equal(out.ok, true, out.error);
    return [out.to, gas.state.mail[gas.state.mail.length - 1]];
  };
  const a = join(post, 'Ann', 'okc');
  setCell(gas, 'ann@example.com', 'Coach', 'Avery');
  let [to, mail] = ask(a);
  assert.deepEqual([to, mail.to, mail.replyTo], ['coach', 'avery.coach@example.com', 'ann@example.com']);
  assert.match(mail.htmlBody, /background:#000000/, 'in OKC’s colors');
  assert.match(mail.htmlBody, /· Koda OKC · Day 10 of 42/);
  const b = join(post, 'Bea', 'okc');
  setCell(gas, 'bea@example.com', 'Coach', 'Riley'); // an Iron View coach: not OKC's
  [to, mail] = ask(b);
  assert.deepEqual([to, mail.to], ['gym', 'hello@okc.example.com']);
  assert.match(mail.htmlBody, /Coach Riley has no email in Coach Emails on the Gyms tab \(OKC\) yet/);
  const c = join(post, 'Cal', 'tulsa');
  [to, mail] = ask(c);
  assert.deepEqual([to, mail.to], ['gym', 'kodaironview@gmail.com'], 'Tulsa has no contact email of its own: Settings’');
  const d = join(post, 'Dee', 'ironview');
  setCell(gas, 'dee@example.com', 'Coach', 'Riley');
  [to, mail] = ask(d);
  assert.deepEqual([to, mail.to], ['coach', 'riley.coach@example.com'], 'Iron View’s coach emails came from Settings');
  assert.equal(post({ action: 'me', token: a.token }).me.person.askToCoach, true);
  assert.equal(post({ action: 'me', token: b.token }).me.person.askToCoach, false);
});

/* ------------------------------------------------------------------ the summary, check-ins ---- */

test('the summary counts people per gym (real, test, daily email on and off), and check-ins carry the gym', () => {
  const { gas, post } = world({ beta_start: '2026-11-23', beta_days: 7 });
  join(post, 'Ann', 'okc');
  join(post, 'Bea', 'okc');
  const cal = join(post, 'Cal', 'okc', { beta: true });
  join(post, 'Dee', 'tulsa');
  join(post, 'Eve', 'tulsa');
  setCell(gas, 'bea@example.com', 'Daily Email', 'Off');
  setCell(gas, 'eve@example.com', 'Status', 'Removed');
  const s = post({ action: 'adminSummary', key: ADMIN });
  assert.equal(s.total, 3);
  const by = Object.fromEntries(s.gyms.map((g) => [g.id, g]));
  assert.deepEqual(Object.keys(by), ['ironview', 'okc', 'native', 'norman', 'downtown', 'tulsa']);
  assert.deepEqual(by.okc, { id: 'okc', short: 'OKC', name: 'Koda OKC', people: 2, test: 1, dailyOn: 1, dailyOff: 1, badEmail: 0 });
  assert.deepEqual([by.tulsa.people, by.tulsa.test, by.ironview.people], [1, 0, 0]);
  assert.deepEqual(s.email, { daily_email: false, email_provider: 'off', email_from: '', email_hour: 3, apiKey: false, problem: 'daily_email is FALSE in Settings', triggers: 0, lastSent: { ironview: '', okc: '', native: '', norman: '', downtown: '', tulsa: '' }, retry: {} });
  assert.equal(post({ action: 'save', token: cal.token, date: '2026-11-23', answers: { video: 1 }, patch: true }).ok, true);
  assert.equal(gas.rows('Check-ins')[0].Gym, 'OKC');
});
