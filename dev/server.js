'use strict';

/**
 * server.js — runs the whole app on localhost with no Google involved: `node dev/server.js`
 *
 * /              the repo root, served as files (index.html, assets)
 * /api           POST → the real res27Post, running against dev/gas-mock.js (GET → res27Get)
 * /dev/reset     a fresh world: sheet set up, the Days tab seeded from content/days-2027.json.
 *                ?at=ISO sets the fake clock (default: 2026-11-09 10:00 MT, before the challenge)
 *                ?demo=1 also signs up demo@koda.test (password: koda2027) with two weeks of check-ins
 * /dev/time      ?set=ISO moves the fake clock, ?clear=1 goes back to the real time
 * /dev/emails    what's been "sent", as JSON. ?clear=1 empties it afterward
 * /dev/rows      ?tab=Participants — a tab's rows, as the sheet would show them
 * /dev/slow      ?ms=900 adds that much delay to every /api call (Apps Script is not instant)
 * /dev/run-daily the daily email at the fake clock's time (see runDaily below), so its emails show
 *                in /dev/emails: ?gym=okc&dry=1 builds that gym's emails for its own date and puts
 *                them there without sending or marking anything (no gym: every gym); ?gym=okc sends
 *                that gym's for real (adminEmailSend with force, through the dev world's provider:
 *                mailapp; a later day than the gym's today is refused, as it is for Kevin);
 *                with neither, one run of the hourly trigger (needs daily_email TRUE). &date= too
 * /dev/email-off ?email=a@b.co — that person's signed "Stop these daily emails" link (u and s)
 * /dev/gym       ?gym=okc&col=Venmo&value=@koda-okc — one cell of the Gyms tab (each gym's details)
 * /dev/cell      ?email=a@b.co&col=Team&value=Iron — one of Kevin's Participants cells (&tab=Accounts:
 *                that tab's, e.g. col=Email to give an account an old-style address)
 * /dev/resend    the dev world's emails through the mock's Resend, to try failed sends (see resendMode)
 *
 * The dev world's email_provider is mailapp (Gmail, here the fake MailApp), so emails sent through
 * the provider land in /dev/emails too (and with /dev/resend?on=1, what the fake Resend sent).
 * Nothing ever reaches a real email provider: UrlFetchApp is the mock's, which answers without a network.
 *
 * Everything lives in memory and is gone when the server stops.
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { createGas } = require('./gas-mock.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8790;
const ADMIN_KEY = 'test-admin-key-123';
const BEFORE = '2026-11-09T10:00:00-07:00';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

let gas = null;
let slowMs = 0;

function seedDays() {
  const file = path.join(ROOT, 'content', 'days-2027.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

function post(body) {
  return gas.post(Object.assign({ type: 'res27' }, body));
}

const DEMO_SETUP = {
  goal: 'fatloss',
  track: { nutrition: true, workout: true, sleep: true, protein: true, hydration: true, finishers: true, skill: true, mobility: false, recovery: true, other: true },
  plan: 'recommended',
  sleepHours: 7.5,
  proteinG: 150,
  hydrationOz: 90,
  finishersPerWeek: 2,
  skill: 'Double-unders',
  other: ['No alcohol'],
  coaches: ['Riley', 'Kevin', 'Maggie', 'Jamie'],
};

function resetWorld(options) {
  resendFails.clear(); // (a fresh world is back on mailapp, with no failures planned)
  gas = createGas({ echoConsole: true });
  gas.setNow(options.at || BEFORE);
  // mailapp: a daily email sent here (adminEmailSend, the trigger) goes to the fake MailApp, so /dev/emails shows it.
  const setup = post({ action: 'adminSetup', key: ADMIN_KEY, days: seedDays(), settings: { email_provider: 'mailapp' } });
  if (!setup.ok) throw new Error('adminSetup failed: ' + setup.error);
  if (options.demo) addDemo(options.at || BEFORE);
  return setup;
}

/**
 * /dev/run-daily. dry: the gym's (or every gym's) emails for the fake clock's date there (or
 * `date`), built by the backend and put straight into /dev/emails, marked daily and dryRun, with
 * their stop link as emailOff. Nothing is sent, logged or marked, and the settings don't matter.
 * Not dry, with a gym: a real send of that gym's (adminEmailSend, force: everyone on that day's
 * list, today or an earlier day). Neither: one run of the hourly trigger.
 */
