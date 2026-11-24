'use strict';

/**
 * dev/live.js's six-gym and daily-email commands (gyms, set-gym, email-preview, email-send,
 * email-triggers) and the dev server's /dev/run-daily and /dev/email-off, run for real against the
 * LOCAL dev server (never the live backend; every live.js run is preloaded with local-only-guard.js).
 *   node dev/server.js   (port 8790), then:   node tests/email-cli.js   (it resets that server)
 *   Another port: BASE=http://localhost:8796 node tests/email-cli.js
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BASE || 'http://localhost:8790';
const KEY = 'test-admin-key-123';
const LIVE = path.join(__dirname, '..', 'dev', 'live.js');
const GUARD = path.join(__dirname, 'local-only-guard.js');
const PREVIEWS = path.join(__dirname, '..', 'dev', 'screenshots', 'email-previews');

const api = (body) => fetch(BASE + '/api', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ type: 'res27' }, body)) }).then((r) => r.json());
const get = (p) => fetch(BASE + p).then((r) => r.json());
const at = (iso) => get('/dev/time?set=' + encodeURIComponent(iso));
const rows = (tab) => get('/dev/rows?tab=' + encodeURIComponent(tab));

function cli(args) {
  const vars = Object.assign({}, process.env, { RES27_URL: BASE + '/api', RES27_ADMIN_KEY: KEY });
  try {
    return { code: 0, out: execFileSync(process.execPath, ['-r', GUARD, LIVE].concat(args), { env: vars, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? ' — ' + detail : ''));
}

const SETUP = { goal: 'health', track: { nutrition: false, workout: true, sleep: true }, plan: 'recommended', sleepHours: 7, coaches: [] };
const join = (email, gym, extra) => api(Object.assign({ action: 'register', gym, memberType: 'member', first: email.split('@')[0], last: 'Cli', email, password: 'secret1', shirt: 'tee', size: 'L', setup: SETUP }, extra || {}));

(async () => {
  const made = new Set(fs.existsSync(PREVIEWS) ? fs.readdirSync(PREVIEWS) : []);
  await get('/dev/reset');
  await at('2027-01-10T10:00:00-07:00');
  check('dev world: no welcome emails', (await api({ action: 'adminSetup', key: KEY, settings: { welcome_email: false } })).ok);
  const ann = await join('ann@example.com', 'okc');
  await join('bea@example.com', 'okc');
  await join('ivy@example.com', 'ironview');
  check('three sign-ups at two gyms', ann.ok && ann.me.person.gym === 'okc', JSON.stringify(ann.error || ''));

  let r = cli(['gyms']);
  // (A card at every gym, Kevin 11/23/2026: "put a placeholder for the card link, we'll add one later".)
  check('gyms lists the six with their people, ways to pay (a card everywhere, no link yet) and the daily email’s state', r.code === 0 && /6 gyms/.test(r.out) && /OKC \(okc\) · Koda OKC · Oklahoma City, OK · 7016 Ozzy Ave/.test(r.out) && /2 people · daily email on 2, off 0/.test(r.out) &&
    /Downtown \(downtown\)[^\n]*NO ADDRESS/.test(r.out) && /pays by Venmo @kevin-schuetz-5, Zelle kodaironview@gmail\.com, card \(NO LINK YET: email card payers a secure link\)/.test(r.out) &&
    /\$99 remote · pays by card \(NO LINK YET: email card payers a secure link\) · coaches: none/.test(r.out) && !/NOTHING YET/.test(r.out) && /Daily email: off · provider mailapp/.test(r.out), r.out);
  await get('/dev/cell?email=' + encodeURIComponent('bea@example.com') + '&col=Team&value=Thunder');
  r = cli(['set-gym', 'bea@example.com', 'Koda Tulsa']);
  const bea = (await rows('Participants')).find((p) => p.Email === 'bea@example.com');
  check('set-gym moves someone (a full name works)', r.code === 0 && /"gym": "tulsa"/.test(r.out) && bea.Gym === 'Tulsa', r.out);
  check('…and clears the old gym’s Team, saying so', /Cleared Team Thunder \(they were for the old gym\): set the new ones on Participants\./.test(r.out) && /"teamCleared": "Thunder"/.test(r.out) && bea.Team === '', r.out);
  r = cli(['set-gym', 'bea@example.com', 'Austin']);
  check('set-gym refuses a gym that isn’t one (exit 1)', r.code === 1 && /No gym is called \\"Austin\\"/.test(r.out), r.out);
  r = cli(['setting', 'email_provider', 'sendgrid']);
  check('setting email_provider only takes resend, brevo, mailapp or off', r.code === 1 && /email_provider is one of resend, brevo, mailapp, off/.test(r.out), r.out);
  r = cli(['setting', 'email_hour', '13']);
  check('setting email_hour only takes 0 to 11', r.code === 1 && /email_hour is a whole hour from 0 to 11/.test(r.out), r.out);
  r = cli(['setting', 'email_hour', '3']);
  check('setting email_hour needs nothing else now (the trigger runs every hour)', r.code === 0 && /first hourly run past 3:00 in its own time zone\. Nothing else needs changing\./.test(r.out) && !/email-triggers on/.test(r.out), r.out);
  r = cli(['setting', 'venmo', '@someone']);
  check('setting venmo says each gym’s Venmo is on the Gyms tab now', r.code === 0 && /no longer reads venmo from Settings/.test(r.out), r.out);

  // Day 3 at OKC: Ann logged nothing for Monday, so her preview has the Overdue box.
  await at('2027-01-20T01:00:00-06:00');
  r = cli(['email-preview', 'okc', 'ann@example.com']);
  const file = (/Saved the email as (.+\.html)/.exec(r.out) || [])[1];
  check('email-preview saves the page under dev/screenshots/email-previews and prints the text', r.code === 0 && !!file && fs.existsSync(file) && file.startsWith(PREVIEWS) &&
    /Subject: Day 3 · /.test(r.out) && /You haven’t logged Monday, January 18 \(Day 1\) yet/.test(r.out) && /"overdue": true/.test(r.out), r.out);
  check('…the saved page is the email', !!file && /<!doctype html>/.test(fs.readFileSync(file, 'utf8')) && /Koda OKC/.test(fs.readFileSync(file, 'utf8')));
  r = cli(['email-preview', 'okc', '--date=2027-01-12']);
  check('email-preview before Day 1 says there’s no email that day', r.code === 0 && /No daily email on 2027-01-12/.test(r.out), r.out);
  r = cli(['email-preview', 'okc', '--date=2027-13-01']);
  check('email-preview refuses a date that isn’t one', r.code === 1 && /--date needs a real day/.test(r.out), r.out);
  r = cli(['email-send', 'okc']);
  // (Every command it prints names the day, so it still means that day if it's run later: 11/24 review.)
  check('email-send without --yes is a dry run that lists who gets what, and what --yes would do', r.code === 0 && /1 would get "Day 3 · /.test(r.out) && /- ann@example.com {2}\(overdue\)/.test(r.out) &&
    /Nothing sent\. To send it to all 1: node dev\/live\.js email-send okc --date=2027-01-20 --yes/.test(r.out), r.out);
  check('…and nothing was sent', (await get('/dev/emails')).length === 0);
  r = cli(['email-send', 'okc', '--yes=abc']);
  check('email-send --yes takes no value', r.code === 1 && /--yes takes no value here/.test(r.out), r.out);
  r = cli(['email-send', 'okc', '--force']);
  check('email-send --force only goes with --yes', r.code === 1 && /--force only goes with --yes/.test(r.out), r.out);
  r = cli(['email-send', 'okc', '--yes']);
  let mail = await get('/dev/emails');
  check('email-send --yes sends it (the dev world’s provider is mailapp, so it lands in /dev/emails)', r.code === 0 && /Sent 1, failed 0/.test(r.out) && mail.length === 1 && mail[0].to === 'ann@example.com' && /You haven’t logged/.test(mail[0].htmlBody), r.out);
  r = cli(['email-send', 'okc', '--yes']);
  check('a second send of today’s is refused without --force', r.code === 1 && /already gone out/.test(r.out), r.out);
  r = cli(['email-send', 'okc', '--yes', '--force']);
  check('…and goes with --force', r.code === 0 && /Sent 1/.test(r.out) && (await get('/dev/emails?clear=1')).length === 2, r.out);
  r = cli(['email-send', 'okc']);
  check('…after which the dry run says today’s went out, and --yes --force is the way to send it again', r.code === 0 && /Today’s has already gone out, and nobody is waiting for it to be sent again\. To send it to all 1 again anyway: node dev\/live\.js email-send okc --date=2027-01-20 --yes --force/.test(r.out), r.out);

  // Another day, by hand (11/23 review): a later day is refused (that morning's run sends it), an
  // earlier one needs --force, and --to sends any day's to one address without marking anything.
  r = cli(['email-send', 'okc', '--date=2027-01-21']);
  check('email-send a later day (dry run): says it hasn’t come yet, and offers --to, never a send to the gym', r.code === 0 && /2027-01-21 hasn’t come yet: that morning’s run sends it\. To try it on one address now: node dev\/live\.js email-send okc --date=2027-01-21 --to=<email> --yes/.test(r.out) && !/--date=2027-01-21 --yes/.test(r.out), r.out);
  r = cli(['email-send', 'okc', '--date=2027-01-21', '--yes', '--force']);
  check('…and a real send of it is refused, even with --force (exit 1)', r.code === 1 && /That day hasn’t come yet/.test(r.out), r.out);
  r = cli(['email-send', 'okc', '--date=2027-01-19', '--yes']);
  check('a real send of an earlier day needs --force (exit 1)', r.code === 1 && /an earlier day’s: everyone who got it then would get it again/.test(r.out), r.out);
  r = cli(['email-send', 'okc', '--date=2027-01-21', '--to=kevin.test@example.com']);
  check('email-send --to (dry run): that one address, with the gym’s common email (not on the list)', r.code === 0 && /kevin\.test@example\.com would get the gym’s common email \(they aren’t on the list that day: nobody on Participants has that email\): "Day 4 · /.test(r.out) && /--to=kevin\.test@example\.com --yes/.test(r.out), r.out);
  r = cli(['email-send', 'okc', '--date=2027-01-21', '--to=kevin.test@example.com', '--yes']);
  mail = await get('/dev/emails?clear=1');
  check('email-send --to --yes sends it to just that address, a later day included, and marks nothing', r.code === 0 && /Sent 1, failed 0 \(okc, 2027-01-21, only to kevin\.test@example\.com: the gym’s common email; nothing was marked\)/.test(r.out) && mail.length === 1 && mail[0].to === 'kevin.test@example.com' && /Day 4 · /.test(mail[0].subject), r.out);
  r = cli(['email-send', 'okc', '--to=ann@example.com']);
  check('email-send --to someone on the list: their own email', r.code === 0 && /ann@example\.com would get their own email \(with the Overdue box\): "Day 3 · /.test(r.out), r.out);
  r = cli(['email-send', 'okc', '--to=nobody']);
  check('email-send --to needs an address', r.code === 1 && /--to needs the one address/.test(r.out), r.out);
  r = cli(['email-send', 'okc', '--to=ann@example.com', '--yes', '--force']);
  check('email-send --to doesn’t take --force', r.code === 1 && /--force doesn’t go with --to/.test(r.out), r.out);

  r = cli(['email-triggers', 'on']);
  check('email-triggers on: one hourly trigger for every gym’s zone, and says what’s still off', r.code === 0 && /runs every hour: each gym’s goes on the first run past 3:00 in its own time zone \(America\/Denver, America\/Chicago\)/.test(r.out) && /daily_email is FALSE/.test(r.out), r.out);
  r = cli(['email-triggers']);
  check('email-triggers lists it', r.code === 0 && /"on": true/.test(r.out) && (r.out.match(/"every": "hour"/g) || []).length === 1, r.out);
  r = cli(['email-triggers', 'maybe']);
  check('email-triggers takes on, off or nothing', r.code === 1 && /takes on, off, or nothing/.test(r.out), r.out);
  r = cli(['email-triggers', 'off']);
  check('email-triggers off removes them', r.code === 0 && /"on": false/.test(r.out), r.out);

  // The dev hooks the app and e2e use.
  await at('2027-01-21T03:10:00-06:00');
  const dailyRows = async () => (await rows('Log')).filter((l) => /^Daily email/.test(l.What)).length;
  const rowsBefore = await dailyRows(); // (the --to send above has one for 2027-01-21: it's a send by hand)
  const dry = await get('/dev/run-daily?gym=okc&dry=1');
  mail = await get('/dev/emails');
  check('/dev/run-daily?gym=okc&dry=1 puts OKC’s emails in /dev/emails, sending nothing', dry.ok && dry.dryRun && dry.gyms.length === 1 && dry.gyms[0].count === 1 && mail.length === 1 && mail[0].daily && mail[0].dryRun && /email-off\?u=/.test(mail[0].emailOff), JSON.stringify(dry));
  const all = await get('/dev/run-daily?dry=1');
  check('/dev/run-daily?dry=1 does every gym', all.ok && all.gyms.map((g) => g.gym).join() === 'ironview,okc,native,norman,downtown,tulsa' && all.emails.length === 3, JSON.stringify(all.gyms));
  check('…and marks nothing as sent (no Log row, OKC’s day still open)', (await dailyRows()) === rowsBefore && !/okc 2027-01-21/.test(cli(['gyms']).out));
  const link = await get('/dev/email-off?email=ann@example.com');
  check('/dev/email-off gives a person’s signed link', link.ok && /^R[A-Z2-9]{6}$/.test(link.u) && /^[0-9a-f]{24}$/.test(link.s) && link.path === '/?gym=okc#/email-off?u=' + link.u + '&s=' + link.s && link.url.endsWith(link.path.slice(1)), JSON.stringify(link));
  check('…the same link as in her email', mail[0].emailOff === link.url, mail[0].emailOff + ' vs ' + link.url);
  const off = await api({ action: 'emailOff', u: link.u, s: link.s });
  check('emailOff with it turns her daily email off', off.ok && off.first === 'ann' && (await rows('Participants')).find((p) => p.Email === 'ann@example.com')['Daily Email'] === 'Off', JSON.stringify(off));
  await api({ action: 'adminSetup', key: KEY, settings: { daily_email: true } });
  await get('/dev/emails?clear=1');
  const trig = await get('/dev/run-daily');
  mail = await get('/dev/emails');
  check('/dev/run-daily runs the trigger: Tulsa (Bea) goes, OKC has nobody left, Iron View waits for Denver', trig.ok && trig.gyms.find((g) => g.gym === 'tulsa').status === 'sent' && trig.gyms.find((g) => g.gym === 'okc').status === 'nobody' && trig.gyms.find((g) => g.gym === 'ironview').status === 'not due' && mail.length === 1 && mail[0].to === 'bea@example.com', JSON.stringify(trig));
  const real = await get('/dev/run-daily?gym=ironview');
  check('/dev/run-daily?gym=ironview sends Iron View’s now', real.ok && real.sent === 1 && (await get('/dev/emails')).some((m) => m.to === 'ivy@example.com'), JSON.stringify(real));
  r = cli(['gyms']);
  check('gyms shows the last day each gym’s went out', r.code === 0 && /Last sent: ironview 2027-01-21, okc 2027-01-20, native never, norman never, downtown never, tulsa 2027-01-21/.test(r.out), r.out);
  const venmo = await get('/dev/gym?gym=okc&col=Venmo&value=' + encodeURIComponent('@koda-okc'));
  const okcCfg = (await api({ action: 'config' })).config.gyms.find((g) => g.id === 'okc');
  check('/dev/gym sets a Gyms tab cell, and the app sees it at once', venmo.ok && okcCfg.venmo === '@koda-okc', JSON.stringify(okcCfg));
  check('/dev/gym refuses a gym or column that isn’t there', (await get('/dev/gym?gym=austin&col=Venmo&value=x')).ok === false && (await get('/dev/gym?gym=okc&col=Paypal&value=x')).ok === false);

  // ---- The 11/24 review: failed sends, as Kevin meets them, through the dev world's fake Resend
  // (the mock answers every request itself, here on this computer).
  await get('/dev/reset');
  await at('2027-01-10T10:00:00-07:00');
  await api({ action: 'adminSetup', key: KEY, settings: { welcome_email: false, daily_email: true } });
  for (const p of ['amy', 'ben', 'cat', 'dan']) await join(p + '@example.com', 'okc');
  await join('eve@example.com', 'tulsa');
  // Dan's address got in before the stricter check (as 1.7 let it).
  await get('/dev/cell?email=dan%40example.com&col=Email&value=' + encodeURIComponent('dan@gmail.com.'));
  check('/dev/resend?on=1: the dev world’s emails through the fake Resend', (await get('/dev/resend?on=1')).ok && (await get('/dev/resend?fail=ben%40example.com&how=refuse')).ok && (await get('/dev/resend?fail=eve%40example.com&how=lost')).ok);
  // Tuesday's only run is at 11:10 in Oklahoma: Ben is turned down, Eve's batch gets no answer.
  await at('2027-01-19T11:10:00-06:00');
  const tue = await fetch(BASE + '/dev/run-daily').then((x) => x.json());
  check('the alarm names the day in each command: OKC’s last run before noon says to send it by hand, Tulsa’s unconfirmed one to check Resend’s log first',
    tue.ok === false && /OKC: 1 of 3 not sent \(that was the last run before noon, so send it by hand: node dev\/live\.js email-send okc --date=2027-01-19 --yes sends it to them/.test(tue.error) &&
    /Tulsa: 1 of 1 got no answer from Resend, so they may have it, and nothing sends it to them again on its own \(check Resend’s log, then node dev\/live\.js email-send tulsa --date=2027-01-19 --yes sends it again/.test(tue.error) && /: eve@example\.com\./.test(tue.error), String(tue.error).slice(0, 600));
  const log = (await rows('Log')).filter((l) => /^Daily email · OKC · 2027-01-19/.test(l.What)).pop() || {};
  check('…and OKC’s Log row names Dan, whose address isn’t valid', /· 1 skipped, address not valid$/.test(log.What) && /skipped, address not valid \(fix Email on Participants and Accounts\): dan@gmail\.com\./.test(log.Detail), JSON.stringify(log));
  r = cli(['gyms']);
  check('gyms counts Dan as skipped (not "on"), lists his address to fix, and shows each gym’s list for its day with the command',
    r.code === 0 && /4 people · daily email on 3, off 0, 1 skipped \(address not valid\)/.test(r.out) && /the daily email skips them until Email is fixed on both Participants and Accounts:\n {2}! dan Cli <dan@gmail\.com\.> \(OKC\)/.test(r.out) &&
    /! okc 2027-01-19: 1 whose email failed, waiting to be sent again \(node dev\/live\.js email-send okc --date=2027-01-19 shows them\)/.test(r.out) &&
    /! tulsa 2027-01-19: 1 unconfirmed \(no answer from Resend: they may have it\), waiting to be sent again \(node dev\/live\.js email-send tulsa --date=2027-01-19 shows them\)/.test(r.out) && /"badEmail": 1/.test(r.out), r.out);
  // Wednesday's run goes fine, and Tuesday's lists stay (they used to be deleted by it).
  await get('/dev/resend?clear=1');
  await at('2027-01-20T03:10:00-06:00');
  const wed = await get('/dev/run-daily');
  check('Wednesday’s run sends Wednesday’s', wed.ok && wed.gyms.find((g) => g.gym === 'okc').sent === 3, JSON.stringify(wed).slice(0, 300));
  await at('2027-01-20T07:30:00-06:00');
  r = cli(['email-send', 'okc', '--date=2027-01-19']);
  check('the next morning, email-send okc --date=<Tuesday> shows Ben waiting and Dan skipped, and --yes would go to just Ben',
    r.code === 0 && /1 of them are waiting for it to be sent again \(their send that day failed\):\n {2}- ben@example\.com/.test(r.out) && /1 skipped, address not valid \(fix Email on Participants and Accounts\): dan@gmail\.com\./.test(r.out) &&
    /To send it to just the 1 waiting: node dev\/live\.js email-send okc --date=2027-01-19 --yes \(with --force it goes to all 3 again\)/.test(r.out), r.out);
  await get('/dev/emails?clear=1');
  r = cli(['email-send', 'okc', '--date=2027-01-19', '--yes']);
  mail = await get('/dev/emails');
  check('…and with --yes Tuesday’s goes to Ben only', r.code === 0 && /Sent 1, failed 0 \(okc, 2027-01-19, to the ones waiting\)\./.test(r.out) && mail.length === 1 && mail[0].to === 'ben@example.com' && /^Day 2 · /.test(mail[0].subject) && mail[0].via === 'resend', r.out + JSON.stringify(mail.map((m) => m.to)));
  r = cli(['email-send', 'tulsa', '--date=2027-01-19']);
  check('email-send tulsa --date=<Tuesday> lists Eve as unconfirmed: check Resend’s log first', r.code === 0 && /1 of them are unconfirmed: their send that day got no answer from Resend, so they may have it\. Check Resend’s log first/.test(r.out) && /- eve@example\.com/.test(r.out) && /To send it to just the 1 waiting: node dev\/live\.js email-send tulsa --date=2027-01-19 --yes/.test(r.out), r.out);
  r = cli(['email-send', 'tulsa', '--date=2027-01-19', '--yes']);
  mail = await get('/dev/emails?clear=1');
  check('…her resend is the same batch with the same Idempotency-Key, so Resend sends her nothing again (it took the first)', r.code === 0 && /Sent 1, failed 0 \(tulsa, 2027-01-19, to the ones waiting\)\./.test(r.out) && !mail.some((m) => m.to === 'eve@example.com'), r.out + JSON.stringify(mail.map((m) => m.to)));
  // By hand while a run is still to come (the trigger is on, before 11): the next run sends it; in
  // the afternoon none is left, so: send it by hand, with the day (it used to say "the next run").
  cli(['email-triggers', 'on']);
  await get('/dev/resend?fail=ben%40example.com&how=refuse');
  await at('2027-01-21T09:00:00-06:00');
  r = cli(['email-send', 'okc', '--yes']);
  check('a hand send before 11 that fails for one: the next run before noon sends it to them (or the command, with --date, now)', r.code === 0 && /Sent 2, failed 1 \(okc, 2027-01-21\)\. The 1 it failed for are kept: the next run before noon sends it to them \(or node dev\/live\.js email-send okc --date=2027-01-21 --yes now\)\./.test(r.out), r.out);
  await at('2027-01-21T13:00:00-06:00');
  r = cli(['email-send', 'okc', '--yes']);
  check('…the same in the afternoon: send it by hand, with --date', r.code === 0 && /Sent 0, failed 1 \(okc, 2027-01-21, to the ones waiting\)\. The 1 it failed for are kept: send it by hand: node dev\/live\.js email-send okc --date=2027-01-21 --yes/.test(r.out), r.out);
  for (const p of ['amy', 'cat']) await get('/dev/resend?fail=' + p + '%40example.com&how=down');
  await at('2027-01-22T13:00:00-06:00');
  r = cli(['email-send', 'okc', '--yes']);
  check('a hand send in the afternoon where nothing went out: the day is open again, and it says to send it by hand (not "the next run before noon")', r.code === 0 && /Sent 0, failed 3 \(okc, 2027-01-22\)\. None of it went out, so the day is open again: send it by hand: node dev\/live\.js email-send okc --date=2027-01-22 --yes/.test(r.out) && !/next run before noon/.test(r.out), r.out);
  cli(['email-triggers', 'off']);
  await get('/dev/resend?off=1');

  if (fs.existsSync(PREVIEWS)) for (const f of fs.readdirSync(PREVIEWS)) if (!made.has(f)) fs.unlinkSync(path.join(PREVIEWS, f));
  await get('/dev/time?clear=1');
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  process.exitCode = failed ? 1 : 0;
})().catch((e) => {
  console.error('FAILED', e);
  process.exitCode = 1;
});
