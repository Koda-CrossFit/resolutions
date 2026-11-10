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
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, '01-landing.png'), fullPage: true });
  const sizes = await page.evaluate(() => {
    const px = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize);
    return { date: px('.l-date'), signin: px('.l-signin-line'), callout: px('.l-callout'), callsub: px('.l-callsub') };
  });
  check('landing: big dates, big sign-in line, callouts bigger than the line under them', sizes.date >= 30 && sizes.signin >= 22 && sizes.callout > sizes.callsub * 2, JSON.stringify(sizes));
  const landing = await page.textContent('.landing');
  check('landing copy: Community step and the Support and guidance perk',
    /Community/.test(landing) && /Use the Koda community for motivation and accountability/.test(landing) && /Support and guidance/.test(landing) && /Get matched up with a coach for support and guidance throughout the challenge/.test(landing));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('landing fits a phone with no sideways scroll', overflow <= 0, 'overflow ' + overflow + 'px');
  await page.click('[data-type="remote"]');
  await page.click('[data-method="venmo"]');
  const venmo = await page.getAttribute('.pay-detail a', 'href');
  check('Venmo button is prefilled with amount and note', /txn=pay/.test(venmo) && /amount=99/.test(venmo) && /note=Koda/.test(venmo), venmo);
  await page.screenshot({ path: path.join(OUT, '02-payment.png') });
  await page.click('[data-act="next"]');
  await page.waitForSelector('[data-field="first"]');
  check('the About page says we keep you signed in on this device', /We’ll keep you signed in on this device\./.test(await page.textContent('.flow-body')));
  await page.fill('[data-field="first"]', 'Taylor');
  await page.fill('[data-field="last"]', 'Brooks');
  await page.fill('[data-field="email"]', 'taylor.e2e@example.com');
  await page.fill('[data-field="password"]', 'koda2027');
  await page.click('[data-shirt="tank"]');
  await page.click('[data-size="M"]');
  await page.click('[data-act="next"]');
  await page.click('[data-goal="fatloss"]');
  await page.click('[data-act="next"]');
  // Habits: every one needs a Yes or No; the recommended three start on Yes.
  await page.waitForSelector('[data-act="track"]');
  const trackText = await page.textContent('.flow-body');
  check('habits page wording: Koda Workout first, Skill work, Mobility line',
    /Koda Workout, Run, Bike/.test(trackText) && /Skill work/.test(trackText) && !/CF skill/i.test(trackText) && /Focused improvement in one area/.test(trackText) && /Daily protein minimum/.test(trackText) && /Cold plunge, sauna/.test(trackText), '');
  await page.click('[data-act="next"]');
  await wait(300);
  const missing = await page.$$eval('.track.is-missing', (els) => els.map((e) => e.dataset.track));
  check('Continue is blocked until every habit has a Yes or No', missing.length === 7 && !missing.some((m) => ['nutrition', 'workout', 'sleep'].includes(m)) && /track/.test(page.url()), missing.join(','));
  for (const id of ['hydration', 'finishers', 'mobility']) await page.click(`[data-act="track"][data-id="${id}"][data-val="1"]`);
  for (const id of ['protein', 'skill', 'recovery']) await page.click(`[data-act="track"][data-id="${id}"][data-val="0"]`);
  await page.click('[data-act="track"][data-id="other"][data-val="1"]');
  await page.waitForSelector('[data-field="other.0"]');
  await page.click('[data-act="next"]');
  await wait(300);
  check('Other needs its habit typed in', /track/.test(page.url()) && (await page.$('[data-field="other.0"].is-invalid')) !== null);
  await page.fill('[data-field="other.0"]', 'Read 10 pages');
  await page.screenshot({ path: path.join(OUT, '02b-habits.png'), fullPage: true });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.click('[data-act="next"]');
  await wait(200);
  const scrollY = await page.evaluate(() => window.scrollY);
  check('a new sign-up step opens at the top', scrollY === 0, 'scrollY=' + scrollY);
  const plans = await page.$$eval('[data-act="plan"]', (els) => els.map((e) => e.dataset.plan));
  check('Macros is the second nutrition plan', plans[0] === 'recommended' && plans[1] === 'macros', plans.join(','));
  const fins = await page.$$eval('[data-act="fin"]', (els) => els.map((e) => e.dataset.val));
  check('finisher choices are 1, 2 or 3 a week', fins.join(',') === '1,2,3', fins.join(','));
  check('no Other card on the details page (it moved to the habits page)', !/Your other habits/.test(await page.textContent('.flow-body')));
  await page.click('[data-plan="recommended"]');
  await page.click('[data-act="fin"][data-val="3"]');
  await page.fill('[data-field="bodyweight"]', '170');
  await page.fill('[data-field="mobility"]', 'Hips');
  await page.screenshot({ path: path.join(OUT, '02c-details.png'), fullPage: true });
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
  await page.waitForSelector('.review-sec');
  const review = await page.textContent('.flow-body');
  check('Review: no consent checkbox, the Other habit is listed', (await page.$('input[type="checkbox"]')) === null && !/I understand this is a fitness/.test(review) && /Read 10 pages/.test(review) && /Finishers 3\/week/.test(review));
  await page.screenshot({ path: path.join(OUT, '02d-review.png'), fullPage: true });
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
  check('Today shows a score out of 10', /out of 10/.test(await page.textContent('#dayHero')));

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

  // ---------------------------------------------------------------- finishers on the last day of a week
  // Sunday Jan 31 (Day 14), goal 2 a week, one finisher logged Friday: the app and the sheet must agree.
  await get('/dev/time?set=' + encodeURIComponent('2027-01-31T19:00:00-07:00'));
  const api = (body) => fetch(BASE + '/api', { method: 'POST', body: JSON.stringify(Object.assign({ type: 'res27' }, body)) }).then((r) => r.json());
  const fin = await api({ action: 'register', memberType: 'member', first: 'Fin', last: 'Isher', email: 'fin@koda.test', password: 'koda2027', shirt: 'tee', size: 'M', setup: { goal: 'performance', track: { workout: true, finishers: true }, finishersPerWeek: 2, coaches: [] } });
  check('finisher tester signs up', fin.ok, fin.error);
  const friday = await api({ action: 'save', token: fin.token, date: '2027-01-29', answers: { video: 1, workout: 1, finisher: 1 } });
  check('Friday finisher saved', friday.ok, friday.error);
  const c4 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p4 = await c4.newPage();
  p4.on('pageerror', (e) => errors.push(e.message));
  await p4.goto(BASE + '/dev/as?email=fin%40koda.test&password=koda2027&to=' + encodeURIComponent('#/today'));
  await p4.waitForSelector('#checklistCard .ci');
  await wait(600);
  let finText = await p4.textContent('#checklistCard');
  check('Sunday says the missed finisher counts against today', /Finishers this week: 1 of 2\. The one you missed counts against today’s score/.test(finText), finText.slice(0, 200));
  await p4.click('[data-act="answer"][data-key="video"][data-val="1"]');
  await p4.click('[data-act="answer"][data-key="workout"][data-val="1"]');
  await wait(1800);
  let ring = (await p4.textContent('#dayHero .ring .pct')).trim();
  let sunday = (await get('/dev/rows?tab=Check-ins')).filter((r) => r.Name === 'Fin Isher' && r.Date === '2027-01-31');
  // video 1 + workout 2 done, plus 1 missed finisher on the list: 3 of 4 = 7.5
  check('app and sheet agree on Sunday with a missed finisher (7.5)', ring === '7.5' && sunday.length === 1 && Number(sunday[0].Score) === 7.5, ring + ' vs ' + (sunday[0] && sunday[0].Score));
  await p4.screenshot({ path: path.join(OUT, '05-sunday-missed-finisher.png'), fullPage: true });
  await p4.click('[data-act="answer"][data-key="finisher"][data-val="1"]');
  await wait(1800);
  ring = (await p4.textContent('#dayHero .ring .pct')).trim();
  finText = await p4.textContent('#checklistCard');
  sunday = (await get('/dev/rows?tab=Check-ins')).filter((r) => r.Name === 'Fin Isher' && r.Date === '2027-01-31');
  check('hitting the weekly goal makes Sunday a 10, in the app and the sheet', ring === '10' && !/Finishers this week/.test(finText) && /Perfect day/.test(finText) && Number(sunday[0].Score) === 10, ring + ' / ' + (sunday[0] && sunday[0].Score));
  await c4.close();
  await get('/dev/time?set=' + encodeURIComponent('2027-01-27T19:30:00-07:00'));

  // ---------------------------------------------------------------- review fixes (11/10)
  const c5 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p5 = await c5.newPage();
  p5.on('pageerror', (e) => errors.push(e.message));
  // Profile > Daily checklist: turning protein on and tapping Save brings the missing goal into view.
  await p5.goto(BASE + '/dev/as?email=taylor.e2e%40example.com&password=koda2027&to=' + encodeURIComponent('#/edit/track'));
  await p5.waitForSelector('[data-act="track"][data-id="protein"][data-val="1"]');
  await p5.click('[data-act="track"][data-id="protein"][data-val="1"]');
  await p5.click('[data-act="save-edit"]');
  await wait(900);
  const inView = await p5.evaluate(() => {
    const el = document.querySelector('[data-field="proteinG"].is-invalid');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  });
  check('Profile Save scrolls to the missing protein goal', inView);
  // A sign-up left half-done in the first version: its optional habits need an answer again.
  await p5.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/'));
  await p5.waitForSelector('[data-type="member"]');
  await p5.evaluate(() => localStorage.setItem('res27.draft', JSON.stringify({
    memberType: 'member', first: 'Old', last: 'Draft', email: 'old@example.com', shirt: 'tee', size: 'M', goal: 'health',
    track: { nutrition: true, workout: true, sleep: true, finishers: true, hydration: false, skill: false, mobility: false, other: false },
    sleepHours: 6, finishersPerWeek: 5, other: ['a', 'b'], coaches: [], agree: true,
  })));
  await p5.goto(BASE + '/?restored=1#/join/track'); // a full load, so the app starts from the saved draft
  await p5.waitForSelector('[data-act="track"]');
  await p5.click('[data-act="next"]');
  await wait(400);
  const oldMissing = await p5.$$eval('.track.is-missing', (els) => els.map((e) => e.dataset.track));
  const needText = await p5.$$eval('.track.is-missing .t-need', (els) => els.length);
  check('an old saved sign-up asks again about the optional habits, with "Choose Yes or No" on each', oldMissing.join(',') === 'protein,hydration,skill,mobility,recovery,other' && needText === 6, oldMissing.join(',') + ' / ' + needText);
  await c5.close();
  // A very narrow phone (or zoomed text): the dates wrap instead of losing the year.
  const c6 = await browser.newContext({ viewport: { width: 300, height: 700 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p6 = await c6.newPage();
  await p6.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/'));
  await p6.waitForSelector('.l-date');
  await p6.evaluate(() => document.fonts.ready);
  const narrow = await p6.evaluate(() => {
    const d = document.querySelector('.l-date').getBoundingClientRect();
    return { right: Math.round(d.right), width: window.innerWidth, overflow: document.documentElement.scrollWidth - window.innerWidth, text: document.querySelector('.l-date').textContent };
  });
  check('at 300px the date line wraps and keeps the year', narrow.right <= narrow.width && narrow.overflow <= 0 && /2027/.test(narrow.text), JSON.stringify(narrow));
  await p6.screenshot({ path: path.join(OUT, '01b-landing-300px.png') });
  await c6.close();

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
