'use strict';

/**
 * Browser walkthrough against the local dev server (node dev/server.js must be running on 8790).
 *   node tests/e2e.js [outDir]
 * Uses Playwright from Desktop\Claude\sugarwod-skill. Resets the dev world, so don't run it
 * while someone else is using the dev server.
 */

const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('C:/Users/kevsc/Desktop/Claude/sugarwod-skill/node_modules/playwright');

const BASE = 'http://localhost:8790';
const OUT = process.argv[2] || path.join(__dirname, '..', 'dev', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}
const get = (p) => fetch(BASE + p).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await get('/dev/reset?demo=1&at=' + encodeURIComponent('2027-01-27T19:30:00-07:00'));
  const browser = await chromium.launch();
  const errors = [];

  // ---------------------------------------------------------------- sign-up as a remote participant
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|fonts\.g|ytimg/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/'));
  await page.waitForSelector('[data-type="remote"]');
  await page.screenshot({ path: path.join(OUT, '01-landing.png') });
  await page.click('[data-type="remote"]');
  await page.click('[data-method="venmo"]');
  const venmo = await page.getAttribute('.pay-detail a', 'href');
  check('Venmo button is prefilled with amount and note', /txn=pay/.test(venmo) && /amount=99/.test(venmo) && /note=Koda/.test(venmo), venmo);
  await page.screenshot({ path: path.join(OUT, '02-payment.png') });
  await page.click('[data-act="next"]');
  await page.fill('[data-field="first"]', 'Taylor');
  await page.fill('[data-field="last"]', 'Brooks');
  await page.fill('[data-field="email"]', 'taylor.e2e@example.com');
  await page.fill('[data-field="password"]', 'koda2027');
  await page.click('[data-shirt="tank"]');
  await page.click('[data-size="M"]');
  await page.click('[data-act="next"]');
  await page.click('[data-goal="fatloss"]');
  await page.click('[data-act="next"]');
  await page.click('[data-act="track"][data-id="hydration"][data-val="1"]');
  await page.click('[data-act="track"][data-id="mobility"][data-val="1"]');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.click('[data-act="next"]');
  await wait(200);
  const scrollY = await page.evaluate(() => window.scrollY);
  check('a new sign-up step opens at the top', scrollY === 0, 'scrollY=' + scrollY);
  await page.click('[data-plan="recommended"]');
  await page.fill('[data-field="bodyweight"]', '170');
  await page.fill('[data-field="mobility"]', 'Hips');
  await page.click('[data-act="next"]');
  await page.click('[data-act="coach"][data-name="Maggie"]');
  await page.click('[data-act="next"]');
  // Edit from Review comes straight back.
  await page.click('[data-act="jump"][data-step="goal"]');
  await page.waitForURL((u) => String(u).indexOf('#/join/goal') >= 0);
  await wait(200);
  const label = await page.textContent('[data-act="next"]');
  check('editing from Review offers "Back to review"', /Back to review/.test(label), label);
  await page.click('[data-goal="health"]');
  await page.click('[data-act="next"]');
  check('one tap returns to Review', /#\/join\/review/.test(page.url()), page.url());
  await page.check('[data-field="agree"]');
  await page.click('[data-act="next"]');
  await page.waitForSelector('#sheet', { timeout: 15000 });
  const sheetText = await page.textContent('#sheet');
  check('welcome sheet says the email was sent', /We sent a welcome email/.test(sheetText));
  check('welcome sheet has a Venmo pay button', await page.$('#sheet a[href*="txn=pay"]') !== null);
  await page.screenshot({ path: path.join(OUT, '03-welcome.png') });
  await page.click('[data-act="close-sheet"]');
  await wait(300);
  await page.screenshot({ path: path.join(OUT, '04-today-new.png'), fullPage: true });
  const ci = await page.$$eval('#checklistCard .ci', (els) => els.length);
  check('new member has a checklist on Day 10', ci >= 6, ci + ' items');

  // ---------------------------------------------------------------- patch saves and the on-screen day
  await page.click('[data-act="answer"][data-key="workout"][data-val="1"]');
  await page.click('[data-act="meals-all"]');
  await wait(1500);
  let rows = await get('/dev/rows?tab=Check-ins');
  let mine = rows.filter((r) => r.Name === 'Taylor Brooks');
  check('taps saved to the sheet', mine.length === 1 && /Meals 4\/4/.test(mine[0].Answers) && /Daily workout ✓/.test(mine[0].Answers), mine[0] && mine[0].Answers);
  await page.click('[data-act="answer"][data-key="sleep"][data-val="1"]');
  await page.goto(BASE + '/#/day/2027-01-26');
  await wait(1500);
  const shown = await page.getAttribute('#checklistCard', 'data-date');
  check('a save finishing elsewhere does not repaint another day', shown === '2027-01-26', shown);
  rows = await get('/dev/rows?tab=Check-ins');
  mine = rows.filter((r) => r.Name === 'Taylor Brooks');
  check('the tap made just before leaving still saved', mine.length === 1 && /Slept .*✓/.test(mine[0].Answers), mine[0] && mine[0].Answers);

  // ---------------------------------------------------------------- gaps callout, stale day
  await page.goto(BASE + '/#/today');
  await wait(800);
  const gap = await page.$('a.callout[href^="#/day/"]');
  check('Today offers yesterday when it is not filled in', !!gap);
  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('res27.me'));
    c.loadedDay = '2027-01-08';
    localStorage.setItem('res27.me', JSON.stringify(c));
  });
  let slow = true;
  await page.route('**/api', async (route) => { if (slow) await wait(2500); try { await route.continue(); } catch (e) {} });
  await page.reload();
  await page.waitForSelector('#checklistCard');
  const lockedText = await page.textContent('#checklistCard');
  check('stale data locks the checklist until today arrives', /Updating to today/.test(lockedText));
  slow = false;
  await wait(3500);
  const after = await page.textContent('#checklistCard');
  check('fresh data unlocks it', !/Updating to today/.test(after));
  await ctx.close();

  // ---------------------------------------------------------------- screenshots: demo member, light + dark, phone + desktop
  for (const scheme of ['light', 'dark']) {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
    const p2 = await c2.newPage();
    p2.on('pageerror', (e) => errors.push(e.message));
    for (const [name, hash] of [['today', '#/today'], ['progress', '#/progress'], ['nutrition', '#/nutrition'], ['videos', '#/videos'], ['profile', '#/profile']]) {
      await p2.goto(BASE + '/dev/as?email=demo%40koda.test&password=koda2027&to=' + encodeURIComponent(hash));
      await wait(1200);
      await p2.screenshot({ path: path.join(OUT, `phone-${scheme}-${name}.png`), fullPage: true });
    }
    await c2.close();
  }
  const c3 = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const p3 = await c3.newPage();
  for (const [name, hash] of [['today', '#/today'], ['progress', '#/progress']]) {
    await p3.goto(BASE + '/dev/as?email=demo%40koda.test&password=koda2027&to=' + encodeURIComponent(hash));
    await wait(1200);
    await p3.screenshot({ path: path.join(OUT, `desktop-${name}.png`), fullPage: true });
  }
  await c3.close();
  await browser.close();

  check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Screenshots: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('E2E CRASH', e);
  process.exit(2);
});
