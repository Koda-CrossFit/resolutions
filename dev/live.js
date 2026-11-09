'use strict';

/**
 * Admin calls against the LIVE backend (the hyrox web app). The admin key is read from the
 * credentials folder and never printed.
 *   node dev/live.js setup [--welcome=false|true]
 *   node dev/live.js seed-days [--overwrite]          (content/days-2027.json → Days tab)
 *   node dev/live.js summary
 *   node dev/live.js set-type <email> <Member|Remote|Test>
 *   node dev/live.js purge-tests
 *   node dev/live.js setting <key> <value>            (one Settings value, via adminSetup)
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

(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  const key = adminKey();
  let out;
  if (cmd === 'setup') {
    const welcome = process.argv.find((x) => x.startsWith('--welcome='));
    const settings = welcome ? { welcome_email: welcome.endsWith('true') } : undefined;
    out = await post({ action: 'adminSetup', key, settings });
  } else if (cmd === 'setting') {
    let value = b;
    if (/^(true|false)$/i.test(value)) value = /true/i.test(value);
    out = await post({ action: 'adminSetup', key, settings: { [a]: value } });
  } else if (cmd === 'seed-days') {
    const days = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'days-2027.json'), 'utf8'));
    out = await post({ action: 'adminSeedDays', key, days, overwrite: process.argv.includes('--overwrite') });
  } else if (cmd === 'summary') {
    out = await post({ action: 'adminSummary', key });
  } else if (cmd === 'set-type') {
    out = await post({ action: 'adminSetType', key, email: a, participantType: b });
  } else if (cmd === 'purge-tests') {
    out = await post({ action: 'adminPurgeTests', key });
  } else {
    throw new Error('unknown command ' + cmd);
  }
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => {
  console.error('FAILED', e.message);
  process.exit(1);
});
