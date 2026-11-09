'use strict';

/**
 * Real phone/desktop screenshots of the local dev app (Playwright, true viewport emulation).
 *   node dev/shot.js --to "#/today" --w 390 --h 844 --out C:\path\shot.png [--dark] [--signed-out]
 *                    [--email demo@koda.test --password koda2027] [--full]
 * Uses the Playwright that ships in Desktop\Claude\sugarwod-skill\node_modules.
 */

const path = require('node:path');
const { chromium } = require('C:/Users/kevsc/Desktop/Claude/sugarwod-skill/node_modules/playwright');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes('--' + name);

(async () => {
  const w = Number(arg('w', 390));
  const h = Number(arg('h', 844));
  const out = path.resolve(arg('out', 'shot.png'));
  const to = arg('to', '#/today');
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: w < 700 ? 2 : 1,
    isMobile: w < 700,
    hasTouch: w < 700,
    colorScheme: flag('dark') ? 'dark' : 'light',
  });
  const page = await context.newPage();
  const base = 'http://localhost:8790';
  if (flag('signed-out')) {
    await page.goto(base + '/dev/blank?to=' + encodeURIComponent(to));
  } else {
    const email = arg('email', 'demo@koda.test');
    const password = arg('password', 'koda2027');
    await page.goto(base + '/dev/as?email=' + encodeURIComponent(email) + '&password=' + encodeURIComponent(password) + '&to=' + encodeURIComponent(to));
  }
  await page.waitForTimeout(1800);
  await page.screenshot({ path: out, fullPage: flag('full') });
  await browser.close();
  console.log('saved ' + out);
})().catch((err) => {
  console.error('FAILED ' + err.message);
  process.exit(1);
});
