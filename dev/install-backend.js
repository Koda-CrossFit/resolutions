'use strict';

/**
 * Copies apps-script/Resolutions27.js into the hyrox Apps Script folder and adds the two
 * routing lines to its Code.js (once). Does not push: run clasp yourself afterwards.
 *   node dev/install-backend.js [--check]
 */

const fs = require('node:fs');
const path = require('node:path');

const HYROX = 'C:/Users/kevsc/Desktop/Claude/hyrox-simulation-signup/apps-script';
const SRC = path.join(__dirname, '..', 'apps-script', 'Resolutions27.js');
const check = process.argv.includes('--check');

const raw = fs.readFileSync(path.join(HYROX, 'Code.js'), 'utf8');
const CRLF = raw.indexOf('\r\n') >= 0;
const code = raw.split('\r\n').join('\n');
let next = code;

const POST_ANCHOR = '    if (data.type === "friendsday") {\n      return handleFriendsday(data);\n    }\n';
const POST_ROUTE = POST_ANCHOR +
  '\n    // Koda Resolutions 2027 member app (koda-crossfit.github.io/resolutions) \u2014 type:"res27",\n' +
  '    // lives in Resolutions27.js (sign-in, intake, daily check-ins; its own spreadsheet).\n' +
  '    if (data.type === "res27") {\n      return res27Post(data);\n    }\n';
const GET_ANCHOR = '  if (action === "friendsdayList") {\n    return friendsdayGet();  // public: the Friendsday page shows every name anyway\n  }\n';
const GET_ROUTE = GET_ANCHOR +
  '  if (action && action.indexOf("res27") === 0) {\n    return res27Get(action, e);  // public health check only; everything else is a POST\n  }\n';

if (!next.includes('res27Post(data)')) {
  if (!next.includes(POST_ANCHOR)) throw new Error('doPost anchor not found in Code.js');
  next = next.replace(POST_ANCHOR, POST_ROUTE);
}
if (!next.includes('res27Get(action, e)')) {
  if (!next.includes(GET_ANCHOR)) throw new Error('doGet anchor not found in Code.js');
  next = next.replace(GET_ANCHOR, GET_ROUTE);
}

const srcText = fs.readFileSync(SRC, 'utf8');
const destFile = path.join(HYROX, 'Resolutions27.js');
const same = fs.existsSync(destFile) && fs.readFileSync(destFile, 'utf8') === srcText;

if (check) {
  console.log(JSON.stringify({ codeChanges: next !== code, backendUpToDate: same }));
  process.exit(0);
}
if (next !== code) fs.writeFileSync(path.join(HYROX, 'Code.js'), CRLF ? next.split('\n').join('\r\n') : next);
if (!same) fs.writeFileSync(destFile, srcText);
console.log(JSON.stringify({ codeUpdated: next !== code, backendCopied: !same }));
