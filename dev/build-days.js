'use strict';

/**
 * Turns the 2027 video plan (JSON from the planning workflow) into content/days-2027.json,
 * the rows the backend writes to the Days tab. Video links stay blank: the coaches fill them in
 * as they film. The 2026 video each day can reuse or refresh goes in the hidden reference column,
 * and the filming notes (key points, length, versions, presenter plan) go in "Notes (not shown)".
 *
 * The plan assumed some app features that don't exist yet (notes, timers, team chat, quizzes),
 * so ACTION and BONUS below reword those days to things people can do today.
 *   node dev/build-days.js <plan.json>
 */

const fs = require('node:fs');
const path = require('node:path');

const planFile = process.argv[2];
if (!planFile) throw new Error('usage: node dev/build-days.js <plan.json>');
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));

const THEMES = { 1: 'Start Strong', 2: 'Build Your Plate', 3: 'Fuel Your Goal', 4: 'Recover and Adapt', 5: 'Dial It In', 6: 'Make It Yours' };

const CATEGORY = {
  'Kickoff & program logistics': 'Kickoff',
  'Leaderboard / community / fun': 'Wig Wednesday',
  'Nutrition fundamentals & plan rules': 'Nutrition',
  'Protein': 'Protein',
  'Carbohydrates': 'Carbs',
  'Fats & oils': 'Fats',
  'Food quality & sourcing': 'Food quality',
  'Hydration & digestion': 'Hydration & gut',
  'Sleep & recovery': 'Recovery',
  'Stress / HRV / breathing': 'Stress & recovery',
  'Hormones': 'Hormones',
  'Supplements': 'Supplements',
  'Alcohol, sugar & cheats': 'Real life',
  'Training & conditioning': 'Training',
  'Mindset & habits': 'Mindset',
  'FAQ': 'Ask the Coaches',
  'Finishing & life after the challenge': 'Finish strong',
};

// Who's on camera, short enough for the video card. The full presenter plan stays in Notes.
const PRESENTER = {
  1: 'Kevin', 2: 'Kevin', 3: 'Kevin', 4: '', 5: 'Kevin', 6: 'Maggie & Riley', 7: 'Maggie', 8: 'Molly Moore', 9: 'Kevin',
  10: 'The Wig Wednesday crew', 11: 'Maggie', 12: 'Jamie', 13: 'Jamie', 14: 'The coaches', 15: 'Kevin', 16: 'Riley',
  17: 'The Wig Wednesday crew', 18: '', 19: 'Maggie', 20: 'Riley', 21: 'Kevin', 22: 'Jamie', 23: 'Kevin',
  24: 'The Wig Wednesday crew', 25: 'Kevin', 26: 'Jamie', 27: 'Kevin', 28: 'The coaches', 29: 'Riley & Maggie', 30: 'Riley',
  31: 'The Wig Wednesday crew', 32: 'Brice', 33: 'Brice', 34: 'Brice', 35: 'Maggie', 36: 'Kevin', 37: 'Kevin',
  38: 'All four coaches', 39: 'Jamie', 40: 'Kevin', 41: 'Riley', 42: 'Kevin',
};

const ACTION = {
  1: 'Do your baseline tester and take private before photos (front, side and back).',
  3: 'Tonight, turn screens off 30 minutes before bed and pick a lights-out time.',
  5: 'Plan the weekend now: the events, what you’ll order, and your first on-plan meal afterward.',
  8: 'Build dinner by hand tonight: a palm of protein, a fist of veggies, a cupped hand of carbs, a thumb of fat.',
  9: 'Work out your protein target (about 0.7–1 g per pound of goal bodyweight) and eat a palm of protein first at every meal today.',
  10: 'Send your team captain one win from your week for next week’s shout-outs.',
  11: 'Write down your most common craving and an if-then plan for it.',
  14: 'Pick one thing to tighten up for week 3.',
  15: 'Write the “minimum version” of each item on your checklist for tough days.',
  16: 'Start the carb experiment: notice how tonight’s carbs affect your energy and hunger.',
  24: 'Share one non-scale win with your team.',
  26: 'Write down your weekend plan: what you’ll eat and drink, and your first on-plan meal afterward.',
  29: 'Re-film your skill or mobility clip and set a target for Day 41.',
  31: 'Cheer on a teammate who’s had a tough week.',
  32: 'Rate your readiness 1–5 this morning (or check your HRV) and match today’s workout to it.',
  34: 'Do 3–5 minutes of box breathing tonight.',
  35: 'Set your 7-for-7 goal for the final week.',
  36: 'Write down the three habits that gave you the most.',
  38: 'Tell your team your 7-for-7 finish goal.',
  39: 'Decide how often you’ll spot-check your habits after the challenge (weekly or monthly).',
  40: 'Write your one-page Resolutions Playbook: your habits, your go-to meals and your plan for slips.',
  41: 'Do your retest and take your after photos.',
  42: 'Set a phone reminder four weeks from now to check in on your habits.',
};

