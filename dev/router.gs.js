/**
 * TEST ONLY — never pushed to Apps Script. Stands in for the hyrox project's Code.js, which
 * routes type:"res27" posts and "res27…" GET actions to Resolutions27.js, and owns the admin key
 * check (sim1025Authorized) that Resolutions27.js borrows.
 */

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  if (data.type === 'res27') return res27Post(data);
  return ContentService.createTextOutput(JSON.stringify({ status: 'error', error: 'unknown type' })).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var action = e && e.parameter ? e.parameter.action : '';
  if (action && action.indexOf('res27') === 0) return res27Get(action, e);
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
}

function resetRequestCache_() {
  RES27_REQ_ = {};
}

var RES27_TEST_ADMIN_KEY_ = 'test-admin-key-123';

function sim1025Authorized(key) {
  return key === RES27_TEST_ADMIN_KEY_;
}
