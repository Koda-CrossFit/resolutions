'use strict';

/**
 * Browser walkthrough against the local dev server (node dev/server.js must be running on 8790,
 * or set E2E_BASE, e.g. E2E_BASE=http://localhost:8795 for PORT=8795 node dev/server.js).
 *   node tests/e2e.js [outDir]
 * Uses Playwright from Desktop\Claude\sugarwod-skill. Resets the dev world, so don't run it
 * while someone else is using the dev server.
 */

const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { chromium } = require('C:/Users/kevsc/Desktop/Claude/sugarwod-skill/node_modules/playwright');

const BASE = process.env.E2E_BASE || 'http://localhost:8790';
const OUT = process.argv[2] || path.join(__dirname, '..', 'dev', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}
const get = (p) => fetch(BASE + p).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The six gyms (11/23/2026) as the app has them (assets/content.js), for the color checks.
const CONTENT = (() => { const window = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'content.js'), 'utf8'), { window }); return JSON.parse(JSON.stringify(window.RES27_CONTENT)); })();
const GYM_IDS = CONTENT.gyms.map((g) => g.id);
/** The sign-up's first step: pick a gym (and Continue). */
const pickGym = async (p, id) => { await p.waitForSelector('.gym-tile'); await p.click(`[data-act="pick-gym"][data-id="${id}"]`); };
const gymStep = async (p, id) => { await pickGym(p, id); await p.click('[data-act="next"]'); };
/** WCAG contrast of two #rrggbb colors. */
function contrast(a, b) {
  const lum = (c) => {
    const v = String(c).replace('#', '');
    const ch = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const hexes = (s) => String(s).match(/#[0-9a-fA-F]{6}\b/g) || [];
const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();
/** A computed rgb(…) color as #rrggbb. */
const hexOf = (rgb) => '#' + String(rgb).match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');

// The walkthrough never leaves this computer (review, 11/23/2026): the browser can't look up any
// host but this one, and every request for somewhere else (Google Fonts, YouTube thumbnails) is
// answered here. Google Fonts gets the local copy of Bebas Neue when this computer has one, so the
// headline and app-name widths the layout checks measure are the real ones; Inter isn't on this
// computer, so body text uses the app's fallback font (Segoe UI), which runs a little narrower.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const DISPLAY_FONT = process.env.E2E_DISPLAY_FONT || 'C:/Users/kevsc/Desktop/Claude/iron-games-big-check/fonts/bebasneue-v16-JTUSjIg69CK48gW7PXooxW4.ttf';
const FONT_CSS = fs.existsSync(DISPLAY_FONT)
  ? "@font-face{font-family:'Bebas Neue';font-style:normal;font-weight:400;font-display:block;src:url(data:font/ttf;base64," + fs.readFileSync(DISPLAY_FONT).toString('base64') + ") format('truetype');}"
  : '';
const stayLocal = (route) => {
  const host = new URL(route.request().url()).hostname;
  if (LOCAL_HOST.test(host)) return route.continue();
  if (host === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: FONT_CSS });
  return route.fulfill({ status: 204, body: '' });
};

(async () => {
  await get('/dev/reset?demo=1&at=' + encodeURIComponent('2027-01-27T19:30:00-07:00'));
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'] });
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (opts) => { const c = await newContext(opts); await c.route('**/*', stayLocal); return c; };
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
  // Six gyms (11/23/2026), Kevin: "The current website should be Iron View's colors". The plain link is
  // Iron View's page, navy and silver as before; not knowing the visitor's gym, it claims none for them.
  const ivLanding = await page.evaluate(() => {
    const cs = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
    return {
      gym: document.documentElement.dataset.gym,
      hero: cs('.l-hero', 'backgroundImage'),
      tile: cs('.choice .c-icon', 'backgroundColor'),
      bg: getComputedStyle(document.body).backgroundColor,
      badge: cs('.badge-brand', 'backgroundColor'),
      metal: cs('.l-title .silver', 'backgroundImage'),
      logo: document.querySelector('.l-logo span').textContent,
      title: document.querySelector('.l-title').textContent,
      member: document.querySelector('[data-type="member"] .c-sub').textContent,
      foot: document.querySelector('.l-foot').textContent,
      themeColor: document.querySelector('meta[name="theme-color"]').content,
      docTitle: document.title,
    };
  });
  check('Iron View look unchanged: the plain link is navy and silver as before (hero, tiles, page, badge, title, browser bar)',
    ivLanding.gym === 'ironview' && /rgb\(42, 71, 105\) 0%, rgb\(21, 40, 63\) 45%, rgb\(10, 21, 34\) 100%/.test(ivLanding.hero) && ivLanding.tile === 'rgb(12, 26, 43)' && ivLanding.bg === 'rgb(242, 244, 247)' &&
    ivLanding.badge === 'rgb(12, 26, 43)' && /rgb\(255, 255, 255\) 0%, rgb\(196, 204, 213\) 60%, rgb\(154, 165, 177\) 100%/.test(ivLanding.metal) && ivLanding.themeColor === '#0c1a2b' && ivLanding.docTitle === 'Koda Resolutions 2027', JSON.stringify(ivLanding));
  check('the plain link keeps Iron View’s words, and asks members for no gym in particular',
    ivLanding.logo === 'Koda CrossFit Iron View' && ivLanding.title === 'KodaResolutions 2027' && ivLanding.member === 'I train at a Koda gym' && /Koda CrossFit Iron View · 740 S Pierce Ave #5, Louisville, CO/.test(ivLanding.foot), JSON.stringify(ivLanding));
  await page.click('[data-type="remote"]');
  await page.waitForSelector('.gym-tile');
  const plainGym = await page.$$eval('.gym-tile', (els) => els.map((e) => [e.dataset.id, e.getAttribute('aria-checked'), e.textContent]));
  check('sign-up starts with Your gym: six tiles in order, none picked on the plain link', plainGym.length === 6 && plainGym.every((t) => t[1] === 'false') && /Koda Iron View.*Louisville, CO/.test(plainGym[0][2]) && plainGym.map((t) => t[0]).join(',') === GYM_IDS.join(','), JSON.stringify(plainGym));
  await page.click('[data-act="next"]');
  await wait(250);
  check('Continue on Your gym waits for a pick', /#\/join\/gym/.test(page.url()) && /Pick your gym/.test(await page.textContent('.flow-body')));
  await gymStep(page, 'ironview');
  await page.click('[data-method="venmo"]');
  const ivMethods = await page.$$eval('[data-act="pay"]', (els) => els.map((e) => e.dataset.method + ':' + e.querySelector('.o-sub').textContent).join('|'));
  // Kevin, 11/23/2026: "put a placeholder for the card link, we'll add one later": a card at every gym.
  check('Iron View offers its Venmo and Zelle, then a card (no checkout link yet: “We’ll email you a secure link”)', ivMethods === 'venmo:@kevin-schuetz-5|zelle:kodaironview@gmail.com|card:We’ll email you a secure link', ivMethods);
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
  const fin = await api({ action: 'register', gym: 'ironview', memberType: 'member', first: 'Fin', last: 'Isher', email: 'fin@koda.test', password: 'koda2027', shirt: 'tee', size: 'M', setup: { goal: 'performance', track: { workout: true, finishers: true }, finishersPerWeek: 2, coaches: [] } });
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
  // It has no gym (it's from before the six gyms): Your gym first, then straight back to where it was.
  await p5.waitForSelector('.gym-tile');
  check('a sign-up saved before the gym step asks for the gym first', /#\/join\/gym$/.test(p5.url()) && !(await p5.$('.gym-tile[aria-checked="true"]')), p5.url());
  await gymStep(p5, 'ironview');
  await p5.waitForSelector('[data-act="track"]');
  check('…and then goes back to the step it was on', /#\/join\/track$/.test(p5.url()), p5.url());
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
    .map((d, i) => Object.assign({}, d, { ref: ['fakeVid0001', 'fakeVid0002', 'fakeVid0003', 'fakeVid0004', 'fakeVid0005', 'fakeVid0006', 'fakeVid0007'][i] || '' }));
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
  await gymStep(b7, 'ironview');
  await b7.click('[data-method="venmo"]');
  const payText = await b7.textContent('.flow-body');
  check('beta: the payment step says not to send money and has no Venmo button', /Beta test: don’t send any money/.test(payText) && (await b7.$('.pay-detail a')) === null);
  await b7.click('[data-act="back"]'); // to Your gym
  await b7.waitForSelector('.gym-tile');
  await b7.click('[data-act="back"]'); // to the landing
  await b7.waitForSelector('[data-type="member"]');
  await b7.click('[data-type="member"]');
  await b7.waitForSelector('.gym-tile');
  check('a gym picked earlier on this phone is picked already when a sign-up starts again', (await b7.getAttribute('[data-act="pick-gym"][data-id="ironview"]', 'aria-checked')) === 'true');
  await b7.click('[data-act="next"]');
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
  check('beta Today: Day 2 plays its 2026 stand-in video, marked as one', /fakeVid0002/.test(bt.poster) && bt.standIn, bt.poster);
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
    const r = await api({ action: 'register', gym: 'ironview', memberType: 'member', first, last: 'Mate', email: first.toLowerCase() + '.beta@example.com', password: 'koda2027', shirt: 'tee', size: 'M', setup: { goal: 'health', track: { nutrition: true, workout: true, sleep: true }, plan: 'recommended', sleepHours: 7, coaches: [] }, beta: true });
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
  await api({ action: 'register', gym: 'ironview', memberType: 'member', first: 'Dark', last: 'Mode', email: 'dark.beta@example.com', password: 'koda2027', shirt: 'tee', size: 'M', setup: { goal: 'health', track: { nutrition: true, workout: true, sleep: true }, plan: 'recommended', sleepHours: 7, coaches: [] }, beta: true });
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
  await gymStep(p10e, 'ironview');
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
    await gymStep(p10k, 'ironview');
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
  // (Your gym needs nothing from the server: its six tiles are in the app.)
  await gymStep(p10f, 'ironview');
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
  await p10t.waitForSelector('.gym-tile'); // (the choice is saved with the draft as it's tapped)
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
  await gymStep(p10b, 'ironview');
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
  // Coach emails are on each gym's row of the Gyms tab since 11/23/2026 (Iron View's started as a
  // copy of the coach_emails setting, which the app no longer reads).
  await get('/dev/gym?gym=ironview&col=' + encodeURIComponent('Coach Emails') + '&value=' + encodeURIComponent('Riley: riley.coach@example.com'));
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

  // ---------------------------------------------------------------- six gyms (11/23/2026)
  // Kevin: "at least have a different color scheme and do some overall leaderboards between gyms along
  // with leaderboards within the gyms", plus a daily email people can stop. The clock is on Day 10.
  const gymCell = (gym, col, value) => get('/dev/gym?gym=' + gym + '&col=' + encodeURIComponent(col) + '&value=' + encodeURIComponent(value));
  await gymCell('okc', 'Venmo', '@koda-okc-test');
  await gymCell('okc', 'Zelle', 'okc.pay@example.com');
  await gymCell('okc', 'Coaches', 'Avery, Blake, Casey');
  const GYM_SETUP = { goal: 'health', track: { nutrition: true, workout: true, sleep: true }, plan: 'recommended', sleepHours: 7, coaches: [] };
  const signUp = async (gym, first, email, team, setup) => {
    const r = await api({ action: 'register', gym, memberType: 'member', first, last: 'Gymtest', email, password: 'koda2027', shirt: 'tee', size: 'M', setup: setup || GYM_SETUP });
    if (r.ok && team) await get('/dev/cell?email=' + encodeURIComponent(email) + '&col=Team&value=' + encodeURIComponent(team));
    return r;
  };
  const row = async (email) => (await get('/dev/rows?tab=Participants')).find((r) => r.Email === email) || {};
  const phone = (scheme) => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme || 'light' });
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|fonts\.g|ytimg|youtube/.test(m.text())) errors.push(m.text()); });
    return p;
  };

  // (1) Each gym's colors: app.css and content.js (C.gyms) agree, light and dark, and text on a brand
  // color reads at 4.5:1 or better (the spec), checked on the page's own computed colors.
  for (const scheme of ['light', 'dark']) {
    const ct = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
    const pt = watch(await ct.newPage());
    const mismatch = [], low = [], edges = [];
    for (const g of CONTENT.gyms) {
      await pt.goto(BASE + '/dev/blank?to=' + encodeURIComponent('?gym=' + g.id + '#/'));
      await pt.waitForSelector('.l-hero');
      const iv = g.id === 'ironview';
      const want = Object.assign({}, iv ? {} : CONTENT.gymNeutrals.light, g.light, scheme === 'dark' ? Object.assign({}, iv ? {} : CONTENT.gymNeutrals.dark, g.dark) : {});
      const keys = Object.keys(want).concat(['--surface', '--surface-2', '--surface-3', '--text', '--muted', '--subtle']);
      const got = await pt.evaluate((ks) => { const cs = getComputedStyle(document.documentElement); const o = { gym: document.documentElement.dataset.gym }; ks.forEach((k) => { o[k] = cs.getPropertyValue(k).trim(); }); return o; }, keys);
      if (got.gym !== g.id) mismatch.push(g.id + ' data-gym=' + got.gym);
      Object.keys(want).forEach((k) => { if (norm(got[k]) !== norm(want[k])) mismatch.push(g.id + ' ' + k + ': css ' + got[k] + ' / content.js ' + want[k]); });
      const pair = (what, fg, bg, min) => { const r = contrast(fg, bg); if (!(r >= min)) low.push(g.id + ' ' + what + ' ' + fg + ' on ' + bg + ' = ' + r.toFixed(2)); };
      pair('on-brand on brand', got['--on-brand'], got['--brand'], 4.5);
      pair('on-brand on brand-hover', got['--on-brand'], got['--brand-hover'], 4.5);
      pair('on-yes on yes', got['--on-yes'], got['--yes'], 4.5);
      ['--surface', '--surface-2', '--surface-3'].forEach((s) => { pair('links (brand-2) on ' + s, got['--brand-2'], got[s], 4.5); pair('muted on ' + s, got['--muted'], got[s], 4.5); pair('picked outline (line) on ' + s, got['--line'], got[s], 3); });
      pair('subtle on surface', got['--subtle'], got['--surface'], 4.5);
      hexes(got['--silver-sheen']).forEach((c) => pair('on-sheen on sheen', got['--on-sheen'], c, 4.5));
      hexes(got['--chip']).forEach((c) => pair('on-chip on the week chip', got['--on-chip'], c, 4.5));
      ['--hero-a', '--hero-b', '--hero-c', '--lhero-a', '--lhero-b', '--lhero-c'].forEach((h) => { pair('white on ' + h, '#ffffff', got[h], 4.5); pair('hero-dim on ' + h, got['--hero-dim'], got[h], 4.5); });
      pair('white on navy-900 tiles', '#ffffff', got['--navy-900'], 4.5);
      pair('white initials on avatar', '#ffffff', got['--avatar-bg'], 4.5);
      // Review, 11/23/2026: a chosen Yes and a picked size chip have to show against the card (3:1), by
      // their fill or their edge (Native's pale pink, Tulsa's teal and Downtown's green didn't alone).
      const picks = await pt.evaluate(() => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = '<button class="chip is-on">M</button><span class="yn"><button class="yn-btn yes is-on">Yes</button></span>';
        document.body.appendChild(card);
        const out = ['.chip.is-on', '.yn-btn.yes.is-on'].map((s) => { const cs = getComputedStyle(card.querySelector(s)); return [s, cs.backgroundColor, cs.borderTopColor]; });
        out.push(getComputedStyle(card).backgroundColor);
        card.remove();
        return out;
      });
      const surface = hexOf(picks.pop());
      picks.forEach((x) => { const best = Math.max(contrast(hexOf(x[1]), surface), contrast(hexOf(x[2]), surface)); if (!(best >= 3)) edges.push(g.id + ' ' + x[0] + ' fill ' + x[1] + ' edge ' + x[2] + ' = ' + best.toFixed(2)); });
    }
    check('gym colors (' + scheme + '): app.css matches content.js for all six gyms', mismatch.length === 0, mismatch.slice(0, 6).join(' | '));
    check('gym colors (' + scheme + '): text on every brand color reads at 4.5:1 or better (3:1 for outlines)', low.length === 0, low.slice(0, 6).join(' | '));
    check('gym colors (' + scheme + '): a chosen Yes and a picked chip show against the card (fill or edge at 3:1 or better)', edges.length === 0, edges.slice(0, 6).join(' | '));
    await ct.close();
  }

  // (1b) A ?gym= that isn't a gym is ignored; a gym from an earlier link is remembered on the plain link.
  const c12b = await phone();
  const p12b = watch(await c12b.newPage());
  await p12b.goto(BASE + '/dev/blank?to=' + encodeURIComponent('?gym=nowhere#/'));
  await p12b.waitForSelector('.l-hero');
  const unknownGym = await p12b.evaluate(() => ({ gym: document.documentElement.dataset.gym, kept: localStorage.getItem('res27.gym'), logo: document.querySelector('.l-logo span').textContent }));
  check('?gym= with an unknown gym is ignored (Iron View, nothing remembered)', unknownGym.gym === 'ironview' && unknownGym.kept === null && unknownGym.logo === 'Koda CrossFit Iron View', JSON.stringify(unknownGym));
  await p12b.goto(BASE + '/?gym=Tulsa#/');
  await p12b.waitForSelector('.l-hero');
  await p12b.goto(BASE + '/#/');
  await p12b.waitForSelector('.l-hero');
  const remembered = await p12b.evaluate(() => ({ gym: document.documentElement.dataset.gym, logo: document.querySelector('.l-logo span').textContent }));
  check('a gym from an earlier link (any case, ?gym=Tulsa) is remembered, so the plain link opens in its colors', remembered.gym === 'tulsa' && remembered.logo === 'Koda CrossFit Tulsa', JSON.stringify(remembered));
  await c12b.close();

  // (2) Sign up at OKC through its link: OKC's colors, the gym step picked already, OKC's ways to pay.
  const c13 = await phone();
  const p13 = watch(await c13.newPage());
  await p13.goto(BASE + '/dev/blank?to=' + encodeURIComponent('?gym=okc#/'));
  await p13.waitForSelector('[data-type="remote"]');
  await p13.evaluate(() => document.fonts.ready);
  const okcLanding = await p13.evaluate(() => ({
    gym: document.documentElement.dataset.gym, brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
    badge: getComputedStyle(document.querySelector('.badge-brand')).backgroundColor, logo: document.querySelector('.l-logo span').textContent,
    title: document.querySelector('.l-title').textContent, member: document.querySelector('[data-type="member"] .c-sub').textContent,
    foot: document.querySelector('.l-foot').textContent, docTitle: document.title, theme: document.querySelector('meta[name="theme-color"]').content,
    remembered: localStorage.getItem('res27.gym'), overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  check('?gym=okc: OKC’s landing (black and purple, "Koda OKC" in the hero, its address), and the phone remembers OKC',
    okcLanding.gym === 'okc' && okcLanding.brand === '#7c28e6' && okcLanding.badge === 'rgb(124, 40, 230)' && okcLanding.logo === 'Koda CrossFit OKC' && okcLanding.title === 'Koda OKCResolutions 2027' &&
    okcLanding.member === 'I train at Koda CrossFit OKC' && /Koda CrossFit OKC · 7016 Ozzy Ave, Oklahoma City, OK/.test(okcLanding.foot) && okcLanding.docTitle === 'Koda OKC · Resolutions 2027' &&
    okcLanding.theme === '#0e0b14' && okcLanding.remembered === '"okc"' && okcLanding.overflow <= 0, JSON.stringify(okcLanding));
  await p13.screenshot({ path: path.join(OUT, 'gym-okc-landing.png'), fullPage: true });
  await p13.click('[data-type="remote"]');
  await p13.waitForSelector('.gym-tile');
  const okcPicked = await p13.$$eval('.gym-tile[aria-checked="true"]', (els) => els.map((e) => e.dataset.id).join(','));
  check('?gym=okc: the sign-up opens on Your gym with OKC picked already', okcPicked === 'okc' && /#\/join\/gym/.test(p13.url()), okcPicked);
  await p13.screenshot({ path: path.join(OUT, 'gym-step-okc.png'), fullPage: true });
  // Switch gym on the gym step: Tulsa (no Venmo, Zelle, Card URL or coaches on the dev Gyms tab), then OKC again.
  await pickGym(p13, 'tulsa');
  const toTulsa = await p13.evaluate(() => ({
    gym: document.documentElement.dataset.gym, brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
    next: getComputedStyle(document.querySelector('[data-act="next"]')).backgroundColor, link: location.search,
    picked: Array.from(document.querySelectorAll('.gym-tile[aria-checked="true"]')).map((e) => e.dataset.id).join(','), steps: document.querySelector('.flow-count').textContent,
  }));
  check('picking Tulsa switches the page to Tulsa’s teal at once, the link follows (?gym=tulsa), and its sign-up skips coaches (none listed)',
    toTulsa.gym === 'tulsa' && toTulsa.brand === '#02afad' && toTulsa.next === 'rgb(2, 175, 173)' && toTulsa.link === '?gym=tulsa' && toTulsa.picked === 'tulsa' && toTulsa.steps === '1 of 7', JSON.stringify(toTulsa));
  await p13.screenshot({ path: path.join(OUT, 'gym-step-tulsa.png'), fullPage: true });
  // Tulsa has no Venmo, Zelle or Card URL: only the card, its link to come by email (a pick is still needed).
  await p13.click('[data-act="next"]');
  await p13.waitForSelector('[data-act="pay"]');
  const tulsaOptions = await p13.$$eval('[data-act="pay"]', (els) => els.map((e) => e.dataset.method + ':' + e.querySelector('.o-sub').textContent).join('|'));
  await p13.click('[data-act="next"]');
  await p13.waitForSelector('.flow-body .error');
  const tulsaUnpicked = await p13.textContent('.flow-body');
  await p13.click('[data-method="card"]');
  await p13.waitForSelector('.card-later');
  const tulsaPay = await p13.evaluate(() => ({
    detail: document.querySelector('.pay-detail').textContent, buttons: document.querySelectorAll('.pay-detail a, .pay-detail button').length,
    body: document.querySelector('.flow-body').textContent, old: !!document.querySelector('.pay-later'), next: !document.querySelector('[data-act="next"]').disabled,
  }));
  check('a gym with no payment details yet (Tulsa): a card anyway, “We’ll email you a secure link”; Continue needs it picked, and picked it says a secure link to pay $99 is coming by email (no button)',
    tulsaOptions === 'card:We’ll email you a secure link' && /Choose how you’d like to pay\./.test(tulsaUnpicked) &&
    tulsaPay.detail === 'We’ll email you a secure link to pay $99 by card. You can finish signing up now; your spot is confirmed once your payment comes in.' && tulsaPay.buttons === 0 &&
    !/email you how to pay|once we see your payment/.test(tulsaPay.body) && !tulsaPay.old && tulsaPay.next, JSON.stringify({ tulsaOptions, tulsaUnpicked: tulsaUnpicked.slice(0, 200), tulsaPay }).slice(0, 600));
  await p13.screenshot({ path: path.join(OUT, 'gym-tulsa-payment.png'), fullPage: true });
  await p13.click('[data-act="back"]');
  await pickGym(p13, 'okc');
  check('…and picking OKC again brings its colors and link back', (await p13.evaluate(() => document.documentElement.dataset.gym + ' ' + location.search)) === 'okc ?gym=okc');
  await p13.click('[data-act="next"]');
  await p13.waitForSelector('[data-act="pay"]');
  const okcPay = await p13.$$eval('[data-act="pay"]', (els) => els.map((e) => e.dataset.method + ':' + e.querySelector('.o-sub').textContent).join('|'));
  await p13.click('[data-method="venmo"]');
  const okcVenmo = await p13.getAttribute('.pay-detail a', 'href');
  check('OKC’s payment step: its own Venmo and Zelle (nothing of Iron View’s), then a card with no checkout link yet, the Venmo button prefilled',
    okcPay === 'venmo:@koda-okc-test|zelle:okc.pay@example.com|card:We’ll email you a secure link' && /recipients=koda-okc-test/.test(okcVenmo) && /amount=99/.test(okcVenmo) && !/kevin-schuetz/.test(await p13.innerHTML('.flow-body')), okcPay + ' ' + okcVenmo);
  await p13.screenshot({ path: path.join(OUT, 'gym-okc-payment.png'), fullPage: true });
  await p13.click('[data-act="next"]');
  await p13.waitForSelector('[data-field="first"]');
  await p13.fill('[data-field="first"]', 'Olive');
  await p13.fill('[data-field="last"]', 'Kay');
  await p13.fill('[data-field="email"]', 'olive.okc@example.com');
  await p13.fill('[data-field="password"]', 'koda2027');
  await p13.click('[data-shirt="tank"]');
  await p13.click('[data-size="S"]');
  await p13.click('[data-act="next"]');
  await p13.click('[data-goal="health"]');
  await p13.click('[data-act="next"]');
  await p13.waitForSelector('[data-act="track"]');
  for (const id of ['protein', 'hydration', 'finishers', 'skill', 'mobility', 'recovery', 'other']) await p13.click(`[data-act="track"][data-id="${id}"][data-val="0"]`);
  await p13.click('[data-act="next"]');
  await p13.waitForSelector('[data-plan="recommended"]');
  await p13.click('[data-plan="recommended"]');
  await p13.click('[data-act="next"]');
  await p13.waitForSelector('[data-act="coach"]');
  const okcCoaches = await p13.$$eval('[data-act="coach"]', (els) => els.map((e) => e.dataset.name).join(','));
  check('the coach step lists OKC’s coaches, not Iron View’s', okcCoaches === 'Avery,Blake,Casey', okcCoaches);
  await p13.click('[data-act="coach"][data-name="Blake"]');
  await p13.click('[data-act="next"]');
  await p13.waitForSelector('.review-sec');
  const okcReview = await p13.evaluate(() => ({ text: document.querySelector('.review-sec').textContent, edit: !!document.querySelector('[data-act="jump"][data-step="gym"]') }));
  check('Review shows the gym (editable like the rest), OKC’s price and way to pay, and the OKC coach',
    /GymKoda OKCOklahoma City, OK/.test(okcReview.text) && /\$99 by Venmo/.test(okcReview.text) && /1\. Blake/.test(okcReview.text) && okcReview.edit, JSON.stringify(okcReview).slice(0, 400));
  await p13.screenshot({ path: path.join(OUT, 'gym-okc-review.png'), fullPage: true });
  await p13.click('[data-act="next"]');
  await p13.waitForSelector('#sheet', { timeout: 15000 });
  const okcSheet = await p13.textContent('#sheet');
  check('the welcome sheet asks for the $99 on OKC’s Venmo, with OKC’s pay button', /send your \$99 on Venmo to @koda-okc-test/.test(okcSheet) && !!(await p13.$('#sheet a[href*="recipients=koda-okc-test"]')), okcSheet.slice(0, 300));
  await p13.click('[data-act="close-sheet"]');
  await p13.waitForSelector('#checklistCard');
  const olive = await row('olive.okc@example.com');
  check('the sheet: Gym = OKC (its short name), Venmo, Daily Email On, OKC coach ranking', olive.Gym === 'OKC' && olive.Payment === 'Venmo' && olive['Daily Email'] === 'On' && olive['Coach Ranking'] === '1. Blake', JSON.stringify({ gym: olive.Gym, pay: olive.Payment, daily: olive['Daily Email'], coach: olive['Coach Ranking'] }));
  const okcToday = await p13.evaluate(() => ({ gym: document.documentElement.dataset.gym, pill: (document.querySelector('.topbar .gym-pill') || {}).textContent, hero: getComputedStyle(document.querySelector('.hero')).backgroundImage }));
  check('signed in at OKC: OKC’s colors and an "OKC" pill next to RESOLUTIONS', okcToday.gym === 'okc' && okcToday.pill === 'OKC' && /rgb\(47, 26, 82\)/.test(okcToday.hero), JSON.stringify(okcToday));

  // (3) Leaderboards: My gym (OKC's teams only) and All gyms. Team Iron at OKC is not Team Iron at Iron View.
  await get('/dev/cell?email=olive.okc%40example.com&col=Team&value=Iron');
  const okcPeople = [];
  for (const n of ['Ada', 'Ben', 'Cal']) okcPeople.push(await signUp('okc', n, n.toLowerCase() + '.okc@example.com', 'Iron'));
  for (const email of ['demo@koda.test', 'taylor.e2e@example.com', 'fin@koda.test']) await get('/dev/cell?email=' + encodeURIComponent(email) + '&col=Team&value=Iron');
  const tulsaPeople = [await signUp('tulsa', 'Tia', 'tia.tulsa@example.com', ''), await signUp('tulsa', 'Tom', 'tom.tulsa@example.com', '')];
  for (const [i, r] of okcPeople.concat(tulsaPeople).entries()) {
    await api({ action: 'save', token: r.token, date: '2027-01-25', answers: { video: 1, workout: 1, sleep: i % 2, 'nutrition:m1': 1, 'nutrition:m2': 1, 'nutrition:m3': 1 }, patch: true });
    await api({ action: 'save', token: r.token, date: '2027-01-26', answers: { video: 1, workout: i % 3 ? 1 : 0, sleep: 1 }, patch: true });
  }
  await p13.goto(BASE + '/#/leaderboard');
  await p13.waitForSelector('.lb-board .lb-team');
  const myGymBoard = await p13.evaluate(() => ({
    rows: Array.from(document.querySelectorAll('.lb-board .lb-row')).map((r) => r.textContent), mine: !!document.querySelector('.lb-row.is-mine'),
    you: document.querySelector('.lb-you').textContent, scope: Array.from(document.querySelectorAll('[data-act="board-scope"]')).map((b) => b.textContent + ':' + b.getAttribute('aria-pressed')).join(','),
  }));
  check('Leaderboard › My gym: only OKC’s teams (its Team Iron of 4, not Iron View’s of 3), yours marked, your gym on the You card',
    myGymBoard.scope === 'My gym:true,All gyms:false' && myGymBoard.rows.length === 1 && /Team Iron/.test(myGymBoard.rows[0]) && /4 people · your team/.test(myGymBoard.rows[0]) && myGymBoard.mine && /Koda OKC · \d(st|nd|rd|th) of \d gyms?/.test(myGymBoard.you), JSON.stringify(myGymBoard).slice(0, 500));
  await p13.screenshot({ path: path.join(OUT, 'gym-okc-leaderboard-mygym.png'), fullPage: true });
  await p13.click('[data-act="board-scope"][data-scope="all"]');
  await p13.waitForSelector('.lb-gyms');
  const allGyms = await p13.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.lb-gyms .lb-row'));
    const by = (id) => { const r = document.querySelector('[data-gym-row="' + id + '"]'); return r ? { text: r.textContent, mine: r.classList.contains('is-mine'), rank: r.querySelector('.lb-rank').textContent, dot: !!r.querySelector('.gym-dot') } : null; };
    return { n: rows.length, order: rows.map((r) => r.dataset.gymRow).join(','), okc: by('okc'), ironview: by('ironview'), tulsa: by('tulsa'), native: by('native'), board: document.querySelector('.lb-gyms').textContent, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  check('Leaderboard › All gyms: all six with their color dots, ranked by points per person; OKC is yours; under 3 people shows no score',
    allGyms.n === 6 && allGyms.okc && allGyms.okc.mine && /your gym/.test(allGyms.okc.text) && /pts per person/.test(allGyms.okc.text) && allGyms.okc.rank !== '' && allGyms.okc.dot &&
    allGyms.ironview && /3 people/.test(allGyms.ironview.text) && allGyms.ironview.rank !== '' && allGyms.tulsa && /2 people/.test(allGyms.tulsa.text) && /Fewer than 3 people/.test(allGyms.tulsa.text) && allGyms.tulsa.rank === '' &&
    allGyms.native && /0 people/.test(allGyms.native.text) && /Fewer than 3 people/.test(allGyms.native.text) && allGyms.overflow <= 0, JSON.stringify(allGyms).slice(0, 700));
  check('Leaderboard › All gyms: no one’s name or own score', !/Olive|Ada|Ben|Cal|Tia|Tom|Jordan|Taylor|Fin /.test(allGyms.board));
  await p13.screenshot({ path: path.join(OUT, 'gym-okc-leaderboard-allgyms.png'), fullPage: true });
  await p13.click('[data-act="board-view"][data-view="week"]');
  await p13.waitForSelector('.lb-gyms .lb-range');
  check('Leaderboard › All gyms › This week: the week’s dates', /Week 2/.test(await p13.textContent('.lb-gyms .lb-range')));

  // (4) Profile: the gym is set once the challenge has started ("Ask Kevin"); the daily email switch.
  await p13.goto(BASE + '/#/profile');
  await p13.waitForSelector('#gymRow');
  const lockedGym = await p13.evaluate(() => ({ tag: document.querySelector('#gymRow').tagName, text: document.querySelector('#gymRow').textContent, link: !!document.querySelector('a[href="#/edit/gym"]'), sw: document.querySelector('[data-act="daily-email"]').getAttribute('aria-checked') }));
  check('Profile after Day 1: Gym shown read-only, "Ask Kevin to change it"; Daily email On', lockedGym.tag === 'DIV' && /Koda OKC/.test(lockedGym.text) && /Ask Kevin to change it/.test(lockedGym.text) && !lockedGym.link && lockedGym.sw === 'true', JSON.stringify(lockedGym));
  await p13.click('[data-act="daily-email"]');
  // (While it saves the switch is aria-disabled, not disabled, so it keeps keyboard focus: review, 11/23/2026.)
  await p13.waitForFunction(() => document.querySelector('[data-act="daily-email"]').getAttribute('aria-checked') === 'false' && document.querySelector('[data-act="daily-email"]').getAttribute('aria-disabled') !== 'true');
  await wait(300);
  const offRow = await row('olive.okc@example.com');
  check('Profile › Daily email: switching it off saves Off on the sheet', offRow['Daily Email'] === 'Off' && /Off/.test(await p13.textContent('[data-act="daily-email"]')), offRow['Daily Email']);
  await p13.screenshot({ path: path.join(OUT, 'gym-okc-profile.png'), fullPage: true });
  await p13.click('[data-act="daily-email"]');
  await p13.waitForFunction(() => document.querySelector('[data-act="daily-email"]').getAttribute('aria-checked') === 'true' && document.querySelector('[data-act="daily-email"]').getAttribute('aria-disabled') !== 'true');
  await wait(300);
  check('…and back on', (await row('olive.okc@example.com'))['Daily Email'] === 'On');
  // Before Day 1 the gym can change from the Profile (it switches colors as it's picked).
  await get('/dev/time?set=' + encodeURIComponent('2026-12-20T10:00:00-07:00'));
  const mover = await signUp('okc', 'Mo', 'mo.okc@example.com', '', Object.assign({}, GYM_SETUP, { coaches: ['Avery'] }));
  check('a sign-up at OKC before Day 1 ranks an OKC coach', mover.ok && (await row('mo.okc@example.com'))['Coach Ranking'] === '1. Avery', mover.error);
  await p13.goto(BASE + '/dev/as?email=mo.okc%40example.com&password=koda2027&to=' + encodeURIComponent('#/profile'));
  await p13.waitForSelector('a#gymRow[href="#/edit/gym"]');
  check('Profile before Day 1: the Gym row opens the gym picker', /you can change it until Day 1/.test(await p13.textContent('#gymRow')));
  await p13.click('#gymRow');
  await p13.waitForSelector('.gym-tile[aria-checked="true"]');
  await pickGym(p13, 'tulsa');
  const preview = await p13.evaluate(() => document.documentElement.dataset.gym);
  await p13.click('[data-act="cancel-edit"]');
  await p13.waitForSelector('#gymRow');
  check('the gym picker previews the colors, and Cancel goes back to the person’s gym', preview === 'tulsa' && (await p13.evaluate(() => document.documentElement.dataset.gym)) === 'okc', preview);
  await p13.click('#gymRow');
  await pickGym(p13, 'norman');
  await p13.click('[data-act="save-edit"]');
  await p13.waitForFunction(() => location.hash === '#/profile' && document.documentElement.dataset.gym === 'norman');
  const moved = await p13.evaluate(() => ({ toast: (document.querySelector('#toastWrap') || {}).textContent || '', row: document.querySelector('#gymRow').textContent, coachRow: /Coach preference/.test(document.querySelector('#main').textContent), pill: document.querySelector('.topbar .gym-pill').textContent }));
  const moRow = await row('mo.okc@example.com');
  check('saving Norman: its colors and pill, the sheet says Norman, and the OKC coach pick is cleared (Norman lists none)',
    /Your gym is Koda Norman/.test(moved.toast) && /cleared/.test(moved.toast) && /Koda Norman/.test(moved.row) && !moved.coachRow && moved.pill === 'Norman' && moRow.Gym === 'Norman' && moRow['Coach Ranking'] === '', JSON.stringify(moved) + ' ' + JSON.stringify({ gym: moRow.Gym, coach: moRow['Coach Ranking'] }));
  await get('/dev/time?set=' + encodeURIComponent('2027-01-27T19:30:00-07:00'));
  await c13.close();

  // (5) "Stop these daily emails": the page from the email's link, signed out, in the gym's colors.
  const off = await get('/dev/email-off?email=' + encodeURIComponent('ada.okc@example.com'));
  const c14 = await phone();
  const p14 = watch(await c14.newPage());
  await p14.goto(BASE + '/dev/blank?to=' + encodeURIComponent(off.path.slice(1)));
  await p14.waitForSelector('[data-act="email-off"]');
  const offPage = await p14.evaluate(() => ({ gym: document.documentElement.dataset.gym, text: document.querySelector('#emailOff').textContent }));
  check('the email-off link opens "Stop the daily emails?" with a button, signed out, in OKC’s colors', off.ok && offPage.gym === 'okc' && /Stop the daily emails\?/.test(offPage.text) && (await row('ada.okc@example.com'))['Daily Email'] === 'On', JSON.stringify(offPage));
  await p14.screenshot({ path: path.join(OUT, 'gym-email-off.png') });
  await p14.click('[data-act="email-off"]');
  await p14.waitForFunction(() => /Done\./.test(document.querySelector('#emailOff').textContent));
  check('…the button turns them off: "Done. You can turn them back on in your Profile."', /Done\.\s*You can turn them back on in your Profile\./.test(await p14.textContent('#emailOff')) && (await row('ada.okc@example.com'))['Daily Email'] === 'Off');
  await p14.screenshot({ path: path.join(OUT, 'gym-email-off-done.png') });
  const off2 = await get('/dev/email-off?email=' + encodeURIComponent('ben.okc@example.com'));
  const badSig = off2.path.slice(1).replace(/s=([0-9a-f])/, (m, c) => 's=' + (c === '0' ? '1' : '0'));
  await p14.goto(BASE + '/dev/blank?to=' + encodeURIComponent(badSig));
  await p14.waitForSelector('[data-act="email-off"]');
  await p14.click('[data-act="email-off"]');
  await p14.waitForSelector('#emailOff .form-error');
  check('a link that doesn’t check out says so in plain words (and changes nothing)', /That link didn’t work\. You can turn the daily emails off in your Profile instead\./.test(await p14.textContent('#emailOff .form-error')) && (await row('ben.okc@example.com'))['Daily Email'] === 'On');
  await c14.close();

  // (6) Iron View look unchanged, signed in: its navy hero, an "Iron View" pill, today's values.
  const c15 = await phone();
  const p15 = watch(await c15.newPage());
  await p15.goto(BASE + '/dev/as?email=demo%40koda.test&password=koda2027&to=' + encodeURIComponent('#/today'));
  await p15.waitForSelector('#checklistCard');
  const ivToday = await p15.evaluate(() => ({ gym: document.documentElement.dataset.gym, pill: document.querySelector('.topbar .gym-pill').textContent, hero: getComputedStyle(document.querySelector('.hero')).backgroundImage, yes: getComputedStyle(document.documentElement).getPropertyValue('--yes').trim(), bg: getComputedStyle(document.body).backgroundColor, theme: document.querySelector('meta[name="theme-color"]').content, title: document.title }));
  check('Iron View look unchanged, signed in: navy hero and checks, the page’s silver-grey, an "Iron View" pill',
    ivToday.gym === 'ironview' && ivToday.pill === 'Iron View' && /rgb\(36, 64, 95\) 0%, rgb\(19, 37, 57\) 46%, rgb\(11, 23, 38\) 100%/.test(ivToday.hero) && ivToday.yes === '#0c1a2b' && ivToday.bg === 'rgb(242, 244, 247)' && ivToday.theme === '#0c1a2b' && ivToday.title === 'Koda Resolutions 2027', JSON.stringify(ivToday));
  await p15.goto(BASE + '/#/faqs');
  await p15.waitForSelector('.faq-item');
  const tzFaq = await p15.evaluate(() => Array.from(document.querySelectorAll('.faq-item')).map((d) => d.textContent).find((t) => /missed a day/.test(t)) || '');
  await c15.close();
  const c15b = await phone();
  const p15b = watch(await c15b.newPage());
  await p15b.goto(BASE + '/dev/as?email=ada.okc%40example.com&password=koda2027&to=' + encodeURIComponent('#/faqs'));
  await p15b.waitForSelector('.faq-item');
  const okcFaq = await p15b.evaluate(() => Array.from(document.querySelectorAll('.faq-item')).map((d) => d.textContent).find((t) => /missed a day/.test(t)) || '');
  check('FAQ: the week locks at midnight in the gym’s time zone (Mountain at Iron View, Central at OKC)', /until Monday at midnight \(Mountain time\)/.test(tzFaq) && /until Monday at midnight \(Central time\)/.test(okcFaq), okcFaq.slice(0, 160));
  await c15b.close();

  // (7) Screenshots for comparing the gyms: Today for each (phone, light); OKC, Tulsa and Iron View also
  // in dark and on a desktop, with their All gyms standings.
  const shotOf = { ironview: 'demo@koda.test', okc: 'olive.okc@example.com', tulsa: 'tia.tulsa@example.com' };
  for (const g of ['native', 'norman', 'downtown']) {
    const r = await signUp(g, 'Shot', 'shot.' + g + '@example.com', '');
    await api({ action: 'save', token: r.token, date: '2027-01-25', answers: { video: 1, workout: 1, sleep: 1, 'nutrition:m1': 1, 'nutrition:m2': 1, 'nutrition:m3': 1, 'nutrition:snack': 1 }, patch: true });
    await api({ action: 'save', token: r.token, date: '2027-01-26', answers: { video: 1, workout: 1 }, patch: true });
    shotOf[g] = 'shot.' + g + '@example.com';
  }
  const asUrl = (email, hash) => BASE + '/dev/as?email=' + encodeURIComponent(email) + '&password=koda2027&to=' + encodeURIComponent(hash);
  const c16 = await phone();
  const p16 = watch(await c16.newPage());
  const pills = [];
  for (const g of GYM_IDS) {
    await p16.goto(asUrl(shotOf[g], '#/today'));
    await p16.waitForSelector('#checklistCard');
    await wait(700);
    const seen = await p16.evaluate(() => ({ gym: document.documentElement.dataset.gym, pill: document.querySelector('.topbar .gym-pill').textContent, cut: (() => { const n = document.querySelector('.topbar .brand .name'); return n.scrollWidth > n.clientWidth + 1; })(), overflow: document.documentElement.scrollWidth - innerWidth }));
    pills.push(g + ':' + seen.gym + ':' + seen.pill + (seen.cut ? ':CUT' : '') + (seen.overflow > 0 ? ':OVERFLOW' : ''));
    await p16.screenshot({ path: path.join(OUT, `gym-${g}-today.png`), fullPage: true });
  }
  check('every gym’s Today is in its colors with its pill, and RESOLUTIONS fits beside it on a 390px phone', pills.join(',') === GYM_IDS.map((g) => g + ':' + g + ':' + CONTENT.gyms.find((x) => x.id === g).short).join(','), pills.join(','));
  await c16.close();
  for (const scheme of ['light', 'dark']) {
    const cd = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: scheme });
    const pd = watch(await cd.newPage());
    const cp = scheme === 'dark' ? await phone('dark') : null;
    const pp = cp ? watch(await cp.newPage()) : null;
    for (const g of ['ironview', 'okc', 'tulsa']) {
      await pd.goto(asUrl(shotOf[g], '#/today'));
      await pd.waitForSelector('#checklistCard');
      await wait(700);
      await pd.screenshot({ path: path.join(OUT, `gym-${g}-desktop-${scheme}-today.png`), fullPage: true });
      await pd.goto(BASE + '/#/leaderboard');
      await pd.waitForSelector('.lb-you');
      await pd.click('[data-act="board-scope"][data-scope="all"]');
      await pd.waitForSelector('.lb-gyms .lb-row[data-gym-row]');
      await pd.screenshot({ path: path.join(OUT, `gym-${g}-desktop-${scheme}-allgyms.png`), fullPage: true });
      if (pp) {
        await pp.goto(asUrl(shotOf[g], '#/today'));
        await pp.waitForSelector('#checklistCard');
        await wait(700);
        await pp.screenshot({ path: path.join(OUT, `gym-${g}-phone-dark-today.png`), fullPage: true });
        await pp.goto(BASE + '/#/leaderboard');
        await pp.waitForSelector('.lb-you');
        await pp.click('[data-act="board-scope"][data-scope="all"]');
        await pp.waitForSelector('.lb-gyms .lb-row[data-gym-row]');
        await pp.screenshot({ path: path.join(OUT, `gym-${g}-phone-dark-allgyms.png`), fullPage: true });
      }
    }
    const sideBrand = await pd.evaluate(() => { const b = document.querySelector('.sidebar .brand').getBoundingClientRect(), s = document.querySelector('.sidebar').getBoundingClientRect(), p = document.querySelector('.sidebar .gym-pill').getBoundingClientRect(); return { inside: b.right <= s.right && p.right <= s.right, pill: document.querySelector('.sidebar .gym-pill').textContent }; });
    check('desktop (' + scheme + '): the sidebar shows the gym pill under RESOLUTIONS 2027, inside the sidebar', sideBrand.inside && sideBrand.pill === 'Tulsa', JSON.stringify(sideBrand));
    await cd.close();
    if (cp) await cp.close();
  }

  // ---------------------------------------------------------------- review fixes (11/23/2026)
  // (8a) Sign-up addresses follow the server's stricter rule (one typo like "x@gmail.com." could make
  // a gym's whole morning email fail), and a workout-only checklist at a gym with no coaches goes from
  // Habits to Review (it used to send people back to Your gym, round and round).
  const c17 = await phone();
  const p17 = watch(await c17.newPage());
  await p17.goto(BASE + '/dev/blank?to=' + encodeURIComponent('?gym=native#/'));
  await p17.waitForSelector('[data-type="member"]');
  await p17.click('[data-type="member"]');
  await gymStep(p17, 'native');
  await p17.waitForSelector('[data-field="first"]');
  await p17.fill('[data-field="first"]', 'Nia');
  await p17.fill('[data-field="last"]', 'Native');
  await p17.fill('[data-field="password"]', 'koda2027');
  await p17.click('[data-shirt="tee"]');
  await p17.click('[data-size="M"]');
  const refused = [];
  for (const bad of ['nia@gmail.com.', 'nia@gmail.com,', 'ni..a@gmail.com', 'nia@gmail.com>', 'nïa@gmail.com', 'nia@gmail.c0m', '.nia@gmail.com']) {
    await p17.fill('[data-field="email"]', bad);
    await p17.click('[data-act="next"]');
    await wait(150);
    // (Taken: the page moved on to the goal step, so back to About for the next one.)
    if (!/#\/join\/about$/.test(p17.url())) { await p17.click('[data-act="back"]'); await p17.waitForSelector('[data-field="email"]'); continue; }
    if (/Enter a valid email\./.test(await p17.textContent('.flow-body'))) refused.push(bad);
  }
  check('sign-up refuses the addresses the server would (a dot at the end or start, a comma, two dots, >, an accent, .c0m)', refused.length === 7, refused.join(' '));
  await p17.fill('[data-field="email"]', 'Nia.Native@Example.com');
  await p17.click('[data-act="next"]');
  await p17.waitForSelector('[data-goal="health"]');
  await p17.click('[data-goal="health"]');
  await p17.click('[data-act="next"]');
  await p17.waitForSelector('[data-act="track"]');
  for (const id of ['nutrition', 'sleep', 'protein', 'hydration', 'finishers', 'skill', 'mobility', 'recovery', 'other']) await p17.click(`[data-act="track"][data-id="${id}"][data-val="0"]`);
  await p17.click('[data-act="next"]');
  await p17.waitForSelector('.review-sec');
  const niaReview = await p17.evaluate(() => ({ hash: location.hash, h1: document.querySelector('.flow-body h1').textContent, count: document.querySelector('.flow-count').textContent }));
  check('a workout-only checklist at a gym with no coaches goes from Habits straight to Review (not back to Your gym)', niaReview.hash === '#/join/review' && niaReview.h1 === 'Look good?' && niaReview.count === '5 of 5', JSON.stringify(niaReview));
  await p17.screenshot({ path: path.join(OUT, 'fix-native-review.png'), fullPage: true });
  await p17.click('[data-act="next"]');
  await p17.waitForSelector('#sheet', { timeout: 15000 });
  await p17.click('[data-act="close-sheet"]');
  const nia = await row('nia.native@example.com');
  check('…and "Create my account" makes it: a Native member', nia.Gym === 'Native' && nia.Type === 'Member', JSON.stringify({ gym: nia.Gym, type: nia.Type }));
  // Sign-in still takes an older-style address (the server finds accounts with the looser rule).
  await p17.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/signin'));
  await p17.waitForSelector('form[data-form="signin"]');
  await p17.fill('input[name="email"]', 'old.typo@gmail.com.');
  await p17.fill('input[name="password"]', 'koda2027');
  await p17.click('form[data-form="signin"] button[type="submit"]');
  await p17.waitForSelector('.form-error');
  const signinErr = await p17.textContent('.form-error');
  check('sign-in still sends an older-style address on to the server (it answers "couldn’t find an account", not the app’s "Enter your email")', /couldn’t find an account/.test(signinErr), signinErr);
  // (8a1) A member's link where nobody is signed in (11/24 review): the 3 AM email's "Log yesterday's
  // points" opens in the mail app's browser, signed out. Sign in comes first, then that day (it showed
  // the landing page, then Today). Signing out still goes to the landing page, and from there to Today.
  const cdl = await phone();
  const pdl = watch(await cdl.newPage());
  await pdl.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/day/2027-01-26'));
  await pdl.waitForSelector('form[data-form="signin"]');
  const dlBefore = await pdl.evaluate(() => ({ hash: location.hash, landing: !!document.querySelector('[data-type="member"]') }));
  await pdl.fill('input[name="email"]', 'nia.native@example.com');
  await pdl.fill('input[name="password"]', 'koda2027');
  await pdl.click('form[data-form="signin"] button[type="submit"]');
  await pdl.waitForSelector('#checklistCard', { timeout: 15000 });
  const dlAfter = await pdl.evaluate(() => ({ hash: location.hash, date: document.querySelector('#checklistCard').getAttribute('data-date') }));
  check('an email’s day link opened signed out shows Sign in (not the landing page), then that day', dlBefore.hash === '#/day/2027-01-26' && !dlBefore.landing && dlAfter.hash === '#/day/2027-01-26' && dlAfter.date === '2027-01-26', JSON.stringify({ dlBefore, dlAfter }));
  await pdl.evaluate(() => { location.hash = '#/profile'; });
  await pdl.waitForSelector('button[data-act="signout"]');
  await pdl.click('button[data-act="signout"]');
  await pdl.waitForSelector('[data-type="member"]');
  const dlOut = await pdl.evaluate(() => location.hash);
  await pdl.evaluate(() => { location.hash = '#/signin'; });
  await pdl.waitForSelector('form[data-form="signin"]');
  await pdl.fill('input[name="email"]', 'nia.native@example.com');
  await pdl.fill('input[name="password"]', 'koda2027');
  await pdl.click('form[data-form="signin"] button[type="submit"]');
  await pdl.waitForSelector('#checklistCard', { timeout: 15000 });
  const dlAgain = await pdl.evaluate(() => location.hash);
  check('…signing out from there goes to the landing page, and signing in again goes to Today', (dlOut === '#/' || dlOut === '') && dlAgain === '#/today', JSON.stringify({ dlOut, dlAgain }));
  await cdl.close();
  // …and the app's settings arriving while someone types there don't wipe the form (11/24 review:
  // the late config answer repainted it empty; on the live backend it takes a second or two).
  const cdl2 = await phone();
  const pdl2 = watch(await cdl2.newPage());
  await pdl2.route('**/api', async (rt) => {
    let action = '';
    try { action = JSON.parse(rt.request().postData() || '{}').action; } catch (e) { /* not JSON */ }
    if (action === 'config') await wait(1500);
    try { await rt.continue(); } catch (e) { /* page closed */ }
  });
  await pdl2.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/day/2027-01-26'));
  await pdl2.waitForSelector('form[data-form="signin"]');
  await pdl2.fill('input[name="email"]', 'nia.native@example.com');
  await pdl2.fill('input[name="password"]', 'koda2027');
  await wait(2500); // the config answer lands meanwhile
  const kept = await pdl2.evaluate(() => ({ email: document.querySelector('input[name="email"]').value, pw: document.querySelector('input[name="password"]').value.length }));
  await pdl2.click('form[data-form="signin"] button[type="submit"]');
  await pdl2.waitForSelector('#checklistCard', { timeout: 15000 });
  check('…and what was typed there stays when the app’s settings arrive late (they used to repaint it empty)', kept.email === 'nia.native@example.com' && kept.pw === 8 && pdl2.url().endsWith('#/day/2027-01-26'), JSON.stringify(Object.assign({ url: pdl2.url() }, kept)));
  await cdl2.close();
  // (8a2) An older-style address that is signed up (11/24 review): the About step says only "Sign in
  // instead", even when the answer that it's taken comes after Continue or Enter (the server takes
  // 0.7 s here), and the page stops asking (it asked again and again while the cursor stayed there).
  await signUp('ironview', 'Olga', 'old.typo@gmail.com', '');
  for (const tab of ['Participants', 'Accounts']) await get('/dev/cell?tab=' + tab + '&email=' + encodeURIComponent('old.typo@gmail.com') + '&col=Email&value=' + encodeURIComponent('old.typo@gmail.com.'));
  await get('/dev/slow?ms=700');
  const oldSeen = [];
  for (const how of ['tap', 'enter']) {
    const cx = await phone();
    const px = watch(await cx.newPage());
    const asks = [];
    px.on('request', (req) => { if (req.url().endsWith('/api') && req.method() === 'POST') { try { asks.push(JSON.parse(req.postData()).action); } catch (e) { /* not JSON */ } } });
    await px.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/'));
    await px.waitForSelector('[data-type="member"]', { timeout: 20000 });
    await px.click('[data-type="member"]');
    await gymStep(px, 'ironview');
    await px.waitForSelector('[data-field="first"]', { timeout: 20000 });
    await px.fill('[data-field="first"]', 'Olga');
    await px.fill('[data-field="last"]', 'Typo');
    await px.fill('[data-field="password"]', 'koda2027');
    await px.click('[data-shirt="tee"]');
    await px.click('[data-size="M"]');
    await px.fill('[data-field="email"]', 'old.typo@gmail.com.');
    asks.length = 0;
    if (how === 'tap') await px.tap('[data-act="next"]');
    else await px.press('[data-field="email"]', 'Enter');
    await wait(5000);
    const seen = await px.evaluate(() => {
      const el = document.querySelector('[data-field="email"]');
      return { hash: location.hash, errors: Array.from(el.closest('label').querySelectorAll('.error')).map((e) => e.textContent.trim()).filter(Boolean), invalid: el.classList.contains('is-invalid') };
    });
    oldSeen.push({ how, seen, asks: asks.filter((a) => a === 'emailStatus').length });
    if (how === 'tap') await px.screenshot({ path: path.join(OUT, 'fix-old-address-signed-up.png') });
    await cx.close();
  }
  await get('/dev/slow?ms=0');
  check('an older-style address that is already signed up: only “This email is already signed up. Sign in instead” (no “Enter a valid email.” too), tapped or Enter, and the page stops asking (3 at most)',
    oldSeen.every((x) => x.seen.hash === '#/join/about' && x.seen.errors.length === 1 && x.seen.errors[0] === 'This email is already signed up. Sign in instead' && x.seen.invalid && x.asks >= 1 && x.asks <= 3), JSON.stringify(oldSeen));

  // (8b) A sign-up saved on a phone before the gym step: the link's gym is picked already, and one
  // saved on Review comes back to Review after choosing how to pay (it walked every step again).
  const oldDraft = { memberType: 'member', first: 'Old', last: 'Draft', email: 'old.draft@example.com', shirt: 'tee', size: 'M', goal: 'health', track: { nutrition: true, workout: true, sleep: true, protein: false, hydration: false, finishers: false, skill: false, mobility: false, recovery: false, other: false }, plan: 'recommended', coaches: [] };
  await p17.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/'));
  await p17.waitForSelector('[data-type="member"]');
  await p17.evaluate((d) => localStorage.setItem('res27.draft', JSON.stringify(d)), oldDraft);
  await p17.goto(BASE + '/?gym=okc&restored=2#/join/track');
  await p17.waitForSelector('.gym-tile');
  await wait(200);
  const oldPicked = await p17.evaluate(() => ({ hash: location.hash, picked: Array.from(document.querySelectorAll('.gym-tile[aria-checked="true"]')).map((e) => e.dataset.id).join(','), gym: document.documentElement.dataset.gym }));
  if (!oldPicked.picked) await pickGym(p17, 'okc'); // (not picked: the check below fails, and the walk goes on)
  await p17.click('[data-act="next"]');
  await p17.waitForSelector('[data-act="track"]');
  check('an old saved sign-up opened from ?gym=okc asks for the gym with OKC picked already, then goes back to its step', oldPicked.hash === '#/join/gym' && oldPicked.picked === 'okc' && oldPicked.gym === 'okc' && /#\/join\/track$/.test(p17.url()), JSON.stringify(oldPicked) + ' ' + p17.url());
  // A card is offered at every gym now (Kevin, 11/23/2026: "put a placeholder for the card link,
  // we'll add one later"), so one saved with a card goes from Your gym straight back to Review.
  await p17.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/'));
  await p17.waitForSelector('[data-type="member"]');
  await p17.evaluate((d) => localStorage.setItem('res27.draft', JSON.stringify(d)), Object.assign({}, oldDraft, { memberType: 'remote', payment: 'card', email: 'old.card@example.com' }));
  await p17.goto(BASE + '/?restored=3#/join/review');
  await p17.waitForSelector('.gym-tile');
  await gymStep(p17, 'ironview');
  await p17.waitForSelector('.review-sec');
  const cardBack = await p17.evaluate(() => ({ hash: location.hash, text: document.querySelector('.review-sec').textContent }));
  check('an old saved remote sign-up with a card: Your gym, then straight back to Review, which says “$99 by credit card · we’ll email you a secure link” (no checkout link yet)',
    cardBack.hash === '#/join/review' && /Joining asRemote participant\$99 by credit card · we’ll email you a secure linkEdit/.test(cardBack.text), JSON.stringify(cardBack).slice(0, 300));
  // One saved with Venmo, at a gym without it (Tulsa): how to pay first (just the card there), then Review.
  await p17.goto(BASE + '/dev/blank?to=' + encodeURIComponent('#/'));
  await p17.waitForSelector('[data-type="member"]');
  await p17.evaluate((d) => localStorage.setItem('res27.draft', JSON.stringify(d)), Object.assign({}, oldDraft, { memberType: 'remote', payment: 'venmo', email: 'old.remote@example.com' }));
  await p17.goto(BASE + '/?restored=4#/join/review');
  await p17.waitForSelector('.gym-tile');
  await gymStep(p17, 'tulsa');
  await p17.waitForSelector('[data-act="pay"]');
  const detour = await p17.evaluate(() => ({ hash: location.hash, next: document.querySelector('[data-act="next"]').textContent, methods: Array.from(document.querySelectorAll('[data-act="pay"]')).map((e) => e.dataset.method).join(',') }));
  await p17.click('[data-method="card"]');
  await p17.click('[data-act="next"]');
  await p17.waitForSelector('.review-sec, [data-field="first"]');
  check('an old saved remote sign-up with Venmo, at a gym without it (Tulsa): Your gym, then how to pay (just the card), then straight back to Review', detour.hash === '#/join/payment' && detour.methods === 'card' && /Back to review/.test(detour.next) && /#\/join\/review$/.test(p17.url()), JSON.stringify(detour) + ' ' + p17.url());
  // …and "Create my account" (the password typed again): the welcome sheet and email say the card's
  // secure link comes by email, with no card button.
  await p17.waitForSelector('[data-field="password"]');
  await p17.fill('[data-field="password"]', 'koda2027');
  await p17.click('[data-act="next"]');
  await p17.waitForSelector('#sheet', { timeout: 15000 });
  const cardSheet = await p17.evaluate(() => ({ text: document.querySelector('#sheet').textContent, buttons: document.querySelectorAll('#sheet .callout a, #sheet .callout button').length }));
  await wait(600); // (the sheet slides up)
  await p17.screenshot({ path: path.join(OUT, 'fix-card-later-welcome.png') });
  const oldRemote = await row('old.remote@example.com');
  check('…signed up at Tulsa with a card: the welcome sheet says “send your $99 by card — we’ll email you a secure link”, with no card button; Payment = Credit Card',
    /One more step: send your \$99 by card — we’ll email you a secure link\./.test(cardSheet.text) && cardSheet.buttons === 0 && oldRemote.Payment === 'Credit Card' && oldRemote.Gym === 'Tulsa',
    JSON.stringify(cardSheet).slice(0, 300) + ' ' + JSON.stringify({ pay: oldRemote.Payment, gym: oldRemote.Gym }));
  const cardWelcome = (await get('/dev/emails')).filter((m) => m.to === 'old.remote@example.com').pop() || {};
  check('…and the welcome email: “pay by card. We’ll email you a secure link within a day”, no card button',
    /Your \$99 remote spot:<\/b> pay by card\. We’ll email you a secure link within a day\. We’ll mark you paid in the app\./.test(cardWelcome.htmlBody || '') && !/by card<\/a>/.test(cardWelcome.htmlBody || ''), String(cardWelcome.htmlBody || 'no welcome email').slice(0, 300));
  await c17.close();

  // (8c) Before Day 1: the Profile's gym picker, a gym change, and the Daily email switch.
  await get('/dev/time?set=' + encodeURIComponent('2026-12-20T10:00:00-07:00'));
  const remy = await api({ action: 'register', gym: 'ironview', memberType: 'remote', payment: 'venmo', first: 'Remy', last: 'Remote', email: 'remy.remote@example.com', password: 'koda2027', shirt: 'tee', size: 'M', setup: GYM_SETUP });
  const c18 = await phone();
  const p18 = watch(await c18.newPage());
  await p18.goto(asUrl('remy.remote@example.com', '#/edit/gym'));
  await p18.waitForSelector('.gym-tile');
  const remyNote = await p18.textContent('.flow-body');
  await p18.screenshot({ path: path.join(OUT, 'fix-gym-picker-paid-note.png'), fullPage: true });
  await p18.goto(asUrl('mo.okc@example.com', '#/edit/gym'));
  await p18.waitForSelector('.gym-tile');
  const moNote = await p18.textContent('.flow-body');
  check('Profile › Gym for a remote participant not marked paid yet: "Already paid? You’re all set" (a member isn’t told)', remy.ok && /Already paid\? You’re all set: we’ll move your payment over\./.test(remyNote) && !/Already paid/.test(moNote), remy.error || remyNote.slice(0, 160));
  // A gym change clears the team and coach Kevin gave for the old gym, and nothing on the page keeps them.
  await signUp('tulsa', 'Tess', 'tess.tulsa@example.com', 'Thunder');
  await get('/dev/cell?email=' + encodeURIComponent('tess.tulsa@example.com') + '&col=Coach&value=Sam');
  await p18.goto(asUrl('tess.tulsa@example.com', '#/leaderboard'));
  await p18.waitForSelector('.lb-board .lb-row, .lb-board .lb-empty'); // (Tulsa's standings are loaded on this page)
  const tessBefore = await p18.textContent('.lb-you');
  await p18.click('.tabbar a[href="#/profile"]');
  await p18.waitForSelector('#gymRow');
  const tessBadges = await p18.textContent('#main .card-pad');
  await p18.click('#gymRow');
  await pickGym(p18, 'okc');
  await p18.click('[data-act="save-edit"]');
  await p18.waitForFunction(() => location.hash === '#/profile' && document.documentElement.dataset.gym === 'okc');
  const tessMoved = await p18.evaluate(() => ({ toast: (document.querySelector('#toastWrap') || {}).textContent || '', card: document.querySelector('#main .card-pad').textContent }));
  await p18.screenshot({ path: path.join(OUT, 'fix-gym-change-cleared.png'), fullPage: true });
  await p18.click('.tabbar a[href="#/leaderboard"]');
  await p18.waitForSelector('.lb-you-gym');
  await wait(300);
  const tessAfter = await p18.textContent('.lb-you');
  const tess = await row('tess.tulsa@example.com');
  check('a gym change before Day 1 clears the old gym’s team and coach: the toast says so, the Profile and Leaderboard show none (the old board isn’t kept), the sheet is blank',
    /Team Thunder/.test(tessBefore) && /Koda Tulsa/.test(tessBefore) && /Team Thunder/.test(tessBadges) && /Coach Sam/.test(tessBadges) &&
    /Your team and coach were Tulsa’s, so they’re cleared: you’ll get OKC’s before Day 1\./.test(tessMoved.toast) && !/Thunder|Sam/.test(tessMoved.card) &&
    /Koda OKC/.test(tessAfter) && !/Thunder|Tulsa/.test(tessAfter) && tess.Gym === 'OKC' && tess.Team === '' && tess.Coach === '',
    JSON.stringify({ before: tessBefore, moved: tessMoved, after: tessAfter, row: { gym: tess.Gym, team: tess.Team, coach: tess.Coach } }));
  // Only a team, or only a coach (11/24 review): "a team at OKC", "a coach at Iron View" (it said "a OKC team").
  const moveToast = async (email, gym) => {
    await p18.goto(asUrl(email, '#/edit/gym'));
    await p18.waitForSelector('.gym-tile');
    await pickGym(p18, gym);
    await p18.click('[data-act="save-edit"]');
    await p18.waitForFunction((g) => location.hash === '#/profile' && document.documentElement.dataset.gym === g, gym);
    return p18.evaluate(() => (document.querySelector('#toastWrap') || {}).textContent || '');
  };
  await signUp('tulsa', 'Tad', 'tad.tulsa@example.com', 'Thunder');
  await signUp('tulsa', 'Cody', 'cody.tulsa@example.com', '');
  await get('/dev/cell?email=' + encodeURIComponent('cody.tulsa@example.com') + '&col=Coach&value=Sam');
  const teamOnly = await moveToast('tad.tulsa@example.com', 'okc');
  const coachOnly = await moveToast('cody.tulsa@example.com', 'ironview');
  check('a gym change that clears only the team, or only the coach, says “a team at OKC” and “a coach at Iron View”',
    /Your team was Tulsa’s, so it’s cleared: you’ll get a team at OKC before Day 1\./.test(teamOnly) && /Your coach was Tulsa’s, so that’s cleared: you’ll get a coach at Iron View before Day 1\./.test(coachOnly) &&
    !/\ba OKC|\ba Iron View/.test(teamOnly + coachOnly), JSON.stringify([teamOnly, coachOnly]));
  // The Daily email switch keeps keyboard focus while it saves; turned back on before Day 1 it says when they start.
  await p18.click('.tabbar a[href="#/profile"]');
  await p18.waitForSelector('[data-act="daily-email"]');
  await p18.focus('[data-act="daily-email"]');
  await p18.keyboard.press('Space');
  const busyFocus = await p18.evaluate(() => (document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.act : '') || '');
  await p18.waitForFunction(() => { const s = document.querySelector('[data-act="daily-email"]'); return s && s.getAttribute('aria-checked') === 'false' && s.getAttribute('aria-disabled') !== 'true' && !s.disabled; });
  const savedFocus = await p18.evaluate(() => (document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.act : '') || '');
  await p18.focus('[data-act="daily-email"]'); // (so a switch that lost focus still turns back on, and the check below says so)
  await p18.keyboard.press('Space');
  await p18.waitForFunction(() => { const s = document.querySelector('[data-act="daily-email"]'); return s && s.getAttribute('aria-checked') === 'true' && s.getAttribute('aria-disabled') !== 'true' && !s.disabled; });
  const onAgain = await p18.evaluate(() => ({ toast: (document.querySelector('#toastWrap') || {}).textContent || '', focus: (document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.act : '') || '' }));
  check('Profile › Daily email by keyboard: focus stays on the switch while it saves and after', busyFocus === 'daily-email' && savedFocus === 'daily-email' && onAgain.focus === 'daily-email', JSON.stringify([busyFocus, savedFocus, onAgain.focus]));
  check('…and turned back on before Day 1 it says they start on Day 1 (not "tomorrow morning")', /Daily emails on\. They start on Day 1, Monday, January 18\./.test(onAgain.toast) && (await row('tess.tulsa@example.com'))['Daily Email'] === 'On', onAgain.toast);

  // (8c2) A card at every gym (Kevin, 11/23/2026: "put a placeholder for the card link, we'll add one
  // later"), still before Day 1. Payment pending on Today and the Profile: at Tulsa (no Card URL) they
  // watch their email for the secure link, with no card button; at Native, once it has a Card URL,
  // the "Pay $99 by card" button as before (payment step and welcome email too).
  const payView = async (email) => {
    await p18.goto(asUrl(email, '#/today'));
    await p18.waitForSelector('.callout-warn');
    const today = await p18.evaluate(() => {
      const c = document.querySelector('.callout-warn');
      return { text: c.textContent, links: Array.from(c.querySelectorAll('a, button')).map((a) => (a.getAttribute('href') || '') + ' ' + a.textContent.trim()) };
    });
    await p18.click('.tabbar a[href="#/profile"]');
    await p18.waitForSelector('#gymRow');
    const profile = await p18.evaluate(() => {
      const s = Array.from(document.querySelectorAll('#main section.card')).find((x) => (x.querySelector('h3') || {}).textContent === 'Payment');
      return s ? { text: s.querySelector('.card-body p').textContent, links: Array.from(s.querySelectorAll('a, button')).map((a) => (a.getAttribute('href') || '') + ' ' + a.textContent.trim()) } : null;
    });
    return { today, profile };
  };
  const tara = await api({ action: 'register', gym: 'tulsa', memberType: 'remote', payment: 'card', first: 'Tara', last: 'Card', email: 'tara.tulsa@example.com', password: 'koda2027', shirt: 'tee', size: 'M', setup: GYM_SETUP });
  const taraPay = await payView('tara.tulsa@example.com');
  await p18.screenshot({ path: path.join(OUT, 'fix-card-later-profile.png'), fullPage: true });
  check('a card at a gym with no checkout link yet (Tulsa): Today and the Profile say “Send $99 by card — watch your email for a secure link”, with no card button',
    tara.ok && /Payment pending\. Send \$99 by card — watch your email for a secure link\. We’ll mark it here when it comes in\./.test(taraPay.today.text) && taraPay.today.links.length === 0 &&
    !!taraPay.profile && taraPay.profile.text === 'Send $99 by card — watch your email for a secure link. We’ll mark it here when it comes in.' && taraPay.profile.links.length === 0,
    JSON.stringify({ err: tara.error, taraPay }).slice(0, 500));
  // A Payment the app can't show (here the "Email them how to pay" of the first six-gym build) still says we'll email them how.
  await get('/dev/cell?email=' + encodeURIComponent('tara.tulsa@example.com') + '&col=Payment&value=' + encodeURIComponent('Email them how to pay'));
  const laterPay = await payView('tara.tulsa@example.com');
  check('…and a row whose Payment is “Email them how to pay” still says “We’ll email you how to pay the $99”, with no button',
    /Payment pending\. We’ll email you how to pay the \$99\. We’ll mark it here when it comes in\./.test(laterPay.today.text) && laterPay.today.links.length === 0 && !!laterPay.profile && /^We’ll email you how to pay the \$99\./.test(laterPay.profile.text) && laterPay.profile.links.length === 0,
    JSON.stringify(laterPay).slice(0, 400));
  await gymCell('native', 'Card URL', 'https://pay.example.com/native');
  await p18.goto(BASE + '/dev/blank?to=' + encodeURIComponent('?gym=native#/'));
  await p18.waitForSelector('[data-type="remote"]');
  await p18.click('[data-type="remote"]');
  await gymStep(p18, 'native');
  await p18.waitForSelector('[data-method="card"]');
  const nativeSub = await p18.textContent('[data-method="card"] .o-sub');
  await p18.click('[data-method="card"]');
  const nativeDetail = await p18.evaluate(() => ({ text: document.querySelector('.pay-detail').textContent, href: (document.querySelector('.pay-detail a') || {}).href || '', later: !!document.querySelector('.card-later') }));
  const nate = await api({ action: 'register', gym: 'native', memberType: 'remote', payment: 'card', first: 'Nate', last: 'Card', email: 'nate.native@example.com', password: 'koda2027', shirt: 'tee', size: 'M', setup: GYM_SETUP });
  const nateMail = (await get('/dev/emails')).filter((m) => m.to === 'nate.native@example.com').pop() || {};
  const natePay = await payView('nate.native@example.com');
  await gymCell('native', 'Card URL', '');
  const nateButton = 'https://pay.example.com/native Pay $99 by card';
  check('with a Card URL (Native) the card is that checkout, as before: “Secure online checkout”, “Pay securely” to it, and a “Pay $99 by card” button in the welcome email, on Today and the Profile',
    nativeSub === 'Secure online checkout' && /Pay \$99 by card/.test(nativeDetail.text) && nativeDetail.href === 'https://pay.example.com/native' && !nativeDetail.later &&
    nate.ok && /pay by card:<br><a href="https:\/\/pay\.example\.com\/native"[^>]*>Pay \$99 by card<\/a>\. We’ll mark you paid in the app\./.test(nateMail.htmlBody || '') && !/secure link/.test(nateMail.htmlBody || '') &&
    /Payment pending\. Send \$99 by card\. We’ll mark it here when it comes in\./.test(natePay.today.text) && natePay.today.links.join('|') === nateButton &&
    !!natePay.profile && natePay.profile.text === 'Send $99 by card. We’ll mark it here when it comes in.' && natePay.profile.links.join('|') === nateButton,
    JSON.stringify({ nativeSub, nativeDetail, err: nate.error, natePay }).slice(0, 600));

  // (8d) Day 1 by each gym's own clock: 11:30 PM in Denver on Jan 17 is 12:30 AM on Day 1 in Oklahoma.
  await get('/dev/time?set=' + encodeURIComponent('2027-01-17T23:30:00-07:00'));
  await p18.goto(asUrl('olive.okc@example.com', '#/profile'));
  await p18.waitForSelector('#gymRow');
  const okcLock = await p18.evaluate(() => ({ tag: document.querySelector('#gymRow').tagName, text: document.querySelector('#gymRow').textContent }));
  await p18.goto(asUrl('demo@koda.test', '#/profile'));
  await p18.waitForSelector('#gymRow');
  const ivLock = await p18.evaluate(() => ({ tag: document.querySelector('#gymRow').tagName, text: document.querySelector('#gymRow').textContent }));
  check('the gym is set from Day 1 on the gym’s own date: at 11:30 PM Mountain on Jan 17, OKC’s Profile says ask Kevin, Iron View’s can still change', okcLock.tag === 'DIV' && /Ask Kevin to change it/.test(okcLock.text) && ivLock.tag === 'A' && /you can change it until Day 1/.test(ivLock.text), JSON.stringify([okcLock, ivLock]));
  // …but not into OKC, whose Day 1 has started (11/24 review: they couldn't have moved back).
  await p18.click('#gymRow');
  await pickGym(p18, 'okc');
  await p18.click('[data-act="save-edit"]');
  await p18.waitForSelector('.form-error');
  const intoOkc = await p18.textContent('.form-error');
  check('…though moving Iron View’s into OKC then is refused: “Day 1 has already started at Koda OKC”', /^Day 1 has already started at Koda OKC, so you can’t move there now\. Ask Kevin\.$/.test(intoOkc) && (await row('demo@koda.test')).Gym === 'Iron View', intoOkc);
  // (8d2) The phone's own date counts too (11/24 review): at 10:30 PM in Denver a New York phone is on
  // Jan 18, Day 1 (the server takes its date, and it can log Day 1), so its gym is set; a Mountain
  // phone at that moment can still change it.
  await get('/dev/time?set=' + encodeURIComponent('2027-01-17T22:30:00-07:00'));
  const ivan = await signUp('ironview', 'Ivan', 'ivan.east@example.com', '');
  const cny = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/New_York' });
  const pny = watch(await cny.newPage());
  await pny.clock.setFixedTime(new Date('2027-01-17T22:30:00-07:00'));
  await pny.goto(asUrl('ivan.east@example.com', '#/profile'));
  await pny.waitForSelector('#gymRow');
  const nyRow = await pny.evaluate(() => ({ tag: document.querySelector('#gymRow').tagName, text: document.querySelector('#gymRow').textContent }));
  await pny.screenshot({ path: path.join(OUT, 'fix-new-york-phone-day1-gym.png'), fullPage: true });
  await cny.close();
  await p18.goto(asUrl('ivan.east@example.com', '#/profile'));
  await p18.waitForSelector('#gymRow');
  const mtRow = await p18.evaluate(() => document.querySelector('#gymRow').tagName);
  const nyMove = await api({ action: 'setup', token: ivan.token, gym: 'okc', today: '2027-01-18' });
  check('a New York phone at 10:30 PM Mountain on Jan 17 is on Day 1: its Profile has the gym set (“Ask Kevin”) and the server refuses its move; a Mountain phone can still change it',
    ivan.ok && nyRow.tag === 'DIV' && /Ask Kevin to change it/.test(nyRow.text) && nyMove.code === 'locked_gym' && mtRow === 'A' && (await row('ivan.east@example.com')).Gym === 'Iron View', JSON.stringify({ nyRow, mtRow, nyMove: nyMove.code || nyMove.ok }));
  await get('/dev/time?set=' + encodeURIComponent('2027-01-27T19:30:00-07:00'));

  // (8e) "Stop the daily emails" tells a screen reader it worked (focus on "Done." and a toast), and
  // someone else's link on a phone signed in as another person doesn't offer that person's Profile.
  const off3 = await get('/dev/email-off?email=' + encodeURIComponent('cal.okc@example.com'));
  await p18.goto(BASE + '/dev/blank?to=' + encodeURIComponent(off3.path.slice(1)));
  await p18.waitForSelector('[data-act="email-off"]');
  await p18.focus('[data-act="email-off"]');
  await p18.keyboard.press('Enter');
  await p18.waitForFunction(() => /Done\./.test(document.querySelector('#emailOff').textContent));
  const offA11y = await p18.evaluate(() => { const w = document.querySelector('#toastWrap'); const a = document.activeElement; return { focus: a ? a.tagName + ':' + a.textContent : '', toast: w ? w.textContent : '', live: w ? w.getAttribute('aria-live') : '' }; });
  check('email-off by keyboard: focus lands on "Done." and the polite toast says the daily emails are off', offA11y.focus === 'H1:Done.' && /Done\. The daily emails are off\./.test(offA11y.toast) && offA11y.live === 'polite' && (await row('cal.okc@example.com'))['Daily Email'] === 'Off', JSON.stringify(offA11y));
  const off4 = await get('/dev/email-off?email=' + encodeURIComponent('ben.okc@example.com'));
  await p18.goto(asUrl('demo@koda.test', off4.path.slice(1)));
  await p18.waitForSelector('[data-act="email-off"]');
  await p18.waitForFunction(() => !!localStorage.getItem('res27.me'));
  await p18.click('[data-act="email-off"]');
  await p18.waitForFunction(() => /Done\./.test(document.querySelector('#emailOff').textContent));
  const otherDone = await p18.evaluate(() => ({ text: document.querySelector('#emailOff').textContent, profile: !!document.querySelector('#emailOff a[href="#/profile"]') }));
  await p18.screenshot({ path: path.join(OUT, 'fix-email-off-someone-else.png') });
  check('someone else’s link, signed in as another person: "Done. Those daily emails are off." and no "Open my Profile"',
    /Done\.\s*Those daily emails are off\./.test(otherDone.text) && !otherDone.profile && (await row('ben.okc@example.com'))['Daily Email'] === 'Off' && (await row('demo@koda.test'))['Daily Email'] !== 'Off', JSON.stringify(otherDone));
  await c18.close();

  // (8f) Phones: a chosen No keeps its ✕ at every width, Norman's chosen Yes is its near-black (its
  // crimson looked like the red No), and the Today ring takes each gym's own color.
  const c19 = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p19 = watch(await c19.newPage());
  await p19.goto(asUrl('shot.norman@example.com', '#/today'));
  await p19.waitForSelector('#checklistCard');
  await p19.click('#checklistCard [data-act="answer"][data-key="video"][data-val="1"]');
  await p19.click('#checklistCard [data-act="answer"][data-key="workout"][data-val="0"]');
  await wait(400);
  const ynLook = await p19.evaluate(() => {
    const yes = document.querySelector('#checklistCard .yn-btn.yes.is-on'), no = document.querySelector('#checklistCard .yn-btn.no.is-on');
    const x = getComputedStyle(no, '::before'), stop = document.querySelector('#ringGrad stop[offset="1"]');
    return { yes: getComputedStyle(yes).backgroundColor, no: getComputedStyle(no).backgroundColor, x: x.display + ' ' + x.width, ring: stop ? getComputedStyle(stop).stopColor : '', overflow: Math.max(document.documentElement.scrollWidth, innerWidth) - 360 };
  });
  await p19.screenshot({ path: path.join(OUT, 'fix-norman-360-today.png'), fullPage: true });
  await p19.goto(asUrl('demo@koda.test', '#/today'));
  await p19.waitForSelector('#dayHero');
  const ivRing = await p19.evaluate(() => getComputedStyle(document.querySelector('#ringGrad stop[offset="1"]')).stopColor);
  check('Norman at 360px: a chosen Yes is near-black, a chosen No red with its ✕; the ring is Norman’s pink-red (Iron View’s stays silver)',
    ynLook.yes === 'rgb(18, 12, 12)' && ynLook.no === 'rgb(180, 35, 24)' && !/^none/.test(ynLook.x) && ynLook.ring === 'rgb(240, 163, 161)' && ivRing === 'rgb(185, 194, 204)' && ynLook.overflow <= 0, JSON.stringify(ynLook) + ' iv ' + ivRing);
  await c19.close();

  // (8g) The narrowest phones (320-360px): RESOLUTIONS stays whole next to every gym's pill, the sign-in,
  // reset and email-off cards fit, and "Koda Downtown" breaks between its words in the gym list.
  const tight = [];
  const offDt = await get('/dev/email-off?email=' + encodeURIComponent('shot.downtown@example.com'));
  for (const w of [320, 345, 360]) {
    const cn = await browser.newContext({ viewport: { width: w, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const pn = watch(await cn.newPage());
    for (const g of GYM_IDS) {
      await pn.goto(asUrl(shotOf[g], '#/today'));
      await pn.waitForSelector('#checklistCard');
      await pn.evaluate(() => document.fonts.ready);
      const t = await pn.evaluate((W) => { const n = document.querySelector('.topbar .brand .name'); return { cut: n.scrollWidth > n.clientWidth + 1, over: Math.max(document.documentElement.scrollWidth, innerWidth) - W }; }, w);
      if (t.cut || t.over > 0) tight.push(w + ' ' + g + ' top bar' + (t.cut ? ' cut' : '') + (t.over > 0 ? ' +' + t.over + 'px' : ''));
      if (w === 320 && (g === 'downtown' || g === 'ironview')) await pn.screenshot({ path: path.join(OUT, `fix-320-${g}-today.png`) });
    }
    if (w === 320) {
      for (const g of ['downtown', 'ironview', 'norman']) {
        for (const to of ['?gym=' + g + '#/signin', '?gym=' + g + '#/forgot', g === 'downtown' ? offDt.path.slice(1) : '']) {
          if (!to) continue;
          await pn.goto(BASE + '/dev/blank?to=' + encodeURIComponent(to));
          await pn.waitForSelector('.auth-card');
          await pn.evaluate(() => document.fonts.ready);
          const a = await pn.evaluate((W) => ({ over: Math.max(document.documentElement.scrollWidth, innerWidth) - W, right: Math.round(document.querySelector('.auth-card').getBoundingClientRect().right) }), w);
          if (a.over > 0 || a.right > w - 16) tight.push(w + ' ' + to + ' card +' + a.over + 'px');
          if (g === 'downtown' && /signin/.test(to)) await pn.screenshot({ path: path.join(OUT, 'fix-320-downtown-signin.png') });
        }
      }
      await pn.goto(asUrl(shotOf.downtown, '#/leaderboard'));
      await pn.waitForSelector('[data-act="board-scope"][data-scope="all"]');
      await pn.click('[data-act="board-scope"][data-scope="all"]');
      await pn.waitForSelector('.lb-gyms .lb-row[data-gym-row]');
      await pn.evaluate(() => document.fonts.ready);
      const split = await pn.evaluate(() => Array.from(document.querySelectorAll('.lb-gym-name')).map((b) => {
        const tn = Array.from(b.childNodes).filter((n) => n.nodeType === 3).pop();
        let i = 0;
        const broken = tn.textContent.split(' ').filter((word) => { const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + word.length); i += word.length + 1; return new Set(Array.from(r.getClientRects()).filter((x) => x.width > 0).map((x) => Math.round(x.top))).size > 1; });
        return broken.length ? tn.textContent + ' (' + broken.join(',') + ')' : '';
      }).filter(Boolean));
      if (split.length) tight.push('320 gym list breaks inside ' + split.join(', '));
      await pn.screenshot({ path: path.join(OUT, 'fix-320-allgyms.png'), fullPage: true });
    }
    await cn.close();
  }
  check('the narrowest phones (320, 345, 360px): RESOLUTIONS whole by every gym’s pill, the sign-in, reset and email-off cards inside the screen, gym names whole', tight.length === 0, tight.slice(0, 6).join(' | '));

  // (8h) A gym whose numbers are withheld because 1 or 2 people are on a team that's too small says
  // so truthfully (everyone there is on a team: "Shows once everyone's on a team" wasn't true).
  for (const n of ['Rae', 'Rex', 'Roy']) await signUp('norman', n, n.toLowerCase() + '.norman@example.com', 'Red');
  for (const email of ['mo.okc@example.com', 'shot.norman@example.com']) await get('/dev/cell?email=' + encodeURIComponent(email) + '&col=Team&value=Blue');
  const c20 = await phone();
  const p20 = watch(await c20.newPage());
  await p20.goto(asUrl('demo@koda.test', '#/leaderboard'));
  await p20.waitForSelector('[data-act="board-scope"][data-scope="all"]');
  await p20.click('[data-act="board-scope"][data-scope="all"]');
  await p20.waitForSelector('[data-gym-row="norman"]');
  const normanRow = await p20.evaluate(() => { const r = document.querySelector('[data-gym-row="norman"]'); return { text: r.textContent, rank: r.querySelector('.lb-rank').textContent }; });
  check('a gym held back because two people are on a team of 2 says "Shows once everyone’s on a team of 3 or more" (no rank)', /5 people/.test(normanRow.text) && /Shows once everyone’s on a team of 3 or more/.test(normanRow.text) && normanRow.rank === '', JSON.stringify(normanRow));
  await c20.close();

  // (8i) Link previews and the install sheet name no gym (all six gyms share the link's picture).
  const indexHtml = await (await fetch(BASE + '/')).text();
  const ogUrl = (/property="og:image" content="([^"]+)"/.exec(indexHtml) || [])[1] || '';
  const ogPng = Buffer.from(await (await fetch(BASE + '/assets/og.png')).arrayBuffer());
  const ogHash = require('node:crypto').createHash('sha256').update(ogPng).digest('hex').slice(0, 16);
  const manifest = await (await fetch(BASE + '/manifest.webmanifest')).json();
  check('link previews and the install sheet name no gym: og.png?v=5 (the new 1200x630 picture), a generic manifest in neutral colors',
    /og\.png\?v=5$/.test(ogUrl) && ogPng.readUInt32BE(16) === 1200 && ogPng.readUInt32BE(20) === 630 && ogHash !== '897ae6940725ba2e' &&
    !/Iron View/i.test(JSON.stringify(manifest)) && /Koda CrossFit/.test(manifest.description) && manifest.theme_color !== '#0c1a2b' && manifest.background_color !== '#0c1a2b',
    JSON.stringify({ ogUrl, ogHash, manifest: { description: manifest.description, theme: manifest.theme_color, bg: manifest.background_color } }));

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
