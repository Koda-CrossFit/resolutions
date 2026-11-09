'use strict';

/**
 * Turns the 2027 video plan (JSON from the planning workflow) into content/days-2027.json,
 * the rows the backend writes to the Days tab. Video links stay blank: the coaches fill them in
 * as they film. The 2026 video it can reuse or refresh goes in the hidden reference column.
 *   node dev/build-days.js <plan.json>
 */

const fs = require('node:fs');
const path = require('node:path');

const planFile = process.argv[2];
if (!planFile) throw new Error('usage: node dev/build-days.js <plan.json>');
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const themes = {};
(plan.weeklyThemes || []).forEach((w) => {
  themes[w.week] = String(w.theme || '').replace(/^Week\s*\d+\s*[:\-–—]\s*/i, '').trim();
});

const days = plan.days
  .slice()
  .sort((a, b) => a.day - b.day)
  .map((d) => {
    const notes = [
      d.keyPoints && d.keyPoints.length ? 'Key points: ' + d.keyPoints.join(' | ') : '',
      d.targetMinutes ? 'Target length: ~' + d.targetMinutes + ' min' : '',
      d.variant && d.variant !== 'one video for everyone' ? 'Versions: ' + d.variant + (d.variantNotes ? ' (' + d.variantNotes + ')' : '') : '',
    ].filter(Boolean).join('\n');
    return {
      day: d.day,
      week: d.week || Math.ceil(d.day / 7),
      theme: themes[d.week || Math.ceil(d.day / 7)] || '',
      title: d.title,
      video: '',
      category: d.category,
      about: d.objective,
      action: d.actionItem,
      bonus: d.bonusTask || '',
      bonusPoints: d.bonusTask ? 4 : '',
      presenter: d.presenter || '',
      notes,
      ref: d.reuseFrom2026 || '',
    };
  });

if (days.length !== 42) throw new Error('expected 42 days, got ' + days.length);
const out = path.join(__dirname, '..', 'content', 'days-2027.json');
fs.writeFileSync(out, JSON.stringify(days, null, 1) + '\n');
console.log('wrote', out, days.length, 'days');
