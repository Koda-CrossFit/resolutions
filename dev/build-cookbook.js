'use strict';

/**
 * Builds content/cookbook.json (the app's "Koda Cookbook" tab) from the text rendering Google Drive
 * makes of the "2026 Koda Resolutions Cookbook" PDF. That rendering is markdown-ish: every PDF line is
 * its own paragraph, the page header and footer repeat on every page, punctuation is backslash-escaped.
 *
 *   node dev/build-cookbook.js [path-to-pdf-text]
 *
 * The source defaults to content/private/cookbook-2026-pdf.txt (git-ignored). The recipes stay as the
 * PDF prints them: same sections, titles, tags, headings, order and wording. The script removes the
 * extraction artifacts (page headers and footers, markdown escapes, line breaks that the PDF or the
 * pasted-in original put in the middle of a sentence or an item) and the few artifacts that are printed
 * in the PDF itself, listed above cleanupLines(). Hand fixes go in OVERRIDES, so re-running always
 * rebuilds the same file. The build stops if the result doesn't match the PDF's table of contents.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SOURCE = path.join(__dirname, '..', 'content', 'private', 'cookbook-2026-pdf.txt');
const OUTPUT = path.join(__dirname, '..', 'content', 'cookbook.json');

/** Bold all-caps lines right under a recipe title are tags (the black pills in the PDF)... */
const KNOWN_TAGS = ['HIGH PROTEIN', 'PALEO', 'PLANT BASED', 'QUICK', 'WHOLE30', 'VEGAN', 'VEGETARIAN', 'GLUTEN FREE', 'DAIRY FREE', 'KETO', 'LOW CARB'];
/** ...except these, which are headings (the red labels). Bold all-caps lines further down are always headings. */
const KNOWN_HEADINGS = ['INGREDIENTS', 'DIRECTIONS', 'INSTRUCTIONS', 'PREPARATION', 'METHOD', 'STEPS', 'NUTRITION', 'MACROS', 'NOTES', 'NOTE', 'TIPS', 'CREDIT', 'SOURCE', 'EQUIPMENT', 'SERVES', 'YIELD'];

/**
 * OVERRIDES: one-off fixes by recipe number. Each names a PDF line by its exact text (as the PDF
 * prints it, bullet included, after the repairs in cleanupLines()) and is applied before the lines
 * are put back together.
 *   join:    [line, ...]          this line continues the line above it
 *   noJoin:  [line, ...]          this line starts a new line even if it looks like a continuation
 *   drop:    [line, ...]          leave this line out
 *   replace: [[line, text], ...]  use this text for that line
 */
const OVERRIDES = {
  // A name split over two lines: "...by Shalane Flanagan and Elyse / Kopecky (with minor tweaks)."
  17: { join: ['Kopecky (with minor tweaks). Their original recipe is here . Note: These are gluten-free.'] },
  // A blog page printed into the PDF. Its star rating, author line, tool plug, "Cook Mode" button and
  // the blogger's own story aren't part of the recipe, and the app is public, so they're left out
  // (11/10/2026). The title keeps the "Baked by Melissa" credit; the storage tip stays.
  22: { drop: [
    'Rated 3.7 stars by 386 users',
    'CATEGORY AUTHOR: Recipes Melissa Ben-Ishay',
    'Get all my tool recommendations for making the Green Goddess easily here.',
    "I can't count how many times I've made this salad over the past few years - the first time I made it, it",
    'became the hit of the party, with all my friends asking for the recipe. Since I posted it on TikTok in',
    'September 2021, more than 26 MILLION people have viewed the video. It landed me on the TODAY',
    'Show and even became the number 6 top searched recipe of 2022. So crazy.',
    'Because of its popularity, I also know the most typical variations. Truly, I encourage you to take the',
    'components of this recipe and make it your own, using the veggies and flavors you love. Go ahead',
    'and add an avocado for extra creaminess or a jalapeño for heat. Swap out the herbs to change the',
    'flavor profile. Eat it with a chip, a fork, on tacos, or on toast. Create the perfect green goddess salad',
    "you love, that will keep you excited to eat it again and again. I can't wait to see how you make it.",
    'Cook Mode',
  ] },
  // Web recipe-card leftovers: the photo's caption, the page's own title, the Course / Cuisine / Keyword
  // labels, and a cut-off pointer to the blog post ("...information in the"). Prep, cook time,
  // servings and calories stay.
  24: { drop: [
    'buffalo chicken meatballs in a pan with green onions',
    'Easy Buffalo Chicken Meatballs (Whole30 and Keto)',
    'Course Main Course',
    'Cuisine American',
    'Keyword Buffalo Chicken Meatballs',
    "8. As always, lots of tips, FAQ's and substitution information in the",
  ] },
  // "...garlic sausage, sliced / (or chicken thighs, 1" pieces)": the brackets belong to that ingredient.
  40: { join: ['(or chicken thighs, 1" pieces)'] },
  // Two paragraphs on PDF page 73, although the first one's last line is full and ends a sentence
  // ("...Add the ground meat of choice and the garlic." / "Cook, stirring often, ...").
  52: { noJoin: ['Cook, stirring often, until meat is browned, 7 to 10 minutes. Season with the remaining 1 tsp salt, 1/2 tsp'] },
};

