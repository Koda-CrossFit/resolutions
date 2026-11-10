'use strict';

/**
 * Admin calls against the LIVE backend (the hyrox web app). The admin key is read from the
 * credentials folder and never printed.
 *   node dev/live.js setup [--welcome=false|true]
 *   node dev/live.js seed-days [--overwrite]          (content/days-2027.json → Days tab)
 *   node dev/live.js summary
 *   node dev/live.js set-type <email> <Member|Remote|Test>
 *   node dev/live.js purge-tests                      (every Test account, beta testers included)
 *   node dev/live.js purge-test <email>               (just that Test account)
 *   node dev/live.js setting <key> <value>            (one Settings value, via adminSetup)
 *   node dev/live.js beta <yyyy-mm-dd|off> [days]     (start or end the beta test)
 */

const fs = require('node:fs');
const path = require('node:path');

const URL = 'https://script.google.com/macros/s/AKfycbwWjHrhE6k3vVPDXD4qi3VLxZVAXMykAFIKocoUiq0BtXdv2XLy7Oo0GRfrP48fHytnyw/exec';
const KEY_FILE = 'C:/Users/kevsc/Desktop/Claude/Credentials - SENSITIVE Do Not Share/hyrox-sim-oct25-admin-key.txt';

function adminKey() {
  const line = fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/).find((l) => /^key=/i.test(l.trim()));
  if (!line) throw new Error('No key= line in the admin key file');
  return line.trim().slice(4);
}

async function post(body) {
  const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ type: 'res27' }, body)), redirect: 'follow' });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'Not JSON: ' + text.slice(0, 300) };
  }
}

/** The live backend's version as [major, minor, patch], from the public health check. */
async function backendVersion() {
  const res = await fetch(URL + '?action=res27Health', { redirect: 'follow' });
  const health = JSON.parse(await res.text());
  return String(health.version || '').split(' ')[0].split('.').map(Number);
}

/** The beta commands and purge-test need backend 1.3.0: on 1.2.0 `beta` does nothing and purge-test would clear every Test account. */
async function needBeta() {
  const v = await backendVersion();
  if (!(v[0] > 1 || (v[0] === 1 && v[1] >= 3))) throw new Error('the live backend is ' + v.join('.') + '; this command needs 1.3.0 or later (deploy first)');
}

function realDay(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  const key = adminKey();
  let out;
  if (cmd === 'setup') {
    const welcome = process.argv.find((x) => x.startsWith('--welcome='));
    const settings = welcome ? { welcome_email: welcome.endsWith('true') } : undefined;
    out = await post({ action: 'adminSetup', key, settings });
  } else if (cmd === 'setting') {
    if (!a || b === undefined) throw new Error('setting needs a key and a value (use "" to clear one)');
    let value = b;
    if (/^(true|false)$/i.test(value)) value = /true/i.test(value);
    out = await post({ action: 'adminSetup', key, settings: { [a]: value } });
  } else if (cmd === 'seed-days') {
    const full = path.join(__dirname, '..', 'content', 'private', 'days-2027-full.json');
    const days = JSON.parse(fs.readFileSync(fs.existsSync(full) ? full : path.join(__dirname, '..', 'content', 'days-2027.json'), 'utf8'));
    out = await post({ action: 'adminSeedDays', key, days, overwrite: process.argv.includes('--overwrite') });
  } else if (cmd === 'summary') {
    out = await post({ action: 'adminSummary', key });
  } else if (cmd === 'set-type') {
    out = await post({ action: 'adminSetType', key, email: a, participantType: b });
  } else if (cmd === 'purge-tests') {
    out = await post({ action: 'adminPurgeTests', key });
  } else if (cmd === 'purge-test') {
    if (!a) throw new Error('purge-test needs an email');
    await needBeta();
    out = await post({ action: 'adminPurgeTests', key, email: a });
  } else if (cmd === 'beta') {
    if (!a || (a !== 'off' && !realDay(a))) throw new Error('beta needs a real start date (yyyy-mm-dd) or off');
    if (b && !(Number.isInteger(Number(b)) && Number(b) >= 1 && Number(b) <= 42)) throw new Error('beta days must be a whole number from 1 to 42');
    await needBeta();
    const settings = { beta_start: a === 'off' ? '' : a };
    if (b) settings.beta_days = Number(b);
    out = await post({ action: 'adminSetup', key, settings });
    // What the app now says (the settings cache can take up to a minute to catch up).
    const cfg = await post({ action: 'config' });
    out = { ok: out.ok, error: out.error, beta: cfg.config ? cfg.config.beta : cfg.error };
    if (a !== 'off' && out.ok && !out.beta) out.note = 'beta_start is set, but the beta is not open (it may already be over, or the settings cache is still a minute old)';
  } else {
    throw new Error('unknown command ' + cmd);
  }
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => {
  console.error('FAILED', e.message);
  process.exit(1);
});