function runDaily(params) {
  const gymWanted = params.get('gym') || '';
  const date = params.get('date') || '';
  if (params.get('dry') === '1') {
    const out = gas.run((ctx) => {
      const cfg = ctx.res27Settings_();
      const people = ctx.res27AllPeople_();
      const id = gymWanted ? ctx.res27GymId_(gymWanted) : '';
      if (gymWanted && !id) return { ok: false, error: 'No gym is called ' + gymWanted };
      const gyms = ctx.res27Gyms_().list.filter((g) => !id || g.id === id);
      return { ok: true, batches: JSON.parse(JSON.stringify(gyms.map((g) => ctx.res27DailyBatch_(cfg, g, date || ctx.res27GymNow_(g).date, people)))) };
    });
    if (!out.ok) return out;
    const at = gas.now().toISOString();
    const emails = [];
    out.batches.forEach((b) => {
      b.messages.forEach((m) => {
        gas.state.mail.push({ at, to: m.to, subject: m.subject, htmlBody: m.html, body: m.text, replyTo: m.replyTo, headers: { 'List-Unsubscribe': '<' + m.unsubscribe + '>' }, daily: true, dryRun: true, gym: b.gym, date: b.date, overdue: m.overdue, emailOff: m.unsubscribe });
        emails.push({ gym: b.gym, to: m.to, subject: m.subject, overdue: m.overdue, emailOff: m.unsubscribe });
      });
    });
    return { ok: true, dryRun: true, gyms: out.batches.map((b) => ({ gym: b.gym, date: b.date, count: b.messages.length, overdue: b.overdue, subject: b.subject })), emails };
  }
  if (gymWanted) return post({ action: 'adminEmailSend', key: ADMIN_KEY, gym: gymWanted, date: date || undefined, dryRun: false, force: true });
  return gas.call('res27DailyEmails');
}

/**
 * /dev/resend: the dev world's emails through the mock's Resend instead of the fake Gmail, to see
 * what a failed send does (tests/email-cli.js). Nothing leaves this computer: the mock answers every
 * request itself, and the key is made up.
 *   ?on=1                     email_provider resend, a made-up key, email_from set
 *   ?fail=a@b.co&how=refuse   Resend turns that address down (the rest of its batch goes)
 *   ?fail=a@b.co&how=down     its whole batch is answered 503 (none of it goes)
 *   ?fail=a@b.co&how=lost     Resend takes its batch, but the answer never comes back
 *   ?clear=1                  no more failures; ?off=1 back to mailapp
 * What the fake Resend sent shows in /dev/emails (via: 'resend').
 */
const resendFails = new Map();
function resendMode(params) {
  if (params.get('off') === '1') {
    resendFails.clear();
    gas.state.fetchResponder = null;
    return post({ action: 'adminSetup', key: ADMIN_KEY, settings: { email_provider: 'mailapp' } });
  }
  if (params.get('clear') === '1') resendFails.clear();
  if (params.get('fail')) {
    const how = params.get('how') || 'refuse';
    if (['refuse', 'down', 'lost'].indexOf(how) < 0) return { ok: false, error: 'how is refuse, down or lost' };
    resendFails.set(String(params.get('fail')).toLowerCase(), how);
  }
  if (params.get('on') === '1') {
    gas.state.properties.set('RES27_EMAIL_API_KEY', 're_dev_made_up_key');
    const set = post({ action: 'adminSetup', key: ADMIN_KEY, settings: { email_provider: 'resend', email_from: 'Koda Resolutions <resolutions@example.com>' } });
    if (!set.ok) return set;
  }
  gas.state.fetchResponder = (req) => {
    if (!/api\.resend\.com\/emails\/batch$/.test(req.url) || !resendFails.size) return undefined;
    const items = JSON.parse(req.payload || '[]');
    const rules = items.map((i) => resendFails.get(String(i.to[0]).toLowerCase()) || '');
    if (rules.indexOf('lost') >= 0) return { lost: true };
    if (rules.indexOf('down') >= 0) return { code: 503, body: { statusCode: 503, name: 'service_unavailable', message: 'Service unavailable' } };
    const refuse = rules.map((r, i) => (r === 'refuse' ? i : -1)).filter((i) => i >= 0);
    return refuse.length ? { refuse } : undefined;
  };
  return { ok: true, fails: Object.fromEntries(resendFails) };
}