// ---------------------------------------------------------------------------------------------
// Text helpers

/** Undoes Drive's markdown (links, backslash escapes, entities) and drops control characters. */
function unescape(s) {
  const code = (n) => (n < 32 || (n >= 127 && n < 160) ? '' : String.fromCodePoint(n));
  return String(s)
    .replace(/(^|[^\\])\[([^\]]*)\]\([^)]*\)/g, '$1$2')
    .replace(/&#(\d+);/g, (m, n) => code(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => code(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\\([!-\/:-@\[-`{-~])/g, '$1')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(s) {
  return String(s).toLowerCase().replace(/['’]/g, '').replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Same text, ignoring spacing and case. */
function same(a, b) {
  const norm = (x) => String(x).replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(a) === norm(b);
}

// Arial/Arimo widths (1/1000 em): the PDF's body font, to tell a line that ran into the right margin
// from one that ended on its own.
const ARIAL = (() => {
  const w = {};
  const set = (chars, width) => { for (const c of chars) w[c] = width; };
  set(' !,./:;I[\\]fijlt', 278); set('ijl', 222); set('"', 355); set('#$0123456789?L_abdeghnopqu', 556);
  set('%', 889); set('&ABEKPSVXY', 667); set("'", 191); set('()-`r', 333); set('*', 389); set('+<=>~', 584);
  set('@', 1015); set('CDHNRUw', 722); set('FTZ', 611); set('GOQ', 778); set('J', 500); set('M', 833); set('W', 944);
  set('^', 469); set('cksvxyz', 500); set('m', 833); set('{}', 334); set('|', 260);
  set('•', 350); set('×', 584); set('éèñ', 556); set('î', 278); set('…', 1000); set('’‘', 222); set('“”', 333); set('–', 556); set('—', 1000); set('°', 400);
  return w;
})();
function textWidth(s, size) {
  let units = 0;
  for (const c of s) units += ARIAL[c] || 556;
  return (units * size) / 1000;
}

// ---------------------------------------------------------------------------------------------
// 1. Pages

/** Splits the text into pages, [{ page, lines: [{ raw, text, bold }] }], without the repeated header and footer. */
function readPages(source) {
  const pages = [];
  let current = null;
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    const marker = line.match(/^\|\s*\[\*\*Page (\d+)\*\*\]\(\)\s*\|$/);
    if (marker) {
      current = { page: Number(marker[1]), lines: [] };
      pages.push(current);
      continue;
    }
    const t = line.trim();
    if (!current || !t) continue;
    if (/^-{3,}$/.test(t)) { current = null; continue; } // page break; the next page starts at its marker
    if (/^\|/.test(t)) continue; // the little page-number table
    if (t === '**KODA RESOLUTIONS COOKBOOK**' || t === 'Koda community recipes' || /^Page \d+$/.test(t)) continue;
    if (/^\[Back to table of contents\]\(#\d+\)$/.test(t)) continue;
    const bold = t.match(/^\*\*(.+)\*\*$/);
    const text = unescape(bold ? bold[1] : t);
    if (text) current.lines.push({ raw: t, text, bold: !!bold });
  }
  return pages;
}

// ---------------------------------------------------------------------------------------------
// 2. Cover and table of contents

function readCover(page) {
  const lines = page.lines.map((l) => l.text);
  // The cover has the 2025 text under the 2026 artwork, so it names two editions: take the newest.
  const editions = page.lines.filter((l) => l.bold && /^\d{4} Edition$/.test(l.text)).map((l) => l.text).sort();
  if (!editions.length) throw new Error('no "YYYY Edition" line on the cover');
  const start = lines.findIndex((t) => /^Recipes from the Koda community/i.test(t));
  if (start < 0) throw new Error('no "Recipes from the Koda community" line on the cover');
  let tagline = lines[start];
  for (let i = start + 1; i < lines.length && !/[.!?]$/.test(tagline); i++) tagline += ' ' + lines[i];
  return { edition: editions[editions.length - 1], tagline };
}

function readContents(pages) {
  const sections = [];
  for (const p of pages) {
    for (const l of p.lines) {
      const sec = l.raw.match(/^\*\*\[([^\]]+)\]\(#(\d+)\)\*\*$/);
      if (sec && !/^\d+$/.test(sec[1].trim())) { // (the bold page numbers above each section are links too)
        sections.push({ title: unescape(sec[1]), page: Number(sec[2]), recipes: [] });
        continue;
      }
      const rec = l.raw.match(/^\[Recipe (\d+) - (.+)\]\(#(\d+)\)$/);
      if (rec) {
        if (!sections.length) throw new Error('recipe before any section in the contents: ' + l.raw);
        sections[sections.length - 1].recipes.push({ n: Number(rec[1]), title: unescape(rec[2]), page: Number(rec[3]) });
      }
    }
  }
  return sections;
}

// ---------------------------------------------------------------------------------------------
// 3. Sections and recipes

function isAllCaps(t) {
  return /^[A-Z0-9][A-Z0-9 &+\/'-]*$/.test(t) && /[A-Z].*[A-Z]/.test(t);
}

/** Classifies one PDF line of a recipe: heading, bullet, numbered step or plain text. */
function classify(l) {
  if (l.bold && isAllCaps(l.text)) return { kind: 'heading', text: l.text };
  if (l.bold) return { kind: 'text', text: l.text, bold: true }; // e.g. "Submitted by Kale"
  let text = l.text;
  const bulleted = /^•/.test(text);
  if (bulleted) text = text.replace(/^•\s*/, '');
  // "1. Mix..." is a step; so is "• 1. Trim fat..." (a bullet that only carries the step number).
  // "169. Calories, ..." is not: no recipe has that many steps.
  const step = text.match(/^(\d{1,2})\.\s+(.+)$/);
  if (step && Number(step[1]) <= 40) return { kind: 'step', n: Number(step[1]), text: step[2], bulleted };
  return { kind: bulleted ? 'bullet' : 'text', text };
}

function readBook(pages, contents) {
  const sections = [];
  let section = null;
  let recipe = null;
  for (const p of pages) {
    const lines = p.lines;
    // A section page: "**BREAKFAST**", "17 recipes", one intro line.
    const countAt = lines.findIndex((l) => /^\d+ recipes?$/.test(l.text));
    if (countAt > 0 && lines[countAt - 1].bold) {
      section = {
        title: lines[countAt - 1].text,
        count: Number(lines[countAt].text.match(/^\d+/)[0]),
        intro: lines.slice(countAt + 1).map((l) => l.text).join(' '),
        page: p.page,
        recipes: [],
      };
      sections.push(section);
      recipe = null;
      continue;
    }
    // A recipe's first page starts with "**BREAKFAST / RECIPE 3**"; pages without one continue the recipe.
    const label = lines[0] && lines[0].bold && lines[0].text.match(/^(.+) \/ RECIPE (\d+)$/);
    if (label) {
      if (!section) throw new Error('page ' + p.page + ': recipe before any section page');
      if (label[1] !== section.title) throw new Error('page ' + p.page + ': ' + label[1] + ' recipe inside section ' + section.title);
      recipe = { n: Number(label[2]), pages: [p.page], lines: [] };
      section.recipes.push(recipe);
      for (const l of lines.slice(1)) recipe.lines.push(Object.assign({ page: p.page }, l));
      continue;
    }
    if (lines.some((l) => l.bold && / \/ RECIPE \d+$/.test(l.text))) throw new Error('page ' + p.page + ': text above the recipe label');
    if (!recipe) {
      if (section) throw new Error('page ' + p.page + ': text before the first recipe of ' + section.title);
      continue;
    }
    recipe.pages.push(p.page);
    for (const l of lines) recipe.lines.push(Object.assign({ page: p.page }, l));
  }

  // Everything must agree with the table of contents. Then take each recipe's title and tags.
  if (sections.length !== contents.length) throw new Error('found ' + sections.length + ' section pages, the contents list ' + contents.length);
  const notes = [];
  sections.forEach((s, i) => {
    const toc = contents[i];
    if (s.title !== toc.title) throw new Error('section ' + (i + 1) + ' is ' + s.title + ', the contents say ' + toc.title);
    if (s.page !== toc.page) throw new Error(s.title + ' starts on page ' + s.page + ', the contents say ' + toc.page);
    if (s.recipes.length !== toc.recipes.length) throw new Error(s.title + ': ' + s.recipes.length + ' recipes, the contents list ' + toc.recipes.length);
    if (s.count !== s.recipes.length) throw new Error(s.title + ': its page says ' + s.count + ' recipes, found ' + s.recipes.length);
    s.recipes.forEach((r, j) => {
      const t = toc.recipes[j];
      if (r.n !== t.n) throw new Error(s.title + ': recipe ' + r.n + ' where the contents have ' + t.n);
      if (r.pages[0] !== t.page) throw new Error('recipe ' + r.n + ' starts on page ' + r.pages[0] + ', the contents say ' + t.page);
      // The title is the bold lines under the label (long ones wrap) that add up to the contents title.
      let title = '';
      while (r.lines.length && r.lines[0].bold && !same(title, t.title)) {
        title = (title + ' ' + r.lines.shift().text).trim();
        if (!t.title.toLowerCase().replace(/\s+/g, ' ').startsWith(title.toLowerCase())) {
          throw new Error('recipe ' + r.n + ': title "' + title + '" doesn\'t match the contents title "' + t.title + '"');
        }
      }
      if (!same(title, t.title)) throw new Error('recipe ' + r.n + ': title "' + title + '" vs contents "' + t.title + '"');
      r.title = t.title;
      r.tags = [];
      while (r.lines.length && r.lines[0].bold && isAllCaps(r.lines[0].text) && !KNOWN_HEADINGS.includes(r.lines[0].text)) {
        const tag = r.lines.shift().text;
        if (!KNOWN_TAGS.includes(tag)) notes.push('recipe ' + r.n + ': new tag ' + tag);
        r.tags.push(tag);
      }
    });
  });
  return { sections, notes };
}

// ---------------------------------------------------------------------------------------------
// 4. Artifacts printed in the PDF itself (not recipe content), removed or repaired wherever they occur:
//  - the next section's name printed as the last line of a section's last recipe ("Lunch", "Dinner"...)
//  - a line under a title that only repeats the title's last word (recipe 38: "Peas")
//  - the browser's print header and footer on a recipe printed from a website
//    ("2/1/26, 2:40 PM <page title>", "about:blank 1/2")
//  - a divider of underscores pasted from an original: the line is split there
//  - the last word of an item printed at the start of the next bullet, after the item's comma
//    ("• 6 ounces merguez (lamb sausage), / • sliced 6 ounces garlic sausage, sliced"): it goes back to its item
//  - a list's label printed at the end of the wrapped line above the list ("...wrapping it partially around the
//    rice / ball. Nutrition (Per Onigiri Ball):", then the bullets): the line is split before the label
//  - "fi" where the PDF's font drew the fi ligature for "→" (code 0xAE is → in Symbol, fi in Standard encoding)
//  - "11/2" where "1½" lost its space when the ½ became 1/2 ("11/2 tbsp" → "1 1/2 tbsp", "1-11/4 lb" → "1-1 1/4 lb")
//  - a "**" note marker or a backslash pasted at the start of a line ("**Makes enough quantity for...",
//    "\Recipe.is.for.7.muffin.cup.per.muffin.tin")
//  - a heading made out of a word of a sentence: see headingWords()

function cleanupLines(sections) {
  const removed = [];
  sections.forEach((s, i) => {
    for (const r of s.recipes) {
      const first = r.lines[0];
      if (first && !first.bold && first.text.split(' ').length <= 3 && r.title.endsWith(' ' + first.text)) {
        removed.push({ n: r.n, text: first.text, why: 'repeats the end of the title' });
        r.lines.shift();
      }
      r.lines = r.lines.filter((l) => {
        const t = l.text.replace(/^•\s*/, '');
        if (/^\d{1,2}\/\d{1,2}\/\d{2,4}, \d{1,2}:\d{2} [AP]M .+$/.test(t) || /^about:blank \d+\/\d+$/.test(t)) {
          removed.push({ n: r.n, text: l.text, why: 'browser print header/footer' });
          return false;
        }
        const footer = l.text.match(/\s+(about:blank \d+\/\d+)$/);
        if (footer) {
          removed.push({ n: r.n, text: footer[1], why: 'browser print footer at the end of a line' });
          l.text = l.text.slice(0, footer.index);
        }
        return true;
      });
      for (let k = 0; k < r.lines.length; k++) {
        const l = r.lines[k];
        const m = !l.bold && l.text.match(/^(.*?\S)\s*_{4,}\s*(\S.*)$/);
        if (m) {
          r.lines.splice(k, 1, Object.assign({}, l, { text: m[1] }), Object.assign({}, l, { text: m[2], split: true }));
          removed.push({ n: r.n, text: l.text.match(/_{4,}/)[0], why: 'divider, the line is split there' });
        }
      }
      for (let k = 1; k < r.lines.length; k++) {
        const a = r.lines[k - 1];
        const b = r.lines[k];
        const m = !a.bold && !b.bold && /^•.*,$/.test(a.text) && b.text.match(/^•\s*((?:[a-z]+ly )?[a-z]+(?:ed|en)) (\d.*)$/);
        if (m) {
          removed.push({ n: r.n, text: m[1], why: 'start of a bullet, moved back to the end of the item above' });
          a.text += ' ' + m[1];
          b.text = '• ' + m[2];
        }
      }
      for (let k = 0; k + 1 < r.lines.length; k++) {
        const l = r.lines[k];
        const m = !l.bold && /^•/.test(r.lines[k + 1].text) && l.text.match(/^([a-z].*[.!?])\s+([A-Z][^.!?:]{0,40}:)$/);
        if (m) {
          r.lines.splice(k, 1, Object.assign({}, l, { text: m[1] }), Object.assign({}, l, { text: m[2], split: true }));
          removed.push({ n: r.n, text: m[2], why: 'label of the list below, the line is split before it' });
        }
      }
    }
    const next = sections[i + 1];
    const last = s.recipes[s.recipes.length - 1];
    const tail = last && last.lines[last.lines.length - 1];
    if (next && tail && !tail.bold && same(tail.text, next.title)) {
      removed.push({ n: last.n, text: tail.text, why: 'the next section\'s name' });
      last.lines.pop();
    }
  });
  return removed;
}

function fixText(text) {
  return text
    .replace(/(^|\s)fi(?=\s)/g, (m, before) => before + '→')
    .replace(/(^|[\s(-])1(1\/[248])(?=[\s,).]|$)/g, (m, before, fraction) => before + '1 ' + fraction)
    .replace(/^\*\*\s*/, '')
    .replace(/^\\(?=\S)/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------------------------
// 5. Putting wrapped lines back together

const TERMINAL = /[.!?:;]["”’')\]]*$/;
const FUNCTION_WORDS = new Set(('a an the and or nor but of to for with without in into onto on at by from as if than then ' +
  'until till so that which who your my our their its his her is are was were be been will would can could should ' +
  'you it this these those some any each every per plus about over under through while when before after not no ' +
  'also both all more less very just few several using use mix add').split(' '));
const LONG = 50; // characters: a line this long that stops mid-sentence was wrapped (the pasted originals wrap at 55-115)
const BODY_WIDTH = 500; // points between the PDF's margins
const BODY_SIZE = 10.2; // the PDF's body text size in points

function lastWord(s) { const m = s.match(/([A-Za-z']+)[^A-Za-z']*$/); return m ? m[1].toLowerCase() : ''; }
function openParens(s) { return (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length; }
function closesParen(s) { let d = 0; for (const c of s) { if (c === '(') d++; if (c === ')' && --d < 0) return true; } return false; }

/** True when the PDF had to wrap `prev` at the right margin: the next word wouldn't have fit. */
function fullLine(prevRendered, next) {
  const w = textWidth(prevRendered, BODY_SIZE);
  return w > BODY_WIDTH * 0.85 && w + textWidth(' ' + next.split(' ')[0], BODY_SIZE) > BODY_WIDTH - 6;
}

/**
 * Should PDF line `next` continue the logical line `cur`, whose last PDF line is `prev`? `after` is the
 * PDF line after `next`. Returns the reason, or '' for no. Bullets, steps and paragraphs stay apart
 * unless the break is plainly in the middle of a sentence or an item. A line that ends a sentence starts
 * a new paragraph unless it sits inside a paragraph that's already wrapping and reaches as far as every
 * line above it, or it is the rest of a numbered step: a plain line between a step that runs out to the
 * right margin and the next step ("4. ...pepperoni and pizza sauce." / "Stir. Cook for 4 to 5 minutes..." /
 * "5. ...").
 */
function continues(cur, prev, next, after) {
  if (next.kind === 'heading' || next.kind === 'step' || next.bold || next.split) return '';
  const p = prev.text;
  const n = next.text;
  const terminal = TERMINAL.test(p);
  if (next.kind === 'bullet') {
    // The PDF made a bullet out of the second half of an item ("• Thai chili), chopped", "• bought").
    if (openParens(cur.text) > 0 && closesParen(n)) return 'bullet closes a bracket';
    if (/[A-Za-z]-$/.test(p) && /^[a-z]/.test(n)) return 'bullet finishes a hyphenated word';
    if (/^[a-z]/.test(n) && !terminal && (cur.text.length >= LONG || /^[a-z]+$/.test(n))) return 'bullet starts mid-sentence';
    return '';
  }
  if (/\|$/.test(p)) return 'row continues after |';
  if (openParens(cur.text) > 0 && closesParen(n)) return 'closes a bracket';
  if (/:$/.test(p) && /^https?:\/\/\S+$/.test(n)) return 'link after its label';
  const label = /:$/.test(n) || /^[A-Z][A-Za-z ]{0,30}:/.test(n) || /^step \d/i.test(n);
  if (terminal) {
    if (cur.t === 'step' && !label && after && after.kind === 'step' && after.n === cur.n + 1 &&
      textWidth(prev.rendered, BODY_SIZE) > BODY_WIDTH * 0.85) return 'rest of the step';
    if (cur.parts.length < 2 || label) return '';
    const widest = Math.max(...cur.parts.slice(0, -1).map((r) => textWidth(r, BODY_SIZE)));
    return textWidth(prev.rendered, BODY_SIZE) >= widest ? 'sentence ends at the wrap' : '';
  }
  if (/[A-Za-z]-$/.test(p) && /^[a-z]/.test(n)) return 'finishes a hyphenated word';
  if (/^[a-z0-9]/.test(n) && FUNCTION_WORDS.has(lastWord(p))) return 'line stops mid-phrase';
  if (cur.text.length < LONG) return ''; // short lines are list items and labels
  if (/^[a-z]/.test(n)) return 'starts mid-sentence';
  if (/^\(/.test(n)) return 'aside in brackets';
  if (/^[A-Z0-9]/.test(n) && (FUNCTION_WORDS.has(lastWord(p)) || /,$/.test(p))) return 'line stops mid-phrase';
  if (!label && /[A-Za-z0-9,]$/.test(p) && fullLine(prev.rendered, n)) return 'line is full';
  return '';
}

function joinText(a, b) {
  return /[A-Za-z]-$/.test(a) && /^[a-z]/.test(b) ? a + b : a + ' ' + b;
}

/**
 * Headings the PDF made out of a word of a sentence: the PDF prints the heading in the middle of the
 * sentence, and the line after it goes on in lower case. Either the line before it stops mid-phrase
 * ("...you'll need to scale down the / INGREDIENTS / slightly - You can also...") or the heading repeats the
 * heading it's under ("NUTRITION / Calories: ... / NUTRITION / information is automatically calculated...").
 * The word goes back into its sentence (lower case inside it, capitalised at its start). A repeated heading
 * goes away; any other heading moves down to where that paragraph ends, so it still heads what follows.
 */
function headingWords(items) {
  let heading = '';
  items.forEach((c, k) => {
    if (c.kind !== 'heading') return;
    const before = items[k - 1];
    const after = items[k + 1];
    const goesOn = after && after.kind === 'text' && !after.bold && !after.split && /^[a-z]/.test(after.text);
    const midPhrase = before && before.kind === 'text' && !before.bold && !TERMINAL.test(before.text) && FUNCTION_WORDS.has(lastWord(before.text));
    if (goesOn && midPhrase) {
      Object.assign(c, { kind: 'text', text: c.text.toLowerCase(), join: 'heading word inside a sentence', moves: c.text });
      after.join = 'rest of the sentence after the heading word';
    } else if (goesOn && c.text === heading) {
      Object.assign(c, { kind: 'text', text: c.text.charAt(0) + c.text.slice(1).toLowerCase(), split: true });
      after.join = 'rest of the sentence after the heading word';
    }
    heading = c.moves || (c.kind === 'heading' ? c.text : heading);
  });
}

/** Turns a recipe's PDF lines into blocks of logical lines: [{ heading, lines: [{ t, n?, text }] }]. */
function buildBlocks(r, ov, log) {
  ov = ov || {};
  const replace = new Map(ov.replace || []);
  const items = [];
  for (const line of r.lines) {
    if ((ov.drop || []).includes(line.text)) { log.push({ n: r.n, override: 'drop', text: line.text }); continue; }
    const c = classify(replace.has(line.text) ? Object.assign({}, line, { text: replace.get(line.text) }) : line);
    Object.assign(c, { line: line.text, page: line.page, split: line.split });
    items.push(c);
  }
  headingWords(items);
  const blocks = [];
  let block = null;
  let cur = null; // the logical line being built
  let prev = null; // the last PDF line added to it
  let moved = null; // a heading waiting for the end of the paragraph it was printed in
  items.forEach((c, k) => {
    // The line as the PDF printed it, for measuring.
    c.rendered = (c.bulleted || c.kind === 'bullet' ? '• ' : '') + (c.kind === 'step' ? c.n + '. ' : '') + c.text;
    if (c.kind === 'heading') {
      block = { heading: c.text, lines: [] };
      blocks.push(block);
      cur = prev = moved = null;
      return;
    }
    if (!block) { block = { heading: '', lines: [] }; blocks.push(block); }
    let why = cur ? c.join || continues(cur, prev, c, items[k + 1]) : '';
    if (cur && (ov.join || []).includes(c.line)) why = 'override';
    if ((ov.noJoin || []).includes(c.line)) why = '';
    log.push({ n: r.n, page: c.page, prev: prev && prev.text, next: c.text, kind: c.kind, joined: !!why, why });
    if (why) {
      cur.text = joinText(cur.text, c.text);
      cur.parts.push(c.rendered);
    } else {
      if (moved) {
        block = { heading: moved, lines: [] };
        blocks.push(block);
        moved = null;
      }
      cur = c.kind === 'step' ? { t: 'step', n: c.n, text: c.text } : { t: c.kind === 'bullet' ? 'li' : 'p', text: c.text };
      Object.defineProperty(cur, 'parts', { value: [c.rendered] }); // not enumerable: stays out of the JSON
      block.lines.push(cur);
    }
    if (c.moves) moved = c.moves;
    prev = c;
  });
  for (const b of blocks) b.lines = b.lines.map((l) => Object.assign(l, { text: fixText(l.text) })).filter((l) => l.text);
  return blocks.filter((b) => b.lines.length);
}

// ---------------------------------------------------------------------------------------------

function parse(source) {
  const pages = readPages(source);
  const cover = pages.find((p) => p.page === 1);
  if (!cover) throw new Error('no page 1 (the cover)');
  const tocPages = [];
  for (const p of pages) {
    if (p === cover) continue;
    if (p.lines.some((l) => /^\d+ recipes?$/.test(l.text))) break;
    tocPages.push(p);
  }
  const contents = readContents(tocPages);
  const { sections, notes } = readBook(pages.filter((p) => p !== cover && !tocPages.includes(p)), contents);
  const removed = cleanupLines(sections);
  const log = [];
  const ids = new Set();
  const { edition, tagline } = readCover(cover);
  const book = {
    title: 'Koda Resolutions Cookbook',
    edition,
    tagline,
    count: 0,
    sections: sections.map((s) => ({
      id: slug(s.title),
      title: s.title,
      intro: s.intro,
      count: s.count,
      recipes: s.recipes.map((r) => {
        let id = slug(r.title);
        for (let k = 2; ids.has(id); k++) id = slug(r.title) + '-' + k;
        ids.add(id);
        return { n: r.n, id, title: r.title, tags: r.tags, blocks: buildBlocks(r, OVERRIDES[r.n], log) };
      }),
    })),
  };
  book.count = book.sections.reduce((sum, s) => sum + s.recipes.length, 0);
  const multiPage = [];
  for (const s of sections) for (const r of s.recipes) if (r.pages.length > 1) multiPage.push({ n: r.n, pages: r.pages });
  return { book, notes, removed, log, multiPage };
}

/** The build fails rather than write a cookbook with gaps or leftovers. */
function check(book) {
  const problems = [];
  let n = 0;
  const ids = new Set();
  if (!book.sections.length) problems.push('no sections');
  for (const s of book.sections) {
    if (!s.intro) problems.push(s.title + ' has no intro');
    if (!s.recipes.length || s.count !== s.recipes.length) problems.push(s.title + ': count ' + s.count + ', recipes ' + s.recipes.length);
    if (ids.has(s.id)) problems.push('duplicate id ' + s.id);
    ids.add(s.id);
    for (const r of s.recipes) {
      n++;
      if (r.n !== n) problems.push('recipe ' + r.n + ' where ' + n + ' was expected');
      if (ids.has(r.id)) problems.push('duplicate id ' + r.id);
      ids.add(r.id);
      if (!r.blocks.length) problems.push('recipe ' + r.n + ' is empty');
      for (const b of r.blocks) {
        for (const l of b.lines) {
          if (!l.text.trim()) problems.push('recipe ' + r.n + ': empty line');
          if (/KODA RESOLUTIONS COOKBOOK|Koda community recipes|Back to table of contents|^Page \d+$|-----|\|\s*:-:|\*\*|\\|&#?\w+;|^•|�|about:blank/.test(l.text)) {
            problems.push('recipe ' + r.n + ': artifact left in "' + l.text + '"');
          }
        }
      }
    }
  }
  if (n !== book.count) problems.push('count ' + book.count + ' but ' + n + ' recipes');
  return problems;
}

/** Pretty JSON with each recipe line on one line, like { "t": "li", "text": "1 cup oats" }. */
function toJson(book) {
  const json = JSON.stringify(book, null, 2)
    .replace(/\{\n\s*"t": ("\w+"),\n\s*(?:"n": (\d+),\n\s*)?"text": ("(?:[^"\\]|\\.)*")\n\s*\}/g,
      (m, t, n, text) => '{ "t": ' + t + (n ? ', "n": ' + n : '') + ', "text": ' + text + ' }')
    .replace(/"tags": \[\n\s*([^\]]*?)\n\s*\]/g, (m, items) => '"tags": [' + items.split(/,\n\s*/).join(', ') + ']');
  if (JSON.stringify(JSON.parse(json)) !== JSON.stringify(book)) throw new Error('JSON formatting changed the data');
  return json + '\n';
}

/**
 * Kevin, 11/12/2026: a picture of each dish. The PDF has none, so each recipe gets a free-licensed
 * example photo picked to match it (content/cookbook-photos.json, by recipe id; the files are in
 * assets/cookbook/ and assets/cookbook/thumbs/). Returns problems; a recipe without a photo is fine.
 */
function attachPhotos(book, photos, root) {
  const problems = [];
  const ids = new Set();
  const used = new Map();
  for (const s of book.sections) for (const r of s.recipes) {
    ids.add(r.id);
    const p = photos[r.id];
    if (!p) continue;
    for (const k of ['src', 'thumb', 'landing', 'license', 'licenseUrl']) if (!p[k]) problems.push(r.id + ': photo has no ' + k);
    if (p.license && !['cc0', 'pdm', 'by', 'by-sa'].includes(p.license)) problems.push(r.id + ': licence ' + p.license + ' is not one we can use');
    if (['by', 'by-sa'].includes(p.license) && !p.creator) problems.push(r.id + ': a CC BY photo needs its creator for the credit');
    for (const k of ['landing', 'licenseUrl', 'creatorUrl']) {
      if (p[k] && !/^https:\/\/[^\s"'<>]+$/.test(p[k])) problems.push(r.id + ': ' + k + ' must be an https link');
      else if (p[k] && /&amp;|[?&](action=edit|redlink=1)(&|$)/.test(p[k])) problems.push(r.id + ': ' + k + ' is an escaped or "create this page" link');
    }
    if (p.src && !/^assets\/cookbook\/[a-z0-9-]+\.jpg$/.test(p.src)) problems.push(r.id + ': src must be assets/cookbook/<name>.jpg');
    if (p.thumb && !/^assets\/cookbook\/thumbs\/[a-z0-9-]+\.jpg$/.test(p.thumb)) problems.push(r.id + ': thumb must be assets/cookbook/thumbs/<name>.jpg');
    for (const f of [p.src, p.thumb]) if (f && root && !fs.existsSync(path.join(root, f))) problems.push(r.id + ': missing file ' + f);
    if (p.landing && used.has(p.landing)) problems.push(r.id + ': same photo as ' + used.get(p.landing));
    used.set(p.landing, r.id);
    // title: the photo's own title on its page (CC 2.0 and 3.0 credits name it when the author gave one).
    r.photo = { src: p.src, thumb: p.thumb, alt: p.alt || r.title, title: p.title || '', landing: p.landing, creator: p.creator || '', creatorUrl: p.creatorUrl || '', license: p.license, licenseVersion: p.licenseVersion || '', licenseUrl: p.licenseUrl };
  }
  for (const id of Object.keys(photos)) if (!ids.has(id)) problems.push('photo for unknown recipe ' + id);
  return problems;
}

function main() {
  const source = process.argv[2] || DEFAULT_SOURCE;
  const { book, notes, removed, multiPage } = parse(fs.readFileSync(source, 'utf8'));
  const problems = check(book);
  const photosFile = path.join(__dirname, '..', 'content', 'cookbook-photos.json');
  if (fs.existsSync(photosFile)) problems.push(...attachPhotos(book, JSON.parse(fs.readFileSync(photosFile, 'utf8')), path.join(__dirname, '..')));
  if (problems.length) {
    console.error('Not written:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  fs.writeFileSync(OUTPUT, toJson(book));
  const withPhoto = book.sections.reduce((n, s) => n + s.recipes.filter((r) => r.photo).length, 0);
  console.log('photos: ' + withPhoto + ' of ' + book.count + ' recipes');
  const headings = {};
  for (const s of book.sections) for (const r of s.recipes) {
    for (const h of new Set(r.blocks.map((b) => b.heading || '(text before the first heading)'))) headings[h] = (headings[h] || 0) + 1;
  }
  console.log('wrote ' + path.relative(process.cwd(), OUTPUT) + ': ' + book.edition + ', ' + book.count + ' recipes');
  for (const s of book.sections) console.log('  ' + s.title + ': ' + s.recipes.length);
  console.log('headings (recipes using each): ' + Object.entries(headings).sort((a, b) => b[1] - a[1]).map(([h, c]) => h + ' ' + c).join(', '));
  console.log('recipes over more than one page: ' + multiPage.map((m) => m.n + ' (pp. ' + m.pages.join('-') + ')').join(', '));
  if (removed.length) console.log('removed or repaired in the PDF text:\n' + removed.map((x) => '  recipe ' + x.n + ': "' + x.text + '" (' + x.why + ')').join('\n'));
  for (const note of notes) console.log('note: ' + note);
}

if (require.main === module) main();
module.exports = { parse, check, unescape, textWidth, OVERRIDES, attachPhotos };
