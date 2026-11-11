'use strict';

/**
 * Preloaded (node -r) into every dev/live.js run in tests/endbeta-cli.js: requests can only go to
 * this computer, and the real admin key file can't be read. So even if live.js ever got its
 * test-server checks wrong, a test run could never reach the live backend or send it the key.
 */

const fs = require('node:fs');

const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => {
  const host = new URL(String(url)).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return Promise.reject(new Error('local-only-guard: blocked a request to ' + host));
  return realFetch(url, opts);
};

const realRead = fs.readFileSync;
fs.readFileSync = function (file) {
  if (/Credentials - SENSITIVE/i.test(String(file))) throw new Error('local-only-guard: blocked reading the credentials folder');
  return realRead.apply(fs, arguments);
};