const ABOUT = {
  29: 'Measure progress on your extras and push them through the last two weeks.',
  30: 'Know the few supplements worth considering once sleep, food and water are in place, and how to choose them safely.',
};

const BONUS = {
  2: 'Kitchen reset: box up the off-plan foods',
  3: 'Send your coach your #1 goal and biggest obstacle',
  4: 'Introduce yourself to your team: name, goal and one fun fact',
  7: 'Week 1 check-in: share one win with your team or coach',
  10: '',
  12: 'Send a question for Sunday’s Ask the Coaches',
  14: 'Week 2 check-in: share one win with your team or coach',
  17: '',
  24: 'Suggest a topic for a future video',
  28: 'Week 4 check-in: share one win with your team or coach',
  31: '',
  35: 'Book your retest (members: grab an InBody slot)',
  37: 'Share the three habits you’ll keep with your team',
  38: '',
  42: 'Fill out the final survey',
};

/** The plan's objectives are written for coaches ("Participants know ..."); this makes them read to the participant. */
function forParticipant(text) {
  let s = String(text || '').trim().replace(/^Participants\s+/i, '');
  s = s.replace(/\btheir\b/g, 'your').replace(/\bthemselves\b/g, 'yourself').replace(/\bthey\b/g, 'you').replace(/\bthem\b/g, 'you');
  if (/^can\s/i.test(s)) s = 'You ' + s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const days = plan.days
  .slice()
  .sort((a, b) => a.day - b.day)
  .map((d) => {
    const week = d.week || Math.ceil(d.day / 7);
    const notes = [
      'Objective: ' + d.objective,
      d.keyPoints && d.keyPoints.length ? 'Key points: ' + d.keyPoints.join(' | ') : '',
      d.targetMinutes ? 'Target length: ~' + d.targetMinutes + ' min' : '',
      d.presenter ? 'Presenter plan: ' + d.presenter : '',
      d.variant && d.variant !== 'one video for everyone' ? 'Versions: ' + d.variant + (d.variantNotes ? ' (' + d.variantNotes + ')' : '') : d.variantNotes ? 'Notes: ' + d.variantNotes : '',
      d.actionItem && ACTION[d.day] ? 'Plan’s original action: ' + d.actionItem : '',
    ].filter(Boolean).join('\n');
    const bonus = Object.prototype.hasOwnProperty.call(BONUS, d.day) ? BONUS[d.day] : d.bonusTask || '';
    return {
      day: d.day,
      week,
      theme: THEMES[week] || '',
      title: d.title,
      video: '',
      category: CATEGORY[d.category] || d.category,
      about: ABOUT[d.day] || forParticipant(d.objective),
      action: ACTION[d.day] || d.actionItem,
      bonus,
      bonusPoints: bonus ? 4 : '',
      presenter: Object.prototype.hasOwnProperty.call(PRESENTER, d.day) ? PRESENTER[d.day] : d.presenter,
      notes,
      ref: d.reuseFrom2026 || '',
    };
  });

if (days.length !== 42) throw new Error('expected 42 days, got ' + days.length);
// The filming notes and 2026 references name guests and members, so they stay out of the public
// repo: content/private/ is git-ignored. dev/live.js seeds the live Days tab from the full file.
const privateDir = path.join(__dirname, '..', 'content', 'private');
fs.mkdirSync(privateDir, { recursive: true });
fs.writeFileSync(path.join(privateDir, 'days-2027-full.json'), JSON.stringify(days, null, 1) + '\n');
fs.writeFileSync(path.join(privateDir, 'video-plan-2027.json'), JSON.stringify(plan, null, 1) + '\n');
const COACH_ONLY = /^(Kevin|Riley|Jamie|Maggie|Maggie & Riley|Riley & Maggie|The coaches|All four coaches|The Wig Wednesday crew)$/;
const publicDays = days.map((d) => Object.assign({}, d, { notes: '', ref: '', presenter: COACH_ONLY.test(d.presenter) ? d.presenter : '' }));
const out = path.join(__dirname, '..', 'content', 'days-2027.json');
fs.writeFileSync(out, JSON.stringify(publicDays, null, 1) + '\n');
console.log('wrote', out, 'and content/private/', days.length, 'days');