/** /dev/email-off?email=… — a person's signed stop link, as their daily email has it. */
function emailOffLink(email) {
  return gas.run((ctx) => {
    const row = ctx.res27FindRow_('participants', 'Email', email);
    if (!row) return { ok: false, error: 'no participant with that email' };
    const id = String(row.ID).trim();
    const gym = ctx.res27GymId_(row.Gym) || 'ironview';
    const s = ctx.res27EmailOffSig_(id);
    return { ok: true, u: id, s, url: ctx.res27SiteLink_(ctx.res27Settings_(), gym, '#/email-off?u=' + encodeURIComponent(id) + '&s=' + s), path: '/' + (gym === 'ironview' ? '' : '?gym=' + gym) + '#/email-off?u=' + encodeURIComponent(id) + '&s=' + s };
  });
}

/** demo@koda.test with check-ins for every day from Day 1 up to yesterday of the clock. */
function addDemo(at) {
  const now = new Date(at);
  gas.setNow('2026-12-20T18:00:00-07:00');
  const reg = post({
    action: 'register',
    gym: 'ironview',
    memberType: 'member',
    first: 'Jordan',
    last: 'Rivera',
    email: 'demo@koda.test',
    password: 'koda2027',
    shirt: 'tee',
    size: 'M',
    setup: DEMO_SETUP,
  });
  if (!reg.ok) throw new Error('demo register failed: ' + reg.error);
  let token = reg.token;
  const start = new Date('2027-01-18T20:00:00-07:00');
  for (let d = new Date(start); d < now && d.toDateString() !== now.toDateString(); d = new Date(d.getTime() + 86400000)) {
    gas.setNow(d.toISOString());
    const me = post({ action: 'me', token }).me;
    const date = me.program.today;
    const list = me.checklists[date];
    if (!list) continue;
    const answers = {};
    const seed = d.getDate();
    list.forEach((item, i) => {
      item.units.forEach((u, j) => {
        const roll = (seed * 7 + i * 13 + j * 5) % 10;
        answers[u[0]] = roll < 8 ? 1 : 0;
      });
    });
    if (seed % 9 === 0) continue; // a missed day now and then
    const saved = post({ action: 'save', token, date, answers });
    if (!saved.ok) throw new Error('demo save failed: ' + saved.error);
  }
  gas.setNow(at);
}

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 1));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === '/api') {
      if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
      if (req.method === 'POST') {
        const body = await readBody(req);
        return send(res, 200, gas.post(body));
      }
      return send(res, 200, gas.get(Object.fromEntries(url.searchParams)));
    }
    if (url.pathname === '/dev/reset') {
      const out = resetWorld({ at: url.searchParams.get('at') || '', demo: url.searchParams.get('demo') === '1' });
      return send(res, 200, { ok: true, setup: out, now: gas.now() });
    }
    if (url.pathname === '/dev/time') {
      if (url.searchParams.get('clear')) gas.setNow(null);
      else if (url.searchParams.get('set')) gas.setNow(url.searchParams.get('set'));
      return send(res, 200, { now: gas.now() });
    }
    if (url.pathname === '/dev/emails') {
      // The fake Gmail's, then what the fake Resend sent (with /dev/resend?on=1), in one shape.
      const mail = gas.state.mail.slice().concat(gas.state.delivered.map((d) => ({ at: d.at, to: d.to, subject: d.subject, htmlBody: d.html, body: d.text, replyTo: d.reply_to, via: 'resend', key: d.key })));
      if (url.searchParams.get('clear')) {
        gas.state.mail.length = 0;
        gas.state.delivered.length = 0;
      }
      return send(res, 200, mail);
    }
    if (url.pathname === '/dev/rows') {
      return send(res, 200, gas.rows(url.searchParams.get('tab') || 'Participants'));
    }
    if (url.pathname === '/dev/as') {
      // Signs this browser in (for headless screenshots): /dev/as?email=…&password=…&to=%23%2Fprogress
      const login = gas.post({ type: 'res27', action: 'login', email: url.searchParams.get('email') || 'demo@koda.test', password: url.searchParams.get('password') || 'koda2027' });
      if (!login.ok) return send(res, 400, login);
      const to = url.searchParams.get('to') || '#/today';
      return send(res, 200, `<!doctype html><script>localStorage.clear();localStorage.setItem('res27.token', ${JSON.stringify(JSON.stringify(login.token))});location.replace('/' + ${JSON.stringify(to)});</script>`, 'text/html; charset=utf-8');
    }
    if (url.pathname === '/dev/blank') {
      const to = url.searchParams.get('to') || '#/';
      return send(res, 200, `<!doctype html><script>localStorage.clear();location.replace('/' + ${JSON.stringify(to)});</script>`, 'text/html; charset=utf-8');
    }
    if (url.pathname === '/dev/cell') {
      // One of Kevin's Participants cells for a person, e.g. /dev/cell?email=a@b.co&col=Team&value=Iron
      // (&tab=Accounts: an Accounts cell, found the same way by Email).
      const tab = url.searchParams.get('tab') === 'Accounts' ? 'Accounts' : 'Participants';
      const sheet = gas.sheet(tab);
      const values = sheet.getDataRange().getValues();
      const head = values[0];
      const row = values.findIndex((r) => String(r[head.indexOf('Email')]).toLowerCase() === String(url.searchParams.get('email') || '').toLowerCase());
      const col = head.indexOf(url.searchParams.get('col') || '');
      if (row < 1 || col < 0) return send(res, 400, { ok: false, error: 'no such person or column' });
      sheet.getRange(row + 1, col + 1).setValue(url.searchParams.get('value') || '');
      gas.state.cache.clear();
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/dev/slow') {
      slowMs = Number(url.searchParams.get('ms')) || 0;
      return send(res, 200, { slowMs });
    }
    if (url.pathname === '/dev/gym') {
      // One of Kevin's Gyms tab cells, e.g. /dev/gym?gym=okc&col=Venmo&value=@koda-okc (the app sees it at once)
      const sheet = gas.sheet('Gyms');
      const values = sheet.getDataRange().getValues();
      const head = values[0];
      const row = values.findIndex((r) => String(r[head.indexOf('Gym')]).toLowerCase() === String(url.searchParams.get('gym') || '').toLowerCase());
      const col = head.indexOf(url.searchParams.get('col') || '');
      if (row < 1 || col < 0) return send(res, 400, { ok: false, error: 'no such gym or column (gym is the id, like okc; col is a Gyms header, like Venmo)' });
      sheet.getRange(row + 1, col + 1).setValue(url.searchParams.get('value') || '');
      gas.state.cache.clear();
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/dev/run-daily') {
      const out = runDaily(url.searchParams);
      return send(res, out && out.ok === false ? 400 : 200, out);
    }
    if (url.pathname === '/dev/resend') {
      const out = resendMode(url.searchParams);
      return send(res, out.ok ? 200 : 400, out);
    }
    if (url.pathname === '/dev/email-off') {
      const out = emailOffLink(url.searchParams.get('email') || '');
      return send(res, out.ok ? 200 : 400, out);
    }
    let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT)) return send(res, 403, 'no', 'text/plain');
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain');
    return send(res, 200, fs.readFileSync(file), MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  } catch (err) {
    console.error(err);
    return send(res, 500, { ok: false, error: String(err && err.stack || err) });
  }
});

resetWorld({ at: process.env.DEV_AT || '', demo: process.env.DEV_DEMO === '1' });
server.listen(PORT, () => console.log(`Koda Resolutions dev server on http://localhost:${PORT}`));
