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
  check('a member’s Today has no beta practice note', (await page.$('.beta-note')) === null);
  check('Today shows a score out of 10', /out of 10/.test(await page.textContent('#dayHero')));

  // ---------------------------------------------------------------- patch saves and the on-screen day
  await page.click('[data-act="answer"][data-key="workout"][data-val="1"]');
  // Kevin, 11/12: each meal is a big checkbox (no "All on plan").
  const mealsBefore = await page.evaluate(() => ({ boxes: Array.from(document.querySelectorAll('#checklistCard .meal-box')).map((b) => [b.getAttribute('role'), b.getAttribute('aria-checked'), b.textContent.trim(), Math.round(b.getBoundingClientRect().height)]), allOnPlan: !!document.querySelector('[data-act="meals-all"]') }));
  check('meals: four big checkboxes, unchecked, and no "All on plan"', mealsBefore.boxes.length === 4 && mealsBefore.boxes.every((b) => b[0] === 'checkbox' && b[1] === 'false' && b[3] >= 48) && !mealsBefore.allOnPlan && /Breakfast/.test(mealsBefore.boxes[0][2]), JSON.stringify(mealsBefore));
  for (let i = 0; i < 4; i++) {
    await page.click('#checklistCard .meal-box:not(.is-on)');
    await wait(80);
  }
  check('meals: each tap checks its box', (await page.$$eval('#checklistCard .meal-box[aria-checked="true"]', (els) => els.length)) === 4);
  await page.screenshot({ path: path.join(OUT, '04b-meal-checkboxes.png') });
  await wait(1500);
  let rows = await get('/dev/rows?tab=Check-ins');
  let mine = rows.filter((r) => r.Name === 'Taylor Brooks');
  check('taps saved to the sheet', mine.length === 1 && /Meals 4\/4/.test(mine[0].Answers) && /Daily workout ✓/.test(mine[0].Answers), mine[0] && mine[0].Answers);
  // Review 11/12: the four boxes are one labelled group, and unticking leaves no answer (not a 0),
  // so tick + untick puts a meal back exactly as it was.
  const mealGroup = await page.getAttribute('#checklistCard .ci-meals', 'aria-label');
  check('meals: the checkboxes are a labelled group', await page.getAttribute('#checklistCard .ci-meals', 'role') === 'group' && /meals on plan/.test(mealGroup || ''), mealGroup);
  const firstMeal = await page.getAttribute('#checklistCard .meal-box', 'data-key');
  await page.click('#checklistCard .meal-box[data-key="' + firstMeal + '"]');
  await wait(1500);
  const unticked = await page.evaluate((k) => { const c = JSON.parse(localStorage.getItem('res27.me')); const a = (c.me.history[c.me.program.today] || {}).a || {}; return { has: Object.prototype.hasOwnProperty.call(a, k), v: a[k], label: document.querySelector('#checklistCard .save-state') && document.querySelector('#checklistCard .save-state').textContent }; }, firstMeal);
  rows = await get('/dev/rows?tab=Check-ins');
  mine = rows.filter((r) => r.Name === 'Taylor Brooks');
  check('meals: unticking saves no answer for that meal (not a 0), and the sheet counts 3/4', !unticked.has && /Meals 3\/4/.test(mine[0].Answers) && /Saved/.test(unticked.label || ''), JSON.stringify(unticked) + ' ' + (mine[0] && mine[0].Answers));
  await page.click('#checklistCard .meal-box[data-key="' + firstMeal + '"]');
  await wait(1500);
  // Review 11/12: a tap landing while an earlier save is still on its way must read "Saving…", never
  // a red "Not saved" (its save is only scheduled, not failed).
  await get('/dev/slow?ms=1200');
  const states = [];
  const sampler = setInterval(() => { page.textContent('#checklistCard .save-state').then((t) => states.push(t), () => {}); }, 100);
  const mealKeys = await page.$$eval('#checklistCard .meal-box', (els) => els.map((e) => e.dataset.key));
  await page.click('#checklistCard .meal-box[data-key="' + mealKeys[1] + '"]');
  await wait(1500);
  await page.click('#checklistCard .meal-box[data-key="' + mealKeys[2] + '"]');
  await wait(3600);
  clearInterval(sampler);
  await get('/dev/slow?ms=0');
  check('saving: quick taps during a slow save never show "Not saved", and end on "Saved"', states.length > 20 && !states.some((s) => /Not saved/.test(s || '')) && /Saved/.test(states[states.length - 1] || ''), JSON.stringify(Array.from(new Set(states))));
  for (const k of [mealKeys[1], mealKeys[2]]) { await page.click('#checklistCard .meal-box[data-key="' + k + '"]'); await wait(100); }
  await wait(1500);
  // Final review 11/12: flipping one box back to what's already being saved leaves nothing to send;
  // the label must still settle on "Saved" (it used to stay on "Saving…").
  await get('/dev/slow?ms=1200');
  await page.click('#checklistCard .meal-box[data-key="' + mealKeys[3] + '"]'); // untick: its save goes out
  await wait(900);
  await page.click('#checklistCard .meal-box[data-key="' + mealKeys[3] + '"]'); // tick…
  await wait(120);
  await page.click('#checklistCard .meal-box[data-key="' + mealKeys[3] + '"]'); // …and untick again, as being saved
  await wait(3500);
  const settled = await page.textContent('#checklistCard .save-state');
  await get('/dev/slow?ms=0');
  check('saving: flipping a box back to the value being saved still ends on "Saved"', /Saved/.test(settled || ''), settled);
  await page.click('#checklistCard .meal-box[data-key="' + mealKeys[3] + '"]');
  await wait(1500);
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
  const gap = await page.$('#overdueCard a.od-row[href^="#/day/"]');
  check('Today lists the earlier days that are still open and not filled in (Overdue)', !!gap && /Overdue/i.test(await page.textContent('#overdueCard')));
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

  // ---------------------------------------------------------------- the beta test (11/10): started yesterday, 7 days
  // Real clock (the phone and the server must agree on today), Mountain time like the server.
  const dkey = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  const todayKey = dkey(new Date());
  const shift = (key, n) => { const [y, m, d] = key.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n, 12)); return t.toISOString().slice(0, 10); };
  const yesterday = shift(todayKey, -1);
  const longDay = (key) => new Date(key + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  await get('/dev/time?clear=1');
  const ADMINKEY = 'test-admin-key-123';
  const PLAN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'days-2027.json'), 'utf8'))
    .map((d, i) => Object.assign({}, d, { ref: ['nbg1s1gdjJk', 'As3Zpd7XEY8', 'KBOW32PKgfI', 'tscdhnnCIV4', '9C14vwKA9Cs', '_NLEqrDAl4Q', '_szhT8Sieq8'][i] || '' }));
  check('dev world: Days with their 2026 references', (await api({ action: 'adminSeedDays', key: ADMINKEY, days: PLAN, overwrite: true })).ok);
  check('dev world: a beta test that started yesterday', (await api({ action: 'adminSetup', key: ADMINKEY, settings: { beta_start: yesterday, beta_days: 7 } })).ok);
  const c7 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  const b7 = await c7.newPage();
  b7.on('pageerror', (e) => errors.push(e.message));
  b7.on('console', (m) => { if (m.type() === 'error' && !/favicon|fonts\.g|ytimg|youtube/.test(m.text())) errors.push(m.text()); });
  await b7.goto(BASE + '/dev/blank?to=' + encodeURIComponent('?beta=1#/'));
  await b7.waitForSelector('.l-beta');
  await b7.evaluate(() => document.fonts.ready);
  const bland = await b7.evaluate(() => ({ tag: !!document.querySelector('.l-beta-tag'), date: document.querySelector('.l-date').textContent, weeks: document.querySelector('.l-weeks').textContent, note: document.querySelector('.l-beta').textContent, overflow: document.documentElement.scrollWidth - window.innerWidth }));
  const shortDay = (key) => new Date(key + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  check('beta link: the landing page shows the beta dates, 1 week, and says it is practice',
    bland.tag && bland.date.indexOf(shortDay(yesterday)) >= 0 && bland.date.indexOf(shortDay(shift(yesterday, 6))) >= 0 && /1 week/i.test(bland.weeks) && /practice/.test(bland.note) && /deleted when the beta ends/.test(bland.note) && bland.overflow <= 0, JSON.stringify(bland));
  await b7.screenshot({ path: path.join(OUT, 'beta-00-landing.png'), fullPage: true });
  await b7.click('[data-type="remote"]');
  await b7.click('[data-method="venmo"]');
  const payText = await b7.textContent('.flow-body');
  check('beta: the payment step says not to send money and has no Venmo button', /Beta test: don’t send any money/.test(payText) && (await b7.$('.pay-detail a')) === null);
  await b7.click('[data-act="back"]');
  await b7.waitForSelector('[data-type="member"]');
  await b7.click('[data-type="member"]');
  await b7.waitForSelector('[data-field="first"]');
  await b7.fill('[data-field="first"]', 'Kevin');
  await b7.fill('[data-field="last"]', 'Beta');
  await b7.fill('[data-field="email"]', 'beta.e2e@example.com');
  await b7.fill('[data-field="password"]', 'koda2027');
  await b7.click('[data-shirt="tee"]');
  await b7.click('[data-size="L"]');
  await b7.click('[data-act="next"]');
  await b7.click('[data-goal="performance"]');
  await b7.click('[data-act="next"]');
  await b7.waitForSelector('[data-act="track"]');
  for (const id of ['protein', 'hydration', 'finishers', 'skill', 'mobility', 'recovery', 'other']) await b7.click(`[data-act="track"][data-id="${id}"][data-val="0"]`);
  await b7.click('[data-act="next"]');
  await b7.waitForSelector('[data-plan="recommended"]');
  await b7.click('[data-plan="recommended"]');
  await b7.click('[data-act="next"]');
  await b7.waitForSelector('[data-act="coach-none"], [data-act="coach"]');
  await b7.click('[data-act="next"]');
  await b7.waitForSelector('.review-sec');
  await b7.click('[data-act="next"]');
  await b7.waitForSelector('#sheet', { timeout: 15000 });
  const bsheet = await b7.textContent('#sheet');
  check('beta: the welcome sheet says it is the beta, today is Day 2, and beta accounts are deleted', /This is the beta test/.test(bsheet) && /today is Day 2/.test(bsheet) && /beta accounts are deleted when the beta ends/.test(bsheet), bsheet.slice(0, 260));
  await b7.click('[data-act="close-sheet"]');
  await b7.waitForSelector('#overdueCard');
  const bt = await b7.evaluate(() => ({
    pill: document.querySelector('.day-pill').textContent,
    card: document.querySelector('#overdueCard').textContent,
    href: (document.querySelector('#overdueCard a.od-row') || {}).getAttribute ? document.querySelector('#overdueCard a.od-row').getAttribute('href') : '',
    strip: Array.from(document.querySelectorAll('#weekStrip .wk-d')).map((e) => e.className.replace('wk-d ', '')),
    badge: (() => { const b = document.querySelector('.tab [data-od-badge]'); return b && !b.hidden ? b.textContent : ''; })(),
    poster: (document.querySelector('#videoMount .poster') || { getAttribute: () => '' }).getAttribute('style') || '',
    standIn: /Beta: 2026 stand-in video/.test(document.querySelector('#videoMeta').textContent),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }));
  check('beta Today: Day 2 of 7, the beta pill', /Beta · Day 2 of 7/.test(bt.pill), bt.pill);
  // Kevin, 11/11: beta accounts are deleted after the beta, so Today says so every day (above Overdue).
  const bnote = await b7.evaluate(() => {
    const n = document.querySelector('.beta-note'), od = document.querySelector('#overdueCard');
    return n ? { text: n.textContent, beforeOverdue: !!(od && (n.compareDocumentPosition(od) & Node.DOCUMENT_POSITION_FOLLOWING)), cls: n.className } : null;
  });
  check('beta Today: a grey practice-only note on top says beta accounts are deleted, sign up again for Jan 18',
    !!bnote && /practice only/.test(bnote.text) && /deleted when the beta ends/.test(bnote.text) && /sign up again/.test(bnote.text) && /January 18/.test(bnote.text) && bnote.beforeOverdue && /callout-info/.test(bnote.cls), JSON.stringify(bnote));
  // The week stays open until midnight on the first day after it (Kevin, 11/11): here that's yesterday's weekday, next week.
  check('beta Today: yesterday (Day 1) is Overdue, not filled in, open until ' + longDay(yesterday) + ' at midnight',
    /Yesterday · Day 1/.test(bt.card) && /Not filled in yet/.test(bt.card) && bt.card.indexOf('You can fill it in until ' + longDay(yesterday) + ' at midnight') >= 0 && bt.href === '#/day/' + yesterday, bt.card);
  check('beta Today: the week strip marks Day 1 overdue and today, the rest coming up', bt.strip[0] === 'is-overdue' && /is-today/.test(bt.strip[1]) && /is-sel/.test(bt.strip[1]) && bt.strip.slice(2).every((c) => c === 'is-upcoming'), bt.strip.join(' | '));
  check('beta Today: the Today tab shows 1 overdue', bt.badge === '1', bt.badge);
  check('beta Today: Day 2 plays its 2026 stand-in video, marked as one', /As3Zpd7XEY8/.test(bt.poster) && bt.standIn, bt.poster);
  check('beta Today: fits the phone', bt.overflow <= 0, 'overflow ' + bt.overflow);
  await b7.screenshot({ path: path.join(OUT, 'beta-01-today-overdue.png'), fullPage: true });
  // Today's own page (the Videos tab and the calendar link there) is the same Today screen, card included.
  await b7.goto(BASE + '/#/videos');
  await b7.waitForSelector('.vrow');
  await b7.goto(BASE + '/#/day/' + todayKey);
  await b7.waitForSelector('#dayHero');
  await wait(300);
  check('beta: today’s page opened from Videos still shows the Overdue card and no back link', !!(await b7.$('#overdueCard')) && !(await b7.$('a.btn-ghost[href="#/today"]')));
  await b7.goto(BASE + '/#/today');
  await b7.waitForSelector('#overdueCard');
  check('beta: …and back on Today it is still there', !!(await b7.$('#overdueCard')));
  // Leaderboard (was Progress): no teams yet, then two beta teams.
  const tabs = await b7.$$eval('.tabbar .tab', (els) => els.map((e) => e.textContent.trim()));
  check('the second tab is now Leaderboard', tabs[1] === 'Leaderboard', tabs.join(','));
  await b7.goto(BASE + '/#/progress');
  await b7.waitForSelector('.lb-you');
  await b7.waitForSelector('.lb-empty, .lb-row');
  const lb0 = await b7.evaluate(() => ({ title: document.querySelector('.page-title').textContent, you: document.querySelector('.lb-you').textContent, board: document.querySelector('.lb-board').textContent }));
  check('old #/progress links open the Leaderboard; no teams yet says so', lb0.title === 'Leaderboard' && /Beta/.test(lb0.you) && /day streak/.test(lb0.you) && /Teams aren’t set yet/.test(lb0.board), JSON.stringify(lb0).slice(0, 300));
  // Two teams of 3 and a team of 1 (no score: it would be that person's own).
  const tester = async (first, team) => {
    const r = await api({ action: 'register', memberType: 'member', first, last: 'Mate', email: first.toLowerCase() + '.beta@example.com', password: 'koda2027', shirt: 'tee', size: 'M', setup: { goal: 'health', track: { nutrition: true, workout: true, sleep: true }, plan: 'recommended', sleepHours: 7, coaches: [] }, beta: true });
    await get('/dev/cell?email=' + encodeURIComponent(first.toLowerCase() + '.beta@example.com') + '&col=Team&value=' + encodeURIComponent(team));
    return r;
  };
  await get('/dev/cell?email=' + encodeURIComponent('beta.e2e@example.com') + '&col=Team&value=Iron');
  const annB = await tester('Ann', 'Iron');
  await tester('Bo', 'team iron');
  const tessB = await tester('Tess', 'Steel');
  await tester('Cy', 'Steel');
  await tester('Dot', 'Steel');
  await tester('Eve', 'Bronze');
  await api({ action: 'save', token: annB.token, date: yesterday, answers: { video: 1, workout: 1, sleep: 1 }, patch: true });
  await api({ action: 'save', token: tessB.token, date: todayKey, answers: { video: 1 }, patch: true });
  await b7.reload();
  await b7.waitForSelector('.lb-row');
  const lb1 = await b7.evaluate(() => ({
    rows: Array.from(document.querySelectorAll('.lb-row')).map((r) => ({ text: r.textContent, mine: r.classList.contains('is-mine'), rank: r.querySelector('.lb-rank').textContent })),
    you: document.querySelector('.lb-you').textContent,
    stats: document.querySelectorAll('.lb-stats > div').length,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }));
  const allText = JSON.stringify(lb1);
  check('Leaderboard: Iron (with "team iron") 1st, Steel 2nd, yours marked, your place and 4 numbers',
    lb1.rows.length === 3 && /Team Iron/.test(lb1.rows[0].text) && lb1.rows[0].rank === '1' && lb1.rows[0].mine && /3 people/.test(lb1.rows[0].text) && /Team Steel/.test(lb1.rows[1].text) && lb1.rows[1].rank === '2' &&
    /1st of 2 teams/.test(lb1.you) && lb1.stats === 4 && lb1.overflow <= 0, allText.slice(0, 500));
  check('Leaderboard: a team of 1 is listed without a score or a rank', /Team Bronze/.test(lb1.rows[2].text) && /Score shows once the team has 3 people/.test(lb1.rows[2].text) && lb1.rows[2].rank === '', lb1.rows[2] && lb1.rows[2].text);
  check('Leaderboard: no one else’s name is shown', !/Ann|Tess|Mate|Eve/.test(allText));
  await b7.click('[data-act="board-view"][data-view="week"]');
  await b7.waitForSelector('.lb-range');
  check('Leaderboard: the This week view shows the week’s dates', /Week 1/.test(await b7.textContent('.lb-range')));
  await b7.screenshot({ path: path.join(OUT, 'beta-02-leaderboard.png'), fullPage: true });
  await b7.goto(BASE + '/#/today');
  await b7.waitForSelector('#overdueCard a.od-row');
  await b7.click('#overdueCard a.od-row');
  await b7.waitForSelector('#dayNote .od-note');
  check('beta: tapping it opens Day 1 with an Overdue note', b7.url().endsWith('#/day/' + yesterday) && /Overdue\./.test(await b7.textContent('#dayNote')) && /Day 1/.test(await b7.textContent('#dayHero')));
  check('beta: a past day’s own page has no practice note (Today has it)', (await b7.$('.beta-note')) === null);
  await b7.screenshot({ path: path.join(OUT, 'beta-03-day1-overdue.png'), fullPage: true });
  const keys = await b7.$$eval('#checklistCard [data-act="answer"][data-val="1"]', (els) => els.map((e) => e.dataset.key));
  for (let i = 0; i < 4; i++) {
    await b7.click('#checklistCard .meal-box:not(.is-on)');
    await wait(60);
  }
  await wait(150);
  check('beta: halfway through, the note counts the habits still open', /still need/.test(await b7.textContent('#dayNote')), await b7.textContent('#dayNote'));
  for (const k of keys) {
    await b7.click(`#checklistCard [data-act="answer"][data-key="${k}"][data-val="1"]`);
    await wait(60);
  }
  const caught = await b7.evaluate(() => ({
    toast: (document.querySelector('#toastWrap') || {}).textContent || '',
    note: document.querySelector('#dayNote').textContent,
    chip: document.querySelector('#weekStrip .wk-d').className,
    badge: (() => { const b = document.querySelector('.tab [data-od-badge]'); return b && !b.hidden ? b.textContent : ''; })(),
  }));
  check('beta: answering the last habit says Yesterday is caught up, clears the note, strip and badge', /Yesterday is all caught up/.test(caught.toast) && caught.note === '' && /is-done/.test(caught.chip) && caught.badge === '', JSON.stringify(caught));
  await wait(1800);
  const bRows = (await get('/dev/rows?tab=Check-ins')).filter((r) => r.Name === 'Kevin Beta');
  const bPeople = (await get('/dev/rows?tab=Participants')).filter((r) => r.Email === 'beta.e2e@example.com');
  check('beta: Day 1 saved to the sheet on its real date, as a Test account', bRows.length === 1 && bRows[0].Date === yesterday && Number(bRows[0].Day) === 1 && bPeople.length === 1 && bPeople[0].Type === 'Test' && /Beta test sign-up/.test(bPeople[0].Notes), JSON.stringify(bRows[0] || {}));
  await b7.screenshot({ path: path.join(OUT, 'beta-04-day1-caught-up.png'), fullPage: true });
  await b7.goto(BASE + '/#/today');
  await b7.waitForSelector('#weekStrip');
  check('beta: back on Today the Overdue card is gone', (await b7.$('#overdueCard')) === null);
  await b7.screenshot({ path: path.join(OUT, 'beta-05-today-after.png'), fullPage: true });
  // Dark mode and desktop, once each.
  const c8 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Denver', colorScheme: 'dark' });
  await api({ action: 'register', memberType: 'member', first: 'Dark', last: 'Mode', email: 'dark.beta@example.com', password: 'koda2027', shirt: 'tee', size: 'M', setup: { goal: 'health', track: { nutrition: true, workout: true, sleep: true }, plan: 'recommended', sleepHours: 7, coaches: [] }, beta: true });
  const p8 = await c8.newPage();
  p8.on('pageerror', (e) => errors.push(e.message));
  await p8.goto(BASE + '/dev/as?email=dark.beta%40example.com&password=koda2027&to=' + encodeURIComponent('#/today'));
  await p8.waitForSelector('#overdueCard');
  await wait(400);
  await p8.screenshot({ path: path.join(OUT, 'beta-06-today-dark.png'), fullPage: true });
  await c8.close();
  const c9 = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: 'America/Denver' });
  const p9 = await c9.newPage();
  p9.on('pageerror', (e) => errors.push(e.message));
  await p9.goto(BASE + '/dev/as?email=dark.beta%40example.com&password=koda2027&to=' + encodeURIComponent('#/today'));
  await p9.waitForSelector('#overdueCard');
  await wait(400);
  check('beta desktop: the sidebar Today item shows the overdue count', (await p9.textContent('.nav-item.is-on [data-od-badge]')).trim() === '1');
  await p9.screenshot({ path: path.join(OUT, 'beta-07-desktop.png'), fullPage: true });
  const side = await p9.$$eval('.sidebar .nav-item', (els) => els.map((e) => e.textContent.trim()));
  await p9.click('.sidebar a.nav-item[href="#/faqs"]');
  await p9.waitForSelector('.ask-card');
  const faqDesk = await p9.evaluate(() => ({ on: (document.querySelector('.sidebar .nav-item.is-on') || {}).textContent, back: getComputedStyle(document.querySelector('.phone-only')).display }));
  check('desktop sidebar: FAQs is its own item (before Profile), highlighted on its page, no "‹ Profile" link', side.join(',') === 'Today1,Leaderboard,Nutrition,Koda Cookbook,Videos,FAQs,Profile' && /FAQs/.test(faqDesk.on) && faqDesk.back === 'none', side.join(',') + ' ' + JSON.stringify(faqDesk));
  await p9.screenshot({ path: path.join(OUT, 'faqs-desktop.png'), fullPage: true });
  await c9.close();
  // A phone without the beta link (e.g. a home-screen app opened first) can still join the beta.
  const c10 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  const p10 = await c10.newPage();
  p10.on('pageerror', (e) => errors.push(e.message));
  await p10.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/'));
  await p10.waitForSelector('[data-act="join-beta"]');
  check('real landing during a beta: no beta tag, the real dates, and a "Join the beta" link', !(await p10.$('.l-beta-tag')) && /Jan 18/.test(await p10.textContent('.l-date')));
  await p10.click('[data-act="join-beta"]');
  await p10.waitForSelector('.l-beta-tag');
  check('tapping "Join the beta" switches the landing page to the beta', /Nov/.test(await p10.textContent('.l-date')) && !(await p10.$('[data-act="join-beta"]')));
  await c10.close();
  // beta_everyone (Kevin, 11/11): testers came in on the plain link and landed on January. With it on,
  // the plain link shows the beta, and signing up there puts them on it, daily checklist and all.
  check('dev world: beta_everyone on', (await api({ action: 'adminSetup', key: ADMINKEY, settings: { beta_everyone: true } })).ok);
  const c10e = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  const p10e = await c10e.newPage();
  p10e.on('pageerror', (e) => errors.push(e.message));
  await p10e.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/'));
  await p10e.waitForSelector('.l-beta');
  check('beta_everyone: the plain link shows the beta (tag, its dates, practice note), no "Join the beta" link',
    !!(await p10e.$('.l-beta-tag')) && (await p10e.textContent('.l-date')).indexOf(shortDay(yesterday)) >= 0 && /practice/.test(await p10e.textContent('.l-beta')) && !(await p10e.$('[data-act="join-beta"]')));
  await p10e.click('[data-type="member"]');
  await p10e.waitForSelector('[data-field="first"]');
  await p10e.fill('[data-field="first"]', 'Plain');
  await p10e.fill('[data-field="last"]', 'Link');
  await p10e.fill('[data-field="email"]', 'plain.link@example.com');
  await p10e.fill('[data-field="password"]', 'koda2027');
  await p10e.click('[data-shirt="tee"]');
  await p10e.click('[data-size="L"]');
  await p10e.click('[data-act="next"]');
  await p10e.click('[data-goal="health"]');
  await p10e.click('[data-act="next"]');
  await p10e.waitForSelector('[data-act="track"]');
  for (const id of ['protein', 'hydration', 'finishers', 'skill', 'mobility', 'recovery', 'other']) await p10e.click(`[data-act="track"][data-id="${id}"][data-val="0"]`);
  await p10e.click('[data-act="next"]');
  await p10e.waitForSelector('[data-plan="recommended"]');
  await p10e.click('[data-plan="recommended"]');
  await p10e.click('[data-act="next"]');
  await p10e.waitForSelector('[data-act="coach-none"], [data-act="coach"]');
  await p10e.click('[data-act="next"]');
  await p10e.waitForSelector('.review-sec');
  await p10e.click('[data-act="next"]');
  await p10e.waitForSelector('#sheet', { timeout: 15000 });
  check('beta_everyone: the welcome sheet says it is the beta', /This is the beta test/.test(await p10e.textContent('#sheet')));
  await p10e.click('[data-act="close-sheet"]');
  await p10e.waitForSelector('#overdueCard');
  const plainPerson = (await get('/dev/rows?tab=Participants')).find((r) => r.Email === 'plain.link@example.com') || {};
  check('beta_everyone: a plain-link sign-up gets the beta Today (Day 2 of 7, yesterday Overdue) as a Test account',
    /Beta · Day 2 of 7/.test(await p10e.textContent('.day-pill')) && (await p10e.$$('#checklistCard .ci')).length >= 4 && plainPerson.Type === 'Test' && /Beta test sign-up/.test(plainPerson.Notes || ''), JSON.stringify({ type: plainPerson.Type, notes: plainPerson.Notes }));
  await p10e.screenshot({ path: path.join(OUT, 'beta-08-plain-link-today.png'), fullPage: true });
  await c10e.close();
  // A phone whose midnight comes before Mountain time's (11/11): on the beta's last day the server
  // still has it open (and makes the sign-up a beta one), so the page must show the beta too, not
  // the real $99 one. A fresh answer from the server is trusted over the phone's date.
  check('dev world: a beta whose last day is today, everyone joins', (await api({ action: 'adminSetup', key: ADMINKEY, settings: { beta_start: shift(todayKey, -6), beta_everyone: true } })).ok);
  const kiriToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Kiritimati' });
  const c10k = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Pacific/Kiritimati' });
  const p10k = await c10k.newPage();
  p10k.on('pageerror', (e) => errors.push(e.message));
  await p10k.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/'));
  const kiriBeta = await p10k.waitForSelector('.l-beta', { timeout: 8000 }).then(() => true, () => false);
  if (kiriToday > todayKey) {
    check('a phone already on tomorrow’s date still sees the beta on its last day (the server’s date counts)', kiriBeta && !!(await p10k.$('.l-beta-tag')), 'phone ' + kiriToday + ', Mountain ' + todayKey);
    await p10k.click('[data-type="remote"]');
    await p10k.click('[data-method="venmo"]');
    check('…and its payment step says not to send money (no Venmo button)', /Beta test: don’t send any money/.test(await p10k.textContent('.flow-body')) && (await p10k.$('.pay-detail a')) === null);
  } else {
    console.log('SKIP the time-zone check: Kiritimati and Mountain time are on the same date right now (' + todayKey + ')');
  }
  await c10k.close();
  // The server can't be reached on a first visit: the payment step shows no price, handle or pay
  // link (a beta may be on), Continue waits, and "Try again" brings the real answer (here, the beta).
  const c10f = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  const p10f = await c10f.newPage();
  p10f.on('pageerror', (e) => errors.push(e.message));
  const blockConfig = (route) => (/"action":"config"/.test(route.request().postData() || '') ? route.abort() : route.continue());
  await p10f.route('**/api', blockConfig);
  await p10f.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/'));
  await p10f.waitForSelector('[data-type="remote"]');
  await wait(400);
  await p10f.click('[data-type="remote"]');
  await p10f.waitForSelector('[data-act="config-retry"]');
  const offline = await p10f.evaluate(() => ({ html: document.querySelector('.flow-body').innerHTML, next: document.querySelector('[data-act="next"]').disabled }));
  check('server unreachable: the payment step offers "Try again", no $99, no pay link, Continue waits',
    !/\$99|venmo\.com|kevin-schuetz/.test(offline.html) && offline.next, JSON.stringify(offline).slice(0, 300));
  await p10f.unroute('**/api', blockConfig);
  await p10f.click('[data-act="config-retry"]');
  await p10f.waitForSelector('.beta-pay');
  check('…"Try again" gets the answer: this week that is the beta, nothing to pay', /Beta test: don’t send any money/.test(await p10f.textContent('.flow-body')) && !(await p10f.$('[data-act="next"][disabled]')));
  await c10f.close();
  // A page left open past the beta's end (review, 11/11): the landing stops showing the beta by
  // Mountain time's date, and a sign-up that was shown it ("don't send any money") is bounced back
  // to the real steps by the server, never quietly made a real $99 one.
  const tomorrow8 = shift(todayKey, 1) + 'T08:00:00-07:00';
  // (1) The beta landing is still on screen after Mountain midnight and someone taps a choice: that
  // sign-up counts as shown the beta, so the server bounces it instead of making a real one quietly.
  const c10t = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  const p10t = await c10t.newPage();
  p10t.on('pageerror', (e) => errors.push(e.message));
  await p10t.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/'));
  await p10t.waitForSelector('.l-beta');
  await p10t.clock.setFixedTime(new Date(tomorrow8));
  await p10t.click('[data-type="member"]');
  await p10t.waitForSelector('[data-field="first"]');
  const staleDraft = await p10t.evaluate(() => JSON.parse(localStorage.getItem('res27.draft') || '{}'));
  check('a stale beta screen tapped after Mountain midnight still counts as shown the beta (the server will bounce it)', staleDraft.sawBeta === true, JSON.stringify({ sawBeta: staleDraft.sawBeta }));
  await c10t.close();
  // (2) The same screen, looked at again (no tap, no navigation): it's painted again without the beta.
  const c10v = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  const p10v = await c10v.newPage();
  p10v.on('pageerror', (e) => errors.push(e.message));
  await p10v.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/'));
  await p10v.waitForSelector('.l-beta');
  await p10v.clock.setFixedTime(new Date(tomorrow8));
  await p10v.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await wait(300);
  check('a landing page left open past Mountain midnight drops the ended beta when it’s looked at again', !(await p10v.$('.l-beta-tag')) && /Jan 18/.test(await p10v.textContent('.l-date')), await p10v.textContent('.l-date'));
  await c10v.close();
  const c10b = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  const p10b = await c10b.newPage();
  p10b.on('pageerror', (e) => errors.push(e.message));
  await p10b.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/'));
  await p10b.waitForSelector('.l-beta');
  await p10b.click('[data-type="remote"]');
  await p10b.click('[data-method="venmo"]');
  check('late sign-up: during the beta its payment step says not to send money', /Beta test: don’t send any money/.test(await p10b.textContent('.flow-body')));
  await p10b.click('[data-act="next"]');
  await p10b.waitForSelector('[data-field="first"]');
  await p10b.fill('[data-field="first"]', 'Late');
  await p10b.fill('[data-field="last"]', 'Night');
  await p10b.fill('[data-field="email"]', 'late.night@example.com');
  await p10b.fill('[data-field="password"]', 'koda2027');
  await p10b.click('[data-shirt="tee"]');
  await p10b.click('[data-size="L"]');
  await p10b.click('[data-act="next"]');
  await p10b.click('[data-goal="health"]');
  await p10b.click('[data-act="next"]');
  await p10b.waitForSelector('[data-act="track"]');
  for (const id of ['protein', 'hydration', 'finishers', 'skill', 'mobility', 'recovery', 'other']) await p10b.click(`[data-act="track"][data-id="${id}"][data-val="0"]`);
  await p10b.click('[data-act="next"]');
  await p10b.waitForSelector('[data-plan="recommended"]');
  await p10b.click('[data-plan="recommended"]');
  await p10b.click('[data-act="next"]');
  await p10b.waitForSelector('[data-act="coach-none"], [data-act="coach"]');
  await p10b.click('[data-act="next"]');
  await p10b.waitForSelector('.review-sec');
  // Mountain midnight passes before "Create my account".
  await get('/dev/time?set=' + encodeURIComponent(tomorrow8));
  await p10b.clock.setFixedTime(new Date(tomorrow8));
  await p10b.click('[data-act="next"]');
  await p10b.waitForSelector('.form-error', { timeout: 15000 });
  await wait(300);
  const lateRows = (await get('/dev/rows?tab=Participants')).filter((r) => r.Email === 'late.night@example.com');
  const lateHtml = await p10b.innerHTML('.flow-body');
  check('…sent after Mountain midnight it comes back to the real payment step (no account made), not a real $99 sign-up',
    /beta test is over/i.test(await p10b.textContent('.form-error')) && /#\/join\/payment$/.test(p10b.url()) && lateRows.length === 0 && !/Beta test: don’t send any money/.test(lateHtml) && /venmo\.com/.test(lateHtml),
    JSON.stringify({ url: p10b.url(), rows: lateRows.length, error: await p10b.textContent('.form-error') }));
  await c10b.close();
  await get('/dev/time?clear=1');
  await api({ action: 'adminSetup', key: ADMINKEY, settings: { beta_start: yesterday, beta_everyone: false } });
  await c7.close();
  await api({ action: 'adminSetup', key: ADMINKEY, settings: { beta_start: '' } });
  // Beta over and turned off: a beta tester's account now looks like a January sign-up, so it says it isn't one.
  const c11 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  const p11 = await c11.newPage();
  p11.on('pageerror', (e) => errors.push(e.message));
  await p11.goto(BASE + '/dev/as?email=dark.beta%40example.com&password=koda2027&to=' + encodeURIComponent('#/today'));
  await p11.waitForSelector('.hero');
  await wait(300);
  check('after the beta is turned off, a beta tester sees "This is a test account … sign up again"', /This is a test account/.test(await p11.textContent('#main')) && /sign up again/.test(await p11.textContent('#main')));
  await c11.close();
  await get('/dev/time?set=' + encodeURIComponent('2027-01-27T19:30:00-07:00'));

  // ---------------------------------------------------------------- 11/10 later: FAQs page, Macros first, the Koda Cookbook
  const c12 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p12 = await c12.newPage();
  p12.on('pageerror', (e) => errors.push(e.message));
  await p12.goto(BASE + '/dev/as?email=demo%40koda.test&password=koda2027&to=' + encodeURIComponent('#/profile'));
  await p12.waitForSelector('.list-row[href="#/faqs"]');
  check('Profile: the questions moved off (no FAQ list), with a link to FAQs', (await p12.$$('details')).length === 0);
  await p12.click('.list-row[href="#/faqs"]');
  await p12.waitForSelector('.faq-item');
  const faqCount = await p12.$$eval('.faq-item', (els) => els.length);
  await p12.click('.faq-item summary');
  const faqOpen = await p12.evaluate(() => document.querySelector('.faq-item').open && /\S/.test(document.querySelector('.faq-item p').textContent));
  check('FAQs page: every question, tap one to open its answer', faqCount >= 6 && faqOpen && (await p12.textContent('.page-title')) === 'FAQs' && /Profile/.test(await p12.textContent('.tabbar .tab.is-on')), 'questions ' + faqCount);
  const missed = await p12.evaluate(() => Array.from(document.querySelectorAll('.faq-item')).map((d) => d.textContent).find((t) => /missed a day/.test(t)) || '');
  check('FAQ: a missed day can be filled in until Monday at midnight, tallied Tuesday morning', /until Monday at midnight/.test(missed) && /Tuesday morning/.test(missed), missed.slice(0, 200));
  const tabsPhone = await p12.$$eval('.tabbar .tab', (els) => els.map((e) => e.textContent.trim()));
  check('phone tab bar keeps five (FAQs lives under Profile there)', tabsPhone.length === 5 && tabsPhone.indexOf('FAQs') < 0, tabsPhone.join(','));
  // Ask a question: no coach yet → the gym; with a coach in coach_emails → that coach, Reply-To the member.
  await get('/dev/emails?clear=1');
  await p12.fill('[data-ask]', 'Is oat milk okay in coffee?');
  await p12.click('[data-act="ask-send"]');
  await p12.waitForSelector('.ask-sent');
  let mails = await get('/dev/emails');
  let askMail = mails.filter((m) => /Resolutions question from Jordan Rivera/.test(m.subject)).pop();
  check('Ask a question (no coach yet): emailed to the gym, Reply-To the member, box cleared', askMail && askMail.to === 'kodaironview@gmail.com' && askMail.replyTo === 'demo@koda.test' && /oat milk/.test(askMail.htmlBody) && (await p12.inputValue('[data-ask]')) === '', JSON.stringify(askMail && { to: askMail.to, replyTo: askMail.replyTo }));
  await api({ action: 'adminSetup', key: 'test-admin-key-123', settings: { coach_emails: 'Riley: riley.coach@example.com' } });
  await get('/dev/cell?email=demo%40koda.test&col=Coach&value=Riley');
  await p12.goto(BASE + '/dev/as?email=demo%40koda.test&password=koda2027&to=' + encodeURIComponent('#/faqs'));
  await p12.waitForSelector('[data-ask]');
  const askIntro = await p12.textContent('.ask-card');
  await p12.fill('[data-ask]', 'How many finishers should I do?');
  await p12.click('[data-act="ask-send"]');
  await p12.waitForSelector('.ask-sent');
  mails = await get('/dev/emails');
  askMail = mails.filter((m) => /finishers/.test(m.htmlBody || '')).pop();
  check('Ask a question (coach Riley): goes to Riley’s email, the page says so', /your coach, Riley/.test(askIntro) && askMail && askMail.to === 'riley.coach@example.com' && askMail.replyTo === 'demo@koda.test' && /Sent to Riley/.test(await p12.textContent('.ask-sent')), JSON.stringify(askMail && askMail.to));
  const qRows = await get('/dev/rows?tab=Questions');
  check('every question is kept on the Questions tab', qRows.length === 2 && qRows[1]['Coach'] === 'Riley' && qRows[1]['Emailed'] === 'Sent', JSON.stringify(qRows.map((r) => r['Sent To'])));
  await p12.screenshot({ path: path.join(OUT, 'faqs-ask.png'), fullPage: true });
  await get('/dev/cell?email=demo%40koda.test&col=Coach&value=');
  await p12.goto(BASE + '/#/nutrition/other');
  await p12.waitForSelector('.plan-hero');
  const otherFirst = (await p12.textContent('.plan-hero')).trim();
  check('Nutrition › Other plans: Macros is first, above Whole30', /^Macros/.test(otherFirst), otherFirst.slice(0, 40));
  const ntabs = await p12.$$eval('.tab-chip', (els) => els.map((e) => [e.textContent.trim(), e.getAttribute('href')]));
  check('Nutrition: a Koda Cookbook chip that opens its own page', ntabs.some((t) => t[0] === 'Koda Cookbook' && t[1] === '#/cookbook'), JSON.stringify(ntabs));
  // Old links to the cookbook's Nutrition tab land on its own page (11/12).
  await p12.goto(BASE + '/#/nutrition/cookbook');
  await p12.waitForSelector('.cb-sec', { timeout: 15000 });
  const cbPage = await p12.evaluate(() => ({ hash: location.hash, tab: (document.querySelector('.tabbar .tab.is-on') || {}).textContent, back: (document.querySelector('a.phone-only[href="#/nutrition"]') || {}).textContent }));
  check('Cookbook: its own page (#/cookbook); on phones the Nutrition tab stays lit, with a ‹ Nutrition link', cbPage.hash === '#/cookbook' && /Nutrition/.test(cbPage.tab || '') && /Nutrition/.test(cbPage.back || ''), JSON.stringify(cbPage));
  const cb = await p12.evaluate(() => ({
    sections: Array.from(document.querySelectorAll('.cb-sec .cb-sec-name b')).map((b) => b.textContent),
    recipes: document.querySelectorAll('.cb-recipe').length,
    meta: document.querySelector('.cb-meta').textContent,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }));
  check('Cookbook: the PDF’s six sections with the same titles, 65 recipes', cb.sections.join('|') === 'BREAKFAST|LUNCH|DINNER|SOUPS & CHILI|SNACKS|SIDES' && cb.recipes === 65 && /65 recipes/.test(cb.meta) && cb.overflow <= 0, JSON.stringify(cb));
  await p12.click('#cb-breakfast > summary');
  await p12.click('#cb-breakfast .cb-recipe > summary');
  const r1 = await p12.evaluate(() => {
    const r = document.querySelector('#cb-breakfast .cb-recipe');
    return { open: r.open, title: r.querySelector('.cb-rt b').textContent, heads: Array.from(r.querySelectorAll('.cb-block h4')).map((h) => h.textContent), items: r.querySelectorAll('.cb-ul li').length, steps: r.querySelectorAll('.cb-ol li').length };
  });
  check('Cookbook: Breakfast opens to its recipes; a recipe opens to ingredients and directions', r1.open && r1.title === 'Banana Pancakes' && r1.heads.indexOf('INGREDIENTS') >= 0 && r1.heads.indexOf('DIRECTIONS') >= 0 && r1.items >= 3 && r1.steps >= 3, JSON.stringify(r1));
  // Kevin, 11/12: a picture of each dish (thumbnail on the list, photo + licence credit in the recipe).
  await p12.waitForFunction(() => { const i = document.querySelector('#cb-breakfast .cb-recipe[open] .cb-photo img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 }).catch(() => {});
  const ph = await p12.evaluate(() => {
    const r = document.querySelector('#cb-breakfast .cb-recipe');
    const img = r.querySelector('.cb-photo img');
    const cap = r.querySelector('.cb-photo figcaption');
    return { thumbs: document.querySelectorAll('#cb-breakfast .cb-thumb').length, recipes: document.querySelectorAll('#cb-breakfast .cb-recipe').length, hero: img ? [img.naturalWidth, img.getAttribute('alt')] : null, credit: cap ? cap.textContent : '', links: cap ? Array.from(cap.querySelectorAll('a')).map((a) => a.getAttribute('href')) : [], overflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  // A recipe no photo matched shows its number instead (a wrong or off-plan photo would be worse).
  const cbData = await (await fetch(BASE + '/content/cookbook.json')).json();
  const bfPhotos = cbData.sections.find((s) => s.id === 'breakfast').recipes.filter((r) => r.photo).length;
  ph.expectedThumbs = bfPhotos;
  check('Cookbook photos: every Breakfast recipe with a photo has its thumbnail; the open recipe shows its photo with a licence credit', bfPhotos >= ph.recipes - 3 && ph.thumbs === bfPhotos && ph.hero && ph.hero[0] >= 900 && /^Example photo/.test(ph.credit) && /CC|public domain/.test(ph.credit) && ph.links.some((h) => /creativecommons\.org/.test(h)) && ph.overflow <= 0, JSON.stringify(ph));
  await p12.screenshot({ path: path.join(OUT, 'cookbook-01-recipe.png'), fullPage: true });
  await p12.fill('[data-cbsearch]', 'salmon');
  await wait(200);
  const found = await p12.evaluate(() => ({ focused: document.activeElement && document.activeElement.hasAttribute('data-cbsearch'), shown: document.querySelectorAll('.cb-recipe').length, open: Array.from(document.querySelectorAll('.cb-sec')).every((d) => d.open) }));
  check('Cookbook search: "salmon" narrows the list, opens the sections, keeps the keyboard up', found.shown > 0 && found.shown < 65 && found.open && found.focused, JSON.stringify(found));
  await p12.screenshot({ path: path.join(OUT, 'cookbook-02-search.png'), fullPage: true });
  await c12.close();

  // ---------------------------------------------------------------- screenshots: demo member, light + dark, phone + desktop
  for (const scheme of ['light', 'dark']) {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
    const p2 = await c2.newPage();
    p2.on('pageerror', (e) => errors.push(e.message));
    for (const [name, hash] of [['today', '#/today'], ['leaderboard', '#/leaderboard'], ['nutrition', '#/nutrition'], ['cookbook', '#/cookbook'], ['videos', '#/videos'], ['profile', '#/profile'], ['faqs', '#/faqs']]) {
      await p2.goto(BASE + '/dev/as?email=demo%40koda.test&password=koda2027&to=' + encodeURIComponent(hash));
      await wait(1200);
      await p2.screenshot({ path: path.join(OUT, `phone-${scheme}-${name}.png`), fullPage: true });
    }
    await c2.close();
  }
  const c3 = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const p3 = await c3.newPage();
  for (const [name, hash] of [['today', '#/today'], ['leaderboard', '#/leaderboard'], ['cookbook', '#/cookbook']]) {
    await p3.goto(BASE + '/dev/as?email=demo%40koda.test&password=koda2027&to=' + encodeURIComponent(hash));
    await wait(1200);
    await p3.screenshot({ path: path.join(OUT, `desktop-${name}.png`), fullPage: true });
  }
  // Desktop sidebar (11/12): the Koda Cookbook is its own item, right after Nutrition, lit on its page.
  const deskNav = await p3.evaluate(() => ({ items: Array.from(document.querySelectorAll('.sidebar .nav-item span:not(.od-badge)')).map((s) => s.textContent.trim()), on: (document.querySelector('.sidebar .nav-item.is-on') || {}).textContent }));
  check('desktop sidebar: Koda Cookbook is its own item after Nutrition, lit on its page', deskNav.items.join(',') === 'Today,Leaderboard,Nutrition,Koda Cookbook,Videos,FAQs,Profile' && /Koda Cookbook/.test(deskNav.on || ''), JSON.stringify(deskNav));
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
