'use strict';

/**
 * The Koda Cookbook's data: content/cookbook.json as built, and the dish photos merged into it
 * (Kevin, 11/12/2026: a picture of each dish).   node --test "tests/*.test.js"
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { attachPhotos, check } = require('../dev/build-cookbook.js');

const ROOT = path.join(__dirname, '..');
const BOOK = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'cookbook.json'), 'utf8'));
const PHOTOS_FILE = path.join(ROOT, 'content', 'cookbook-photos.json');

/** A copy of the built cookbook without its photos, so each test merges into a clean book. */
function book() {
  const b = JSON.parse(JSON.stringify(BOOK));
  for (const s of b.sections) for (const r of s.recipes) delete r.photo;
  return b;
}
const firstId = () => BOOK.sections[0].recipes[0].id;
const secondId = () => BOOK.sections[0].recipes[1].id;
const photo = (extra) => Object.assign({ src: 'assets/cookbook/x.jpg', thumb: 'assets/cookbook/thumbs/x.jpg', landing: 'https://www.flickr.com/photos/a/1', creator: 'Someone', license: 'by', licenseVersion: '2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/' }, extra || {});

test('the built cookbook passes its own checks: 65 recipes in six sections', () => {
  assert.deepEqual(check(BOOK), []);
  assert.equal(BOOK.count, 65);
  assert.deepEqual(BOOK.sections.map((s) => s.title), ['BREAKFAST', 'LUNCH', 'DINNER', 'SOUPS & CHILI', 'SNACKS', 'SIDES']);
});

test('a photo is merged into its recipe with the credit fields the app shows', () => {
  const b = book();
  assert.deepEqual(attachPhotos(b, { [firstId()]: photo({ alt: 'Banana pancakes with sliced banana' }) }, null), []);
  const r = b.sections[0].recipes[0];
  assert.deepEqual(r.photo, { src: 'assets/cookbook/x.jpg', thumb: 'assets/cookbook/thumbs/x.jpg', alt: 'Banana pancakes with sliced banana', title: '', landing: 'https://www.flickr.com/photos/a/1', creator: 'Someone', creatorUrl: '', license: 'by', licenseVersion: '2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/' });
  assert.equal(b.sections[0].recipes[1].photo, undefined, 'a recipe without a photo is fine');
});

test('photos the licence or the files wouldn’t allow are refused', () => {
  const problems = (photos, root) => attachPhotos(book(), photos, root);
  assert.match(problems({ [firstId()]: photo({ license: 'by-nc' }) }, null)[0], /licence by-nc is not one we can use/);
  assert.match(problems({ [firstId()]: photo({ creator: '' }) }, null)[0], /needs its creator/);
  assert.match(problems({ [firstId()]: photo({ licenseUrl: '' }) }, null)[0], /has no licenseUrl/);
  assert.match(problems({ 'no-such-recipe': photo() }, null)[0], /photo for unknown recipe no-such-recipe/);
  assert.match(problems({ [firstId()]: photo(), [secondId()]: photo() }, null)[0], /same photo as/);
  assert.match(problems({ [firstId()]: photo({ src: 'assets/cookbook/not-there.jpg' }) }, ROOT)[0], /missing file assets\/cookbook\/not-there\.jpg/);
  assert.match(problems({ [firstId()]: photo({ landing: 'javascript:alert(1)' }) }, null)[0], /landing must be an https link/);
  assert.match(problems({ [firstId()]: photo({ creatorUrl: 'http://example.com/me' }) }, null)[0], /creatorUrl must be an https link/);
  assert.match(problems({ [firstId()]: photo({ src: '../index.html' }) }, null)[0], /src must be assets\/cookbook/);
  assert.match(problems({ [firstId()]: photo({ creatorUrl: 'https://commons.wikimedia.org/w/index.php?title=User:X&amp;action=edit&amp;redlink=1' }) }, null)[0], /escaped or "create this page" link/);
  assert.deepEqual(problems({ [firstId()]: photo({ license: 'cc0', creator: '' }) }, null), [], 'CC0 needs no creator');
});

test('the shipped photos: one per recipe, every file there, sized for the app, and merged into cookbook.json', { skip: !fs.existsSync(PHOTOS_FILE) }, () => {
  const photos = JSON.parse(fs.readFileSync(PHOTOS_FILE, 'utf8'));
  const fresh = book();
  assert.deepEqual(attachPhotos(fresh, photos, ROOT), []);
  const merged = new Map(fresh.sections.flatMap((s) => s.recipes.map((r) => [r.id, r.photo])));
  const ids = BOOK.sections.flatMap((s) => s.recipes.map((r) => r.id));
  assert.deepEqual(Object.keys(photos).sort(), ids.slice().sort(), 'every recipe has a photo');
  for (const r of BOOK.sections.flatMap((s) => s.recipes)) {
    assert.ok(r.photo, r.id + ' has its photo in cookbook.json (run node dev/build-cookbook.js)');
    assert.deepEqual(r.photo, merged.get(r.id), r.id + ': cookbook.json has the current photo and credit (run node dev/build-cookbook.js)');
    for (const k of ['landing', 'licenseUrl']) assert.match(r.photo[k], /^https:\/\//, r.id + ' ' + k + ' is an https link');
    if (r.photo.creatorUrl) assert.match(r.photo.creatorUrl, /^https:\/\//, r.id + ' creatorUrl is an https link');
    assert.ok(r.photo.alt && r.photo.alt !== r.title, r.id + ' has alt text describing the photo');
    const jpeg = fs.readFileSync(path.join(ROOT, r.photo.src));
    assert.equal(jpeg.readUInt16BE(0), 0xffd8, r.id + ' is a JPEG');
    assert.ok(jpeg.length < 260000, r.id + ' photo is small enough for phones (' + jpeg.length + ' bytes)');
    assert.ok(fs.statSync(path.join(ROOT, r.photo.thumb)).size < 40000, r.id + ' thumbnail is small');
  }
});
