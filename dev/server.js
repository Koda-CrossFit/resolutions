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
  gas = createGas({ echoConsole: true });
  gas.setNow(options.at || BEFORE);
  const setup = post({ action: 'adminSetup', key: ADMIN_KEY, days: seedDays() });
  if (!setup.ok) throw new Error('adminSetup failed: ' + setup.error);
  if (options.demo) addDemo(options.at || BEFORE);
  return setup;
}

/** demo@koda.test with check-ins for every day from Day 1 up to yesterday of the clock. */
function addDemo(at) {
  const now = new Date(at);
  gas.setNow('2026-12-20T18:00:00-07:00');
  const reg = post({
    action: 'register',
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
      const mail = gas.state.mail.slice();
      if (url.searchParams.get('clear')) gas.state.mail.length = 0;
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
    if (url.pathname === '/dev/slow') {
      slowMs = Number(url.searchParams.get('ms')) || 0;
      return send(res, 200, { slowMs });
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
