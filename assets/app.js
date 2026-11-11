/* Koda Resolutions 2027 — member app. Plain JS, no build step.
   Talks to the hyrox Apps Script web app (type "res27"); on localhost it talks to dev/server.js. */
(function () {
  'use strict';

  var C = window.RES27_CONTENT;
  var PROD_API_URL = 'https://script.google.com/macros/s/AKfycbwWjHrhE6k3vVPDXD4qi3VLxZVAXMykAFIKocoUiq0BtXdv2XLy7Oo0GRfrP48fHytnyw/exec';
  var API_URL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '/api' : PROD_API_URL;
  var APP_VERSION = '1.4.0';

  /* ============================================================ small helpers */

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function localToday() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function keyDate(k) { var p = String(k).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function addDays(k, n) { var d = keyDate(k); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function diffDays(a, b) { return Math.round((keyDate(b) - keyDate(a)) / 86400000); }
  function fmt(k, o) { return keyDate(k).toLocaleDateString('en-US', o || { weekday: 'short', month: 'short', day: 'numeric' }); }
  function fmtLong(k) { return fmt(k, { weekday: 'long', month: 'long', day: 'numeric' }); }
  function initials(p) { return ((p.first || '?')[0] + (p.last || '')[0] || '').toUpperCase(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function goalLabel(id) { var g = C.goals.filter(function (x) { return x.id === id; })[0]; return g ? g.label : ''; }
  function planInfo(id) { return C.plans.filter(function (x) { return x.id === id; })[0] || null; }
  function trackInfo(id) { return C.tracking.filter(function (x) { return x.id === id; })[0] || null; }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()); }

  var store = {
    get: function (k, fallback) { try { var v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  // The beta test link (…/resolutions/?beta=1) is remembered on this phone; ?beta=0 forgets it.
  (function () {
    var m = /[?&]beta(?:=([^&#]*))?/.exec(location.search);
    if (!m) return;
    if (/^(0|off|false|no)$/i.test(m[1] || '')) store.del('res27.beta');
    else store.set('res27.beta', true);
  })();
  /** The beta test's dates when this phone came in through the beta link and a beta is running (not one that has ended since). */
  function betaInfo() {
    var b = store.get('res27.beta', false) && S.config && S.config.beta ? S.config.beta : null;
    return b && !(b.end < localToday()) ? b : null;
  }
  function weeksText(days) { return days % 7 ? plural(days, 'day') : plural(days / 7, 'week'); }

  /* ============================================================ icons */

  var KX = '<svg class="kx" viewBox="0 0 2000 1118" aria-hidden="true"><polygon points="19,20 335,20 874,559 335,1098 19,1098 558,559"/><polygon points="585,20 901,20 1282,401 1664,20 1980,20 1440,559 1980,1098 1664,1098 1282,717 901,1098 585,1098 1125,559"/></svg>';
  function kx(cls) { return KX.replace('class="kx"', 'class="' + (cls || 'kx') + '"'); }
  var I = {
    today: '<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 9.5h18"/><path d="m9 15 2 2 4-4"/>',
    chart: '<path d="M5 20.5V12M12 20.5V4.5M19 20.5v-6"/>',
    plate: '<circle cx="12.5" cy="12" r="6.5"/><circle cx="12.5" cy="12" r="3"/><path d="M3 3.5v5.5a1.8 1.8 0 0 0 1.8 1.8M3 3.5v17M22 3.5c-1.6 1.6-2 3.7-2 6.3 0 2.2.7 3.2 2 3.2v7.5"/>',
    play: '<path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2Z"/>',
    video: '<rect x="2.5" y="5" width="14" height="14" rx="3"/><path d="m16.5 10 5-3v10l-5-3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    chevR: '<path d="m9 5 7 7-7 7"/>',
    chevL: '<path d="m15 5-7 7 7 7"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    flame: '<path d="M12 21c-4 0-7-2.7-7-6.6 0-3.5 2.6-5.6 4.4-7.9.4 2 1.3 3.2 2.6 3.9C12 7 12.6 4.6 15 2.5c.3 3.5 4 6 4 11.4 0 4.4-3 7.1-7 7.1Z"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5.5h3v1.5a4 4 0 0 1-3.6 4M7 5.5H4v1.5a4 4 0 0 0 3.6 4"/>',
    drop: '<path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10 12 3 12 3Z"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
    dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
    bolt: '<path d="M13 2.5 4.5 13.5h6.5L10 21.5l9-11.5h-6.5L13 2.5Z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    stretch: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v4.5H16"/>',
    star: '<path d="m12 3.2 2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.4-4.2 6-.9L12 3.2Z"/>',
    spark: '<path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.6 2.6M15.4 15.4 18 18M6 18l2.6-2.6M15.4 8.6 18 6"/>',
    heart: '<path d="M12 20.5s-8-4.6-8-10.4A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 3.1c0 5.8-8 10.4-8 10.4Z"/>',
    leaf: '<path d="M5 19.5c0-9.5 6-14.5 15-14.5 0 9-5.5 15-14.5 15"/><path d="M5 19.5c3-4.2 6-6.7 9.5-8.2"/>',
    reset: '<path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3L3.5 8.3"/><path d="M3.5 3.5v4.8h4.8"/>',
    steak: '<path d="M15.5 4C11 4 4 7 4 13.5 4 18 7.5 20 11 20c5 0 9-4.5 9-10 0-3.5-1.8-6-4.5-6Z"/><circle cx="14.5" cy="9.5" r="2"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 9.5h18"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
    key: '<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 8.3-8.3M16 7l3 3M13.8 9.2l2 2"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m14 6 4 4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    bank: '<path d="M3 9.5 12 4l9 5.5M4 21h16M5.5 10.5v7.5M9.5 10.5v7.5M14.5 10.5v7.5M18.5 10.5v7.5"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 5.6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.5 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.8 0 3.3-.5 4.6-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    shirt: '<path d="M8 3.5 3.5 6 5 10.5l2.5-1v11h9v-11l2.5 1L20.5 6 16 3.5c-.8 1.5-2.2 2.3-4 2.3s-3.2-.8-4-2.3Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    medal: '<circle cx="12" cy="14.5" r="5.5"/><path d="M8.5 9.8 6 3h4l2 4.5L14 3h4l-2.5 6.8"/>',
    arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 3.8M12 17v.4"/>',
    book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5v-15Z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3"/>',
    scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.5 9a4.5 4.5 0 0 1 7 0l-2 2.5h-3Z"/>',
    home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/>',
    protein: '<path d="M8 8h8l-.9 12.2a1.6 1.6 0 0 1-1.6 1.3h-3a1.6 1.6 0 0 1-1.6-1.3L8 8Z"/><path d="M8.6 8 9 4.4a1 1 0 0 1 1-.9h4a1 1 0 0 1 1 .9L15.4 8M8.7 12.5h6.6"/>',
    recovery: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="m9.6 4.6 2.4 1.9 2.4-1.9M9.6 19.4l2.4-1.9 2.4 1.9"/>',
  };
  function icon(name, cls) {
    if (name === 'play') return '<svg class="' + (cls || 'ico') + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + I.play + '</svg>';
    return '<svg class="' + (cls || 'ico') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (I[name] || I.star) + '</svg>';
  }

  /* ============================================================ state */

  var DEFAULT_CONFIG = {
    programName: 'Koda Resolutions 2027', startDate: '2027-01-18', endDate: '2027-02-28', lengthDays: 42, registrationOpen: true,
    remotePrice: 99, venmo: '@kevin-schuetz-5', venmoUrl: 'https://venmo.com/u/kevin-schuetz-5', zelle: 'kodaironview@gmail.com', cardUrl: '',
    coaches: ['Kevin', 'Riley', 'Jamie', 'Maggie'], contactEmail: 'kodaironview@gmail.com', siteUrl: '', cookbookUrl: '',
    sizes: { tee: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'], tank: ['XS', 'S', 'M', 'L', 'XL', '2XL'] }, sleepChoices: [7, 7.5, 8, 8.5, 9], finisherChoices: [1, 2, 3],
    beta: null,
  };

  var S = {
    token: store.get('res27.token', ''),
    me: null,
    config: store.get('res27.config', null) || DEFAULT_CONFIG,
    draft: normalizeDraft(store.get('res27.draft', null)),
    password: '',
    edit: null,
    pending: store.get('res27.pending', {}) || {},
    inflight: {},
    again: {},
    saveTimers: {},
    saveState: 'idle',
    saveError: '',
    errors: {},
    formError: '',
    busy: false,
    variant: {},
    player: null,
    watchTimer: null,
    lastLoad: 0,
    loadingMe: false,
    nutritionQuery: '',
    resetStage: 'email',
    resetEmail: '',
    emailTaken: false,
    installEvent: null,
    sheet: null,
    renderedDay: null,
    session: 0,
    loadedDay: '',
    retryTimer: null,
    retryDelay: 0,
    lastRouteKey: '',
    lastPaintHash: '',
    returnToReview: false,
    configLoaded: false,
    board: null,
    boardAt: 0,
    boardLoading: false,
    boardTriedAt: 0,
    boardError: '',
    boardView: 'overall',
    myTeam: '',
    cookbook: null,
    cookbookLoading: false,
    cookbookError: '',
    cookbookQuery: '',
    askText: '',
    askBusy: false,
    askError: '',
    askSent: null,
  };
  var cached = store.get('res27.me', null);
  if (S.token && cached && cached.token === S.token) { S.me = cached.me; S.loadedDay = cached.loadedDay || ''; }

  function newDraft() {
    return {
      memberType: '', payment: '', first: '', last: '', email: '', shirt: '', size: '',
      // Recommended habits start on Yes; the rest need a Yes or No before Continue.
      goal: '', track: { nutrition: true, workout: true, sleep: true, protein: null, hydration: null, finishers: null, skill: null, mobility: null, recovery: null, other: null },
      plan: '', planOther: '', macros: { protein: '', carbs: '', fat: '', calories: '', wantHelp: false },
      sleepHours: 7, proteinG: '', bodyweight: '', hydrationOz: '', hydrationMode: 'weight', finishersPerWeek: 2,
      skill: '', mobility: '', other: [''], coaches: [],
    };
  }
  /**
   * A sign-up in progress, restored from this phone. Drafts from the first version had every
   * optional habit set to No by default, so those come back unanswered; goals come back inside
   * today's choices, so Review shows exactly what gets saved.
   */
  function normalizeDraft(saved) {
    var d = Object.assign(newDraft(), saved && typeof saved === 'object' ? saved : {});
    var t = (saved && saved.track) || {};
    var old = !Object.prototype.hasOwnProperty.call(t, 'protein');
    d.track = {};
    C.tracking.forEach(function (x) {
      var v = t[x.id];
      if (v === true) d.track[x.id] = true;
      else if (v === false && (!old || x.recommended)) d.track[x.id] = false;
      else d.track[x.id] = x.recommended && v === undefined ? true : null;
    });
    d.sleepHours = sleepValue(d);
    d.finishersPerWeek = finisherValue(d);
    d.other = [String((Array.isArray(d.other) && d.other[0]) || '')];
    delete d.agree;
    return d;
  }
  function saveDraft() { store.set('res27.draft', S.draft); }
  function cacheMe() { if (S.me && S.token) store.set('res27.me', { token: S.token, me: S.me, loadedDay: S.loadedDay }); }
  function persistPending() { store.set('res27.pending', S.pending); }

  /* ============================================================ API */

  function api(action, body, opts) {
    var payload = Object.assign({ type: 'res27', action: action, today: localToday() }, body || {});
    if (S.token && !(body && Object.prototype.hasOwnProperty.call(body, 'token'))) payload.token = S.token;
    var session = S.session;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, (opts && opts.timeout) || 35000);
    return fetch(API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload),
      redirect: 'follow', cache: 'no-store', signal: controller ? controller.signal : undefined,
    }).then(function (res) {
      clearTimeout(timer);
      return res.json().catch(function () { throw netErr('Something went wrong. Please try again.'); });
    }, function (e) {
      clearTimeout(timer);
      throw netErr(e && e.name === 'AbortError' ? 'This is taking too long. Check your connection and try again.' : 'Can’t reach Koda right now. Check your connection and try again.');
    }).then(function (data) {
      if (!data || !data.ok) {
        var err = new Error((data && data.error) || 'Something went wrong. Please try again.');
        err.code = data && data.code;
        if ((err.code === 'auth' || err.code === 'inactive') && session === S.session) {
          var was = !!S.token;
          signOutLocal();
          if (was) { toast(err.message, true); go('#/signin'); }
        }
        throw err;
      }
      return data;
    });
  }
  function netErr(msg) { var e = new Error(msg); e.code = 'network'; return e; }

  function loadConfig() {
    return api('config', { token: '' }).then(function (r) {
      S.config = Object.assign({}, DEFAULT_CONFIG, r.config);
      store.set('res27.config', S.config);
      S.configLoaded = true;
      if (!S.config.beta) store.del('res27.beta'); // the beta test is over: back to the real sign-up
      if (!S.token && ['signin', 'forgot'].indexOf(route().name) < 0) render(); // the landing shows on any other route
    }).catch(function () { S.configLoaded = true; if (!S.token && ['signin', 'forgot'].indexOf(route().name) < 0) render(); });
  }

  function loadMe(quiet) {
    if (!S.token || S.loadingMe) return Promise.resolve();
    S.loadingMe = true;
    var session = S.session;
    return api('me').then(function (r) {
      if (session !== S.session) return;
      S.loadingMe = false;
      applyMe(r.me);
      flushAllPending();
    }, function (e) {
      if (session !== S.session) return;
      S.loadingMe = false;
      if (!quiet && !S.me) { S.loadError = e.message; render(); }
    });
  }

  /** Takes a fresh 'me' from the server. A day saved here after that reply was read keeps the newer copy. */
  function applyMe(me) {
    if (S.me && S.me.person && me.person && S.me.person.id === me.person.id) {
      Object.keys(S.me.history || {}).forEach(function (d) {
        var mine = S.me.history[d], theirs = me.history[d];
        if (mine && (!theirs || (Number(mine.t) || 0) > (Number(theirs.t) || 0))) me.history[d] = mine;
      });
    }
    S.me = me;
    S.loadedDay = localToday();
    S.config = Object.assign({}, DEFAULT_CONFIG, me.config);
    store.set('res27.config', S.config);
    if (!S.config.beta) store.del('res27.beta');
    S.lastLoad = Date.now();
    S.loadError = '';
    cacheMe();
    render();
  }

  function signOutLocal() {
    S.session += 1;
    Object.keys(S.saveTimers).forEach(function (k) { clearTimeout(S.saveTimers[k]); });
    clearTimeout(S.retryTimer);
    S.saveTimers = {};
    S.inflight = {};
    S.again = {};
    S.retryDelay = 0;
    S.saveState = 'idle';
    S.loadingMe = false;
    S.token = '';
    S.me = null;
    S.loadedDay = '';
    S.sheet = null;
    store.del('res27.token');
    store.del('res27.me');
    store.del('res27.pending');
    S.pending = {};
    S.board = null;
    S.boardAt = 0;
    S.boardTriedAt = 0;
    S.boardLoading = false;
    S.boardError = '';
    S.myTeam = '';
    S.askText = ''; S.askBusy = false; S.askError = ''; S.askSent = null;
    destroyPlayer();
    // Back on the landing page: fresh dates (a beta may have ended while signed in).
    S.configLoaded = false;
    loadConfig();
  }
  function hasPending() {
    return Object.keys(S.pending || {}).some(function (d) { return S.pending[d] && Object.keys(S.pending[d]).length; });
  }

  /* ============================================================ routing */

  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var q = h.indexOf('?');
    var path = q >= 0 ? h.slice(0, q) : h;
    var parts = path.split('/').filter(Boolean);
    var params = {};
    if (q >= 0) h.slice(q + 1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
    return { name: parts[0] || '', args: parts.slice(1), params: params };
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

  var app = document.getElementById('app');

  function render() {
    var r = route();
    S.errors = S.errors || {};
    var signedIn = !!S.token;
    var html;
    if (r.name !== 'today' && r.name !== 'day' && r.name !== '') { destroyPlayer(); S.renderedDay = null; }
    if (!signedIn) {
      if (r.name === 'join') html = viewJoin(r.args[0] || 'about');
      else if (r.name === 'signin') html = viewSignIn();
      else if (r.name === 'forgot') html = viewForgot();
      else html = viewLanding();
      S.renderedDay = null;
      paint(html);
      afterRender(r);
      return;
    }
    if (!S.me) {
      app.innerHTML = S.loadError
        ? '<div class="auth"><div class="card auth-card center"><div class="brand"><span class="mark">' + kx() + '</span></div><h1>Can’t load your challenge</h1><p class="lead">' + esc(S.loadError) + '</p><button class="btn btn-primary btn-block" data-act="reload">Try again</button><p class="auth-alt"><button class="btn-link" data-act="signout">Sign out</button></p></div></div>'
        : '<div class="loading-screen">' + kx('mark') + '</div>';
      S.renderedDay = null;
      return;
    }
    if (r.name === 'join' || r.name === 'signin' || r.name === 'forgot') { go('#/today'); return; }
    if (r.name === 'edit') { paint(viewEdit(r.args[0] || 'track')); S.renderedDay = null; afterRender(r); return; }
    var tab = 'today';
    var inner;
    // The Progress tab became the Leaderboard (11/10); old #/progress links still land there.
    if (r.name === 'leaderboard' || r.name === 'progress') { tab = 'leaderboard'; inner = viewLeaderboard(); }
    else if (r.name === 'faqs') { tab = 'faqs'; inner = viewFaqs(); }
    else if (r.name === 'nutrition') { tab = 'nutrition'; inner = viewNutrition(r.args[0] || 'mine'); }
    else if (r.name === 'videos') { tab = 'videos'; inner = viewVideos(); }
    else if (r.name === 'profile') { tab = 'profile'; inner = viewProfile(); }
    else if (r.name === 'day' && r.args[0]) { inner = viewToday(r.args[0]); }
    else { inner = viewToday(null); }
    var dayKey = (tab === 'today') ? (S.renderedDayNext || null) : null;
    if (tab === 'today' && S.renderedDay && dayKey && S.renderedDay === dayKey && document.getElementById('videoMount')) {
      refreshDayParts();
      return;
    }
    destroyPlayer();
    paint(shell(tab, inner));
    S.renderedDay = dayKey;
    afterRender(r);
    if (tab === 'leaderboard') loadBoard(false);
    if (tab === 'nutrition' && r.args[0] === 'cookbook') loadCookbook();
  }

  /** Replaces the page. On a re-render of the same page, the field being typed in keeps focus and caret. */
  function paint(html) {
    var a = document.activeElement, keep = null, same = location.hash === S.lastPaintHash;
    if (same && a && app.contains(a) && a.dataset && (a.dataset.field || a.dataset.search !== undefined || a.dataset.cbsearch !== undefined || a.dataset.ask !== undefined)) {
      keep = { sel: a.dataset.field ? '[data-field="' + a.dataset.field + '"]' : a.dataset.cbsearch !== undefined ? '[data-cbsearch]' : a.dataset.ask !== undefined ? '[data-ask]' : '[data-search]' };
      try { keep.start = a.selectionStart; keep.end = a.selectionEnd; } catch (e) {}
    }
    // A repaint of the same page (e.g. fresh data after the phone wakes) keeps open dropdowns (a
    // recipe someone is cooking from, an FAQ answer) and the scroll position.
    var opened = same ? Array.prototype.map.call(app.querySelectorAll('details[open][id]'), function (d) { return d.id; }) : [];
    var y = window.scrollY;
    S.lastPaintHash = location.hash;
    app.innerHTML = html;
    opened.forEach(function (id) { var d = document.getElementById(id); if (d && d.tagName === 'DETAILS') d.open = true; });
    if (opened.length) window.scrollTo(0, y);
    if (keep) {
      var n = app.querySelector(keep.sel);
      if (n) {
        n.focus({ preventScroll: true });
        try { if (typeof keep.start === 'number') n.setSelectionRange(keep.start, keep.end); } catch (e) {}
      }
    }
  }

  /** New page (or a new sign-up step): start at the top and focus its first field. Re-renders of the same page don't. */
  function afterRender(r) {
    if (S.sheet && !document.getElementById('sheet')) openSheet(S.sheet.html);
    var key = location.hash + '|' + (r.name === 'forgot' ? S.resetStage : '');
    if (key === S.lastRouteKey) return;
    S.lastRouteKey = key;
    window.scrollTo(0, 0);
    var focus = app.querySelector('[data-autofocus]');
    if (focus && !('ontouchstart' in window)) focus.focus({ preventScroll: true });
  }

  /* ============================================================ shell */

  function navItems() {
    return [
      ['today', 'Today', 'today', '#/today'],
      ['leaderboard', 'Leaderboard', 'trophy', '#/leaderboard'],
      ['nutrition', 'Nutrition', 'plate', '#/nutrition'],
      ['videos', 'Videos', 'video', '#/videos'],
      ['faqs', 'FAQs', 'help', '#/faqs', 'side'],
      ['profile', 'Profile', 'user', '#/profile'],
    ];
  }

  function shell(active, inner) {
    var p = S.me.program;
    var person = S.me.person;
    var dayText = p.phase === 'during' ? 'Day ' + p.dayNumber + ' of ' + p.length : p.phase === 'before' ? 'Starts ' + fmt(p.start, { month: 'short', day: 'numeric' }) : 'Finished';
    var pct = p.phase === 'during' ? Math.round((p.dayNumber / p.length) * 100) : p.phase === 'after' ? 100 : 0;
    // Days still open but not filled in: a count on the Today tab, kept current by refreshStatusParts.
    var od = overdueDays().length;
    var badge = '<span class="od-badge" data-od-badge' + (od ? '' : ' hidden') + ' aria-label="' + plural(od, 'day') + ' overdue">' + od + '</span>';
    var nav = navItems().map(function (n) {
      return '<a class="nav-item' + (active === n[0] ? ' is-on' : '') + '" href="' + n[3] + '"' + (active === n[0] ? ' aria-current="page"' : '') + '>' + icon(n[2]) + '<span>' + n[1] + '</span>' + (n[0] === 'today' ? badge : '') + '</a>';
    }).join('');
    // The phone tab bar has room for five: sidebar-only items (FAQs) live under Profile there.
    var tabActive = active === 'faqs' ? 'profile' : active;
    var tabs = navItems().filter(function (n) { return n[4] !== 'side'; }).map(function (n) {
      return '<a class="tab' + (tabActive === n[0] ? ' is-on' : '') + '" href="' + n[3] + '"' + (tabActive === n[0] ? ' aria-current="page"' : '') + '><span class="tab-ico">' + icon(n[2]) + (n[0] === 'today' ? badge : '') + '</span>' + n[1] + '</a>';
    }).join('');
    var who = person.team ? teamLabel(person.team) : person.type === 'Remote' ? 'Remote participant' : person.type === 'Test' ? (p.beta ? 'Beta tester' : 'Test account') : 'Koda member';
    return '<div class="shell">' +
      '<aside class="sidebar" aria-label="Main">' +
        '<a class="brand" href="#/today"><span class="mark">' + kx() + '</span><span class="name">Resolutions<small>2027</small></span></a>' +
        '<nav>' + nav + '</nav>' +
        '<div class="side-progress"><div class="kicker" style="color:#aeb7c2">' + esc(p.beta ? 'Beta test' : p.preview ? 'Preview' : 'Your challenge') + '</div><div class="big">' + esc(dayText) + '</div><div class="bar"><span style="width:' + pct + '%"></span></div></div>' +
        '<a class="side-user" href="#/profile"><span class="avatar">' + esc(initials(person)) + '</span><span><b style="display:block;font-size:14px">' + esc(person.first + ' ' + person.last) + '</b><span class="subtle" style="font-size:12.5px">' + esc(who) + '</span></span></a>' +
      '</aside>' +
      '<div class="col">' +
        '<header class="topbar"><a class="brand" href="#/today"><span class="mark">' + kx() + '</span><span class="name">Resolutions<small>2027</small></span></a><span class="day-pill' + (p.beta ? ' is-beta' : '') + '">' + icon('calendar', 'ico-sm') + esc((p.beta ? 'Beta · ' : '') + dayText) + '</span></header>' +
        '<main class="main" id="main">' + inner + '</main>' +
        '<nav class="tabbar" aria-label="Main">' + tabs + '</nav>' +
      '</div>' +
    '</div>' + toastHtml();
  }

  /* ============================================================ scoring helpers */

  function answersFor(date) {
    var saved = (S.me.history[date] && S.me.history[date].a) || {};
    var out = Object.assign({}, saved, S.pending[date] || {});
    Object.keys(out).forEach(function (k) { if (out[k] === null) delete out[k]; });
    return out;
  }
  function unitsOf(items) { var u = []; items.forEach(function (it) { it.units.forEach(function (x) { u.push(x); }); }); return u; }
  /**
   * A day's score out of 10, the same math as the backend. Units are [key, weight, kind, label or goal]:
   * kind 0 counts every day, 1 (finisher) only on days it's done, 2 (bonus task) goes on top of the 10.
   * shortfall is the missed finishers (times their weight) on the last day of a week.
   */
  function score(units, a, shortfall) {
    var items = {}, earned = 0, max = 0, bonus = 0, answered = 0;
    units.forEach(function (u) {
      var id = String(u[0]).split(':')[0], w = Number(u[1]) || 0, kind = Number(u[2]) || 0, v = a[u[0]];
      if (!items[id]) items[id] = { all: true, kind: kind, any: false };
      if (v !== 1) items[id].all = false;
      if (v === 1 || v === 0) items[id].any = true;
      if (kind === 2) { if (v === 1) bonus += w; return; }
      if (kind === 1) { if (v === 1) { earned += w; max += w; } return; }
      max += w;
      if (v === 1) earned += w;
    });
    max += Math.max(0, Number(shortfall) || 0);
    var done = 0, of = 0;
    Object.keys(items).forEach(function (id) { var it = items[id]; if (it.kind) return; of++; if (it.all) done++; if (it.any) answered++; });
    var s = max ? Math.round(earned / max * 100) / 10 : 0;
    return { done: done, of: of, earned: earned, max: max, score: s, bonus: bonus, points: Math.round((s + bonus) * 10) / 10, answered: answered, pct: Math.round(s * 10) };
  }
  /** 8.6, 10 or 0 for a day's score. */
  function fmtScore(x) { x = Number(x) || 0; return x >= 10 ? '10' : x <= 0 ? '0' : (Math.round(x * 10) / 10).toFixed(1); }
  /** Point totals: 86.4, or 120 with no trailing .0. */
  function fmtPts(x) { var r = Math.round((Number(x) || 0) * 10) / 10; return r % 1 ? r.toFixed(1) : String(r); }
  /** The last day of the challenge week date is in ('' if the final week is cut short). */
  function weekEndOf(date) {
    var p = S.me.program, n = diffDays(p.start, date) + 1;
    if (n < 1) return '';
    var last = Math.ceil(n / 7) * 7;
    return last <= p.length ? addDays(p.start, last - 1) : '';
  }
  function finisherUnit(units) { return units.filter(function (u) { return u[0] === 'finisher'; })[0] || null; }
  function finishersDone(endDate) { var n = 0; for (var i = 0; i < 7; i++) if (answersFor(addDays(endDate, -i)).finisher === 1) n++; return n; }
  /** Missed finishers count against the last day of each week, at the goal saved with that day. */
  function shortfallFor(date, units) {
    if (weekEndOf(date) !== date) return 0;
    var f = finisherUnit(units), goal = f ? Number(f[3]) || 0 : 0;
    if (!goal) return 0;
    return Math.max(0, goal - finishersDone(date)) * (Number(f[1]) || 0);
  }
  function itemsForDate(date) {
    if (S.me.checklists && S.me.checklists[date]) return S.me.checklists[date];
    var e = S.me.history[date];
    if (e && e.u && e.u.length) return itemsFromUnits(e.u, date);
    return null;
  }
  function itemsFromUnits(units, date) {
    var thatDay = dayInfo(date) || {};
    var today = S.me.checklists && S.me.checklists[S.me.program.today];
    var ref = today || S.me.preview || [];
    var byKey = {};
    ref.forEach(function (it) { it.units.forEach(function (u) { byKey[u[0]] = { item: it, unit: u }; }); });
    var names = { video: 'Watched the video', nutrition: 'Followed my nutrition plan', workout: 'Daily workout', sleep: 'Sleep', protein: 'Protein goal', hydration: 'Hydration', finisher: 'Finisher workout', skill: 'Skill work', mobility: 'Mobility', recovery: 'Recovery session', bonus: 'Bonus task' };
    var meals = { 'nutrition:m1': 'Breakfast', 'nutrition:m2': 'Lunch', 'nutrition:m3': 'Dinner', 'nutrition:snack': 'Snacks or none' };
    var out = [], seen = {};
    units.forEach(function (u) {
      var id = String(u[0]).split(':')[0];
      if (seen[id]) return;
      seen[id] = true;
      var own = units.filter(function (v) { return String(v[0]).split(':')[0] === id; });
      var m = id === 'bonus' ? null : byKey[u[0]];
      out.push({
        id: id,
        label: id === 'bonus' ? (thatDay.bonus || names.bonus) : m ? m.item.label : (names[id] || 'Habit'),
        // The finisher shows the weekly goal it was saved with, like its score does.
        sub: id === 'finisher' && own[0] && own[0][3] ? 'Goal: ' + own[0][3] + ' a week · counts on the days you do one' : m && id !== 'video' ? m.item.sub : '',
        icon: m ? m.item.icon : ({ video: 'play', nutrition: 'plate', workout: 'dumbbell', sleep: 'moon', protein: 'protein', hydration: 'drop', finisher: 'bolt', skill: 'target', mobility: 'stretch', recovery: 'recovery', bonus: 'spark' })[id] || 'star',
        kind: id === 'nutrition' ? 'meals' : undefined,
        bonus: id === 'bonus',
        // slot 4: the meal name, or the weekly goal the finisher was saved with
        units: own.map(function (v) { return [v[0], v[1], v[2], v[0] === 'finisher' ? v[3] : meals[v[0]]]; }),
      });
    });
    return out;
  }
  function dayScore(date) {
    var items = itemsForDate(date);
    if (!items) { var e = S.me.history[date]; return e ? { done: e.d, of: e.n, score: e.s || 0, bonus: e.b || 0, points: e.p || 0, pct: Math.round((e.s || 0) * 10), answered: 0 } : null; }
    var u = unitsOf(items);
    return score(u, answersFor(date), shortfallFor(date, u));
  }
  function logged(date) { return Object.keys(answersFor(date)).length > 0; }
  function allDates() { var p = S.me.program, out = []; for (var i = 0; i < p.length; i++) out.push(addDays(p.start, i)); return out; }
  /** Points = daily scores plus bonuses. Average = the daily score over every day so far (today once it's logged). */
  function totals() {
    var p = S.me.program, pts = 0, days = 0, scoreSum = 0, counted = 0;
    var last = p.phase === 'after' ? p.end : p.today;
    allDates().forEach(function (d) {
      if (d > last) return;
      var isLogged = logged(d);
      var sc = isLogged ? dayScore(d) : null;
      if (isLogged) days++;
      if (sc) pts += sc.points;
      if (d === p.today && !isLogged) return;
      counted++;
      scoreSum += sc ? sc.score : 0;
    });
    return { points: Math.round(pts * 10) / 10, days: days, average: counted ? Math.round(scoreSum / counted * 10) / 10 : 0, streak: streak() };
  }
  function streak() {
    var p = S.me.program;
    if (p.phase === 'before') return 0;
    var d = p.phase === 'after' ? p.end : p.today;
    if (!logged(d)) d = addDays(d, -1);
    var n = 0;
    while (d >= p.start && logged(d)) { n++; d = addDays(d, -1); }
    return n;
  }
  function dayInfo(date) { return S.me.days.filter(function (d) { return d.date === date; })[0] || null; }
  /** True while the loaded data is from an earlier calendar day than this phone's (the day just changed). */
  function stale() { return !!(S.loadedDay && S.loadedDay !== localToday()); }
  function editable(date) {
    var p = S.me.program;
    if (stale()) return false;
    return !!(S.me.checklists && S.me.checklists[date]) && date >= p.editFrom && date <= p.editTo;
  }

  /* ============================================================ overdue days */

  /** Everyday habits on a day's list with no Yes or No yet (the finisher and a bonus task are optional). Null when the day has no list. */
  function habitsLeft(date) {
    var items = itemsForDate(date);
    if (!items) return null;
    var a = answersFor(date), n = 0;
    items.forEach(function (it) {
      if (it.bonus || it.units.some(function (u) { return Number(u[2]) !== 0; })) return;
      if (it.units.some(function (u) { return a[u[0]] !== 1 && a[u[0]] !== 0; })) n++;
    });
    return n;
  }
  /**
   * Where a challenge day stands: upcoming; today (not finished yet); done (every habit has a Yes
   * or No); overdue (an earlier day still open for changes, not finished); partial (locked, some
   * answers); missed (locked, never filled in). 'out' is outside the challenge.
   */
  function dayState(date) {
    var p = S.me.program, n = diffDays(p.start, date) + 1;
    if (n < 1 || n > p.length) return 'out';
    if (date > p.today) return 'upcoming';
    if (habitsLeft(date) === 0) return 'done';
    var open = !!(S.me.checklists && S.me.checklists[date]) && date >= p.editFrom && date <= p.editTo;
    if (open) return date === p.today ? 'today' : 'overdue';
    return logged(date) ? 'partial' : 'missed';
  }
  /** Earlier days that can still be filled in but aren't finished, oldest first (except the one on screen). */
  function overdueDays(except) {
    var p = S.me.program, out = [];
    if (!S.me.checklists || stale() || p.phase === 'before') return out;
    for (var d = p.editFrom; d < p.today && d <= p.end; d = addDays(d, 1)) if (d !== except && dayState(d) === 'overdue') out.push(d);
    return out;
  }
  function dayName(date) {
    var t = S.me.program.today;
    return date === t ? 'Today' : date === addDays(t, -1) ? 'Yesterday' : fmt(date, { weekday: 'long' });
  }
  /** Kevin, 11/11/2026: a week stays open until midnight on the first day after it (the Monday), when the scores are pulled. */
  function lastOpenDay(date) { return addDays(weekRange(date)[0], 7); }
  function openDayName() { return fmt(S.me.program.start, { weekday: 'long' }); }
  function closesText(date) {
    var last = lastOpenDay(date), t = S.me.program.today;
    if (last <= t) return 'Last chance: it locks at midnight tonight';
    if (last === addDays(t, 1)) return 'You can fill it in until tomorrow at midnight';
    return 'You can fill it in until ' + fmt(last, { weekday: 'long' }) + ' at midnight';
  }
  function leftText(date) {
    var left = habitsLeft(date) || 0;
    return logged(date) ? plural(left, 'habit') + (left === 1 ? ' still needs' : ' still need') + ' a Yes or No' : 'Not filled in yet';
  }
  /** Today's reminder: every earlier day that's still open and unfinished, one tap away. */
  function overdueCard(except) {
    var list = overdueDays(except), p = S.me.program;
    if (!list.length) return '';
    var stripFrom = weekRange(except || p.today)[0];
    var foldable = list.length > 3 && list.slice(3).every(function (d) { return d >= stripFrom; });
    var shown = foldable ? list.slice(0, 3) : list;
    return '<section class="od-card" id="overdueCard" data-except="' + esc(except || '') + '" aria-label="Overdue days"><div class="od-head">' + icon('clock', 'ico-sm') + '<span>' + (list.length === 1 ? 'Overdue' : list.length + ' days overdue') + '</span></div>' +
      shown.map(function (d) {
        return '<a class="od-row" href="#/day/' + d + '"><span class="od-main"><b>' + esc(dayName(d)) + ' · Day ' + (diffDays(p.start, d) + 1) + '</b><span>' + esc(leftText(d) + '. ' + closesText(d) + '.') + '</span></span><span class="od-go">Fill in' + icon('chevR', 'ico-sm') + '</span></a>';
      }).join('') +
      // Rows beyond three are folded only when they're in the week strip below (mid-week). On a
      // Monday, last week's days aren't in it, so they're all listed.
      (shown.length < list.length ? '<p class="od-more">' + esc('And ' + plural(list.length - shown.length, 'more day') + '. The week strip below shows them all.') + '</p>' : '') + '</section>';
  }
  /** On an overdue day's own page: what's missing and how long it stays open. */
  function dayNote(date) {
    if (stale() || dayState(date) !== 'overdue') return '';
    return '<div class="od-note">' + icon('clock', 'ico-sm') + '<span><b>Overdue.</b> ' + esc((logged(date) ? leftText(date) + '.' : 'Tap Yes or No on each habit below to fill in this day.') + ' ' + closesText(date) + '.') + '</span></div>';
  }
  /** The challenge week around a day, one tap to open any day so far. Overdue days stand out. */
  function weekStrip(selected) {
    // After midnight, until today's data arrives, yesterday's view of the week would be wrong: wait.
    if (stale()) return '<section class="card week-strip" id="weekStrip" data-date="' + selected + '" hidden></section>';
    var p = S.me.program, range = weekRange(selected);
    var words = { upcoming: 'coming up', today: 'today, not finished yet', done: 'filled in', overdue: 'overdue, you can still fill it in', partial: 'partly filled in, now locked', missed: 'missed' };
    var count = 0, cells = '';
    for (var d = range[0]; d <= range[1]; d = addDays(d, 1)) {
      var st = dayState(d);
      if (st === 'out') { cells += '<span class="wk-d is-out" aria-hidden="true"></span>'; continue; }
      if (st === 'overdue') count++;
      // A locked, half-filled day shows its score rather than the check a finished day gets.
      var part = st === 'partial' ? dayScore(d) : null;
      var mark = st === 'done' ? icon('check', 'ico-sm') : part ? esc(fmtScore(part.score)) : st === 'overdue' ? '!' : st === 'missed' || st === 'partial' ? '–' : st === 'today' ? '•' : '';
      var cls = 'wk-d is-' + st + (d === selected ? ' is-sel' : '');
      var inner = '<span class="wk-w">' + (d === p.today ? 'Today' : esc(fmt(d, { weekday: 'short' }))) + '</span><span class="wk-n">' + keyDate(d).getDate() + '</span><span class="wk-m" aria-hidden="true">' + mark + '</span>';
      var label = fmt(d, { weekday: 'long', month: 'long', day: 'numeric' }) + ', Day ' + (diffDays(p.start, d) + 1) + ', ' + words[st] + (part ? ', score ' + fmtScore(part.score) + ' out of 10' : '');
      cells += st === 'upcoming'
        ? '<span class="' + cls + '" role="img" aria-label="' + esc(label) + '">' + inner + '</span>'
        : '<a class="' + cls + '" href="' + (d === p.today ? '#/today' : '#/day/' + d) + '" aria-label="' + esc(label) + '"' + (d === selected ? ' aria-current="date"' : '') + '>' + inner + '</a>';
    }
    var thisWeek = range[0] <= p.today && p.today <= range[1];
    return '<section class="card week-strip" id="weekStrip" data-date="' + selected + '"><div class="wk-head"><span class="kicker">' + (thisWeek ? 'This week' : 'Week ' + (Math.floor(diffDays(p.start, range[0]) / 7) + 1)) + '</span>' +
      (count ? '<span class="badge badge-warn">' + count + ' overdue</span>' : '') + '</div><div class="wk-row">' + cells + '</div></section>';
  }
  /** After a tap or a save: repaint what depends on every day's answers (week strip, overdue note and card, the Today badge). */
  function refreshStatusParts() {
    if (!S.me) return;
    var ws = document.getElementById('weekStrip');
    if (ws) ws.outerHTML = weekStrip(ws.getAttribute('data-date'));
    var dn = document.getElementById('dayNote');
    if (dn) dn.innerHTML = dayNote(dn.getAttribute('data-date'));
    var oc = document.getElementById('overdueCard');
    if (oc) { var html = overdueCard(oc.getAttribute('data-except') || ''); if (html) oc.outerHTML = html; else oc.remove(); }
    var od = overdueDays().length;
    Array.prototype.forEach.call(document.querySelectorAll('[data-od-badge]'), function (b) {
      b.textContent = od;
      b.hidden = !od;
      b.setAttribute('aria-label', plural(od, 'day') + ' overdue');
    });
  }

  /* ============================================================ landing */

  function viewLanding() {
    var c = S.config;
    // Through the beta link: the beta test's dates. Until the first answer from the server, no dates
    // at all rather than the real ones flashing first.
    var b = betaInfo();
    var waiting = !b && store.get('res27.beta', false) && !S.configLoaded;
    var start = b ? b.start : c.startDate, end = b ? b.end : c.endDate;
    // Two halves that each stay whole, so a very narrow phone wraps the line instead of cutting the year off.
    var dateHtml = waiting ? '<span class="nw">' + icon('calendar') + 'Beta test</span>'
      : '<span class="nw">' + icon('calendar') + esc(fmt(start, { month: 'short', day: 'numeric' }) + ' –') + '</span> <span class="nw">' + esc(fmt(end, { month: 'short', day: 'numeric', year: 'numeric' })) + '</span>';
    var lengthText = b ? weeksText(b.days) : weeksText(Math.round(c.lengthDays / 7) * 7);
    var betaNote = b ? '<div class="l-beta">' + icon('info') + '<span><b>This is the beta test.</b> ' + esc(weeksText(b.days)) + ' on the real dates, so you can try the app before the challenge. Everything you enter is practice and gets cleared before Day 1 on ' + esc(fmt(c.startDate, { month: 'long', day: 'numeric' })) + '.</span></div>' : '';
    var choices = c.registrationOpen
      ? '<button class="choice" data-act="choose-type" data-type="member"><span class="c-icon">' + kx() .replace('class="kx"', 'class="kx" style="width:30px;height:17px;fill:#fff"') + '</span><span><span class="c-title">Current Koda Member</span><span class="c-sub">I train at Koda CrossFit Iron View</span></span><span class="chev">' + icon('chevR') + '</span></button>' +
        '<button class="choice" data-act="choose-type" data-type="remote"><span class="c-icon silver">' + icon('globe', 'ico-lg') + '</span><span><span class="c-title">Remote Participant <span class="badge badge-brand">$' + esc(c.remotePrice) + '</span></span><span class="c-sub">Join from anywhere with the full program</span></span><span class="chev">' + icon('chevR') + '</span></button>'
      : '<div class="card card-pad" style="grid-column:1/-1;box-shadow:var(--shadow-lg)"><b>Sign-ups are closed for now.</b><p class="muted" style="margin:6px 0 0">Already signed up? <a href="#/signin">Sign in</a>. Questions? Email <a href="mailto:' + esc(c.contactEmail) + '">' + esc(c.contactEmail) + '</a>.</p></div>';
    return '<div class="landing">' +
      '<section class="l-hero">' + kx('watermark') +
        '<div class="l-inner">' +
          '<div class="l-top"><a class="l-logo" href="#/">' + kx() + '<span>Koda CrossFit Iron View</span></a><a class="btn btn-sm btn-secondary l-signin" href="#/signin">Sign in</a></div>' +
          '<div class="l-copy">' +
            (b || waiting ? '<span class="l-beta-tag">Beta test</span>' : '') +
            '<div class="l-when"><span class="l-date">' + dateHtml + '</span>' + (waiting ? '' : '<span class="l-weeks">' + esc(lengthText) + '</span>') + '</div>' +
            '<h1 class="l-title">Koda<br><span class="silver">Resolutions 2027</span></h1>' +
            '<p class="l-sub">Six weeks. Your goal, your nutrition plan and your own daily checklist — with the whole Koda community in your corner.</p>' +
            betaNote +
          '</div>' +
        '</div>' +
      '</section>' +
      '<div class="l-choices">' + choices + '</div>' +
      '<p class="l-signin-line">Already signed up? <a href="#/signin">Sign in</a></p>' +
      // While a beta is open, a tester who lost the beta link (e.g. a home-screen app opened first) can still get to it.
      (!b && !waiting && c.beta && !(c.beta.end < localToday()) ? '<p class="l-beta-line">Here for the beta test? <button class="btn-link" data-act="join-beta">Join the beta</button></p>' : '') +
      '<section class="l-section"><h2 class="l-callout">How it works</h2><p class="l-callsub">Simple, every single day</p>' +
        '<div class="steps4">' + C.steps.map(function (s, i) { return '<div class="card step4"><div class="n">0' + (i + 1) + '</div><h3>' + esc(s.title) + '</h3><p>' + esc(s.text) + '</p></div>'; }).join('') + '</div>' +
      '</section>' +
      '<section class="l-section"><h2 class="l-callout">What you get</h2><p class="l-callsub">Everything in one place</p>' +
        '<div class="perks">' + C.perks.map(function (p) { return '<div class="card perk"><span class="p-icon">' + icon(p.icon) + '</span><span><b>' + esc(p.title) + '</b><span>' + esc(p.text) + '</span></span></div>'; }).join('') + '</div>' +
      '</section>' +
      '<footer class="l-foot"><span>Koda CrossFit Iron View · 740 S Pierce Ave #5, Louisville, CO</span><span>Questions? <a href="mailto:' + esc(c.contactEmail) + '">' + esc(c.contactEmail) + '</a></span></footer>' +
    '</div>' + toastHtml();
  }

  /* ============================================================ sign-up flow */

  function joinSteps(d) {
    var steps = [];
    if (d.memberType === 'remote') steps.push('payment');
    steps.push('about', 'goal', 'track');
    if (needsDetails(d)) steps.push('details');
    steps.push('coaches', 'review');
    return steps;
  }
  function needsDetails(d) { var t = d.track; return !!(t.nutrition || t.sleep || t.protein || t.hydration || t.finishers || t.skill || t.mobility); }
  function trackAnswered(d) { return C.tracking.every(function (t) { return d.track[t.id] === true || d.track[t.id] === false; }); }

  function flowFrame(opts) {
    var steps = opts.steps || [];
    var idx = steps.indexOf(opts.step);
    var bars = steps.map(function (s, i) { return '<span class="' + (i <= idx ? 'is-on' : '') + '"></span>'; }).join('');
    return '<div class="flow">' +
      '<header class="flow-head"><div class="flow-head-inner">' +
        '<button class="icon-btn" data-act="' + (opts.backAct || 'back') + '" aria-label="Back">' + icon('chevL') + '</button>' +
        (steps.length ? '<div class="flow-steps" aria-hidden="true">' + bars + '</div><span class="flow-count">' + (idx + 1) + ' of ' + steps.length + '</span>' : '<div style="flex:1"></div>') +
      '</div></header>' +
      '<main class="flow-body">' + (S.formError ? '<div class="form-error" role="alert">' + esc(S.formError) + '</div>' : '') + opts.body + '</main>' +
      '<footer class="flow-foot"><div class="flow-foot-inner">' + opts.foot + '</div></footer>' +
    '</div>' + toastHtml();
  }

  function viewJoin(step) {
    var d = S.draft;
    if (!d.memberType) { setTimeout(function () { go('#/'); }, 0); return ''; }
    var steps = joinSteps(d);
    if (steps.indexOf(step) < 0) step = steps[0];
    var body = '';
    var nextLabel = 'Continue';
    if (step === 'payment') body = stepPayment(d);
    else if (step === 'about') body = stepAbout(d);
    else if (step === 'goal') body = stepGoal(d, 'What’s your main focus?', 'We’ll tailor your coaching tips to it.');
    else if (step === 'track') body = stepTrack(d);
    else if (step === 'details') body = stepDetails(d);
    else if (step === 'coaches') { body = stepCoaches(d); nextLabel = d.coaches.length ? 'Continue' : 'Skip — no preference'; }
    else if (step === 'review') { body = stepReview(d); nextLabel = 'Create my account'; S.returnToReview = false; }
    if (S.returnToReview && step !== 'review') nextLabel = 'Back to review';
    var foot = '<button class="btn btn-primary" data-act="next" data-step="' + step + '"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? '<span class="spinner"></span>' : esc(nextLabel)) + '</button>';
    return flowFrame({ steps: steps, step: step, body: body, foot: foot });
  }

  function fieldErr(name) { return S.errors[name] ? '<span class="error">' + esc(S.errors[name]) + '</span>' : ''; }

  function stepPayment(d) {
    var c = S.config;
    // Beta test: the same choices, but nothing that sends money.
    var beta = !!betaInfo();
    var methods = [
      { id: 'venmo', title: 'Venmo', sub: c.venmo || 'Venmo', icon: 'phone' },
      { id: 'zelle', title: 'Zelle', sub: c.zelle || 'Zelle', icon: 'bank' },
      { id: 'card', title: 'Credit card', sub: c.cardUrl ? 'Secure online checkout' : 'We’ll email you a secure link', icon: 'card' },
    ];
    var detail = '';
    if (d.payment === 'venmo') {
      detail = '<div class="pay-detail"><div class="kicker">Send $' + esc(c.remotePrice) + ' on Venmo to</div><div class="big">' + esc(c.venmo) + '</div><p class="muted" style="margin:6px 0 12px;font-size:14px">Put your name and “Resolutions” in the note.</p>' +
        (!beta && venmoPayUrl('Koda Resolutions 2027' + (d.first || d.last ? ' - ' + (d.first + ' ' + d.last).trim() : '')) ? '<a class="btn btn-primary btn-sm" href="' + esc(venmoPayUrl('Koda Resolutions 2027' + (d.first || d.last ? ' - ' + (d.first + ' ' + d.last).trim() : ''))) + '" target="_blank" rel="noopener">' + icon('phone', 'ico-sm') + 'Pay $' + esc(c.remotePrice) + ' on Venmo</a>' : '') + '</div>';
    } else if (d.payment === 'zelle') {
      detail = '<div class="pay-detail"><div class="kicker">Send $' + esc(c.remotePrice) + ' with Zelle to</div><div class="big">' + esc(c.zelle) + '</div><p class="muted" style="margin:6px 0 12px;font-size:14px">Use your bank’s app and put your name in the memo.</p>' +
        '<button class="btn btn-secondary btn-sm" data-act="copy" data-text="' + esc(c.zelle) + '">' + icon('copy', 'ico-sm') + 'Copy</button></div>';
    } else if (d.payment === 'card') {
      detail = '<div class="pay-detail">' + (c.cardUrl && !beta
        ? '<div class="kicker">Pay $' + esc(c.remotePrice) + ' by card</div><p class="muted" style="margin:6px 0 12px;font-size:14px">Checkout opens in a new tab. Come back here to finish signing up.</p><a class="btn btn-secondary btn-sm" href="' + esc(c.cardUrl) + '" target="_blank" rel="noopener">' + icon('external', 'ico-sm') + 'Pay securely</a>'
        : '<div class="kicker">Pay $' + esc(c.remotePrice) + ' by card</div><p class="muted" style="margin:6px 0 0;font-size:14px">Finish signing up and we’ll email you a secure card link within a day.</p>') + '</div>';
    }
    if (beta && d.payment) {
      detail = '<div class="pay-detail"><div class="kicker">Beta test: nothing to pay</div><p class="muted" style="margin:6px 0 0;font-size:14px">In the real challenge, this is where you’d send $' + esc(c.remotePrice) + ' ' +
        esc(d.payment === 'venmo' ? 'on Venmo to ' + c.venmo : d.payment === 'zelle' ? 'with Zelle to ' + c.zelle : 'by card') + '.</p></div>';
    }
    return '<h1>Remote Participant</h1><p class="lead">The full program from anywhere: daily coaching videos, your own checklist, nutrition guides, a Koda coach and a team. <b style="color:var(--text)">$' + esc(c.remotePrice) + '</b> for all ' + Math.round(c.lengthDays / 7) + ' weeks.</p>' +
      (beta ? '<div class="callout callout-warn" style="margin-bottom:16px">' + icon('info') + '<span><b style="color:inherit">Beta test: don’t send any money.</b> Pick any option to see how it works. Beta sign-ups never pay.</span></div>' : '') +
      '<div class="kicker" style="margin-bottom:10px">How would you like to pay?</div>' +
      '<div class="option-list">' + methods.map(function (m) {
        return '<button class="option' + (d.payment === m.id ? ' is-on' : '') + '" data-act="pay" data-method="' + m.id + '" aria-pressed="' + (d.payment === m.id) + '"><span class="o-icon">' + icon(m.icon) + '</span><span class="o-text"><span class="o-title">' + esc(m.title) + '</span><span class="o-sub">' + esc(m.sub) + '</span></span><span class="radio"></span></button>';
      }).join('') + '</div>' + fieldErr('payment') + detail +
      (beta ? '' : '<p class="muted" style="font-size:13.5px;margin-top:16px">Your spot is confirmed once we see your payment. You can keep signing up now.</p>');
  }

  function shirtFields(d) {
    var sizes = d.shirt ? S.config.sizes[d.shirt] || [] : [];
    return '<div class="field"><span class="label">Challenge shirt</span>' +
      '<div class="seg seg-block" role="group" aria-label="Shirt style">' +
        '<button data-act="shirt" data-shirt="tee" class="' + (d.shirt === 'tee' ? 'is-on' : '') + '" aria-pressed="' + (d.shirt === 'tee') + '">T-Shirt</button>' +
        '<button data-act="shirt" data-shirt="tank" class="' + (d.shirt === 'tank' ? 'is-on' : '') + '" aria-pressed="' + (d.shirt === 'tank') + '">Ladies Tank</button>' +
      '</div>' + fieldErr('shirt') + '</div>' +
      (d.shirt ? '<div class="field"><span class="label">' + (d.shirt === 'tank' ? 'Tank' : 'T-Shirt') + ' size</span><div class="chips" role="group" aria-label="Size">' +
        sizes.map(function (s) { return '<button class="chip' + (d.size === s ? ' is-on' : '') + '" data-act="size" data-size="' + s + '" aria-pressed="' + (d.size === s) + '">' + s + '</button>'; }).join('') +
      '</div>' + fieldErr('size') + '</div>' : '');
  }

  function stepAbout(d) {
    return '<h1>About you</h1><p class="lead">You’ll sign in with your email and a simple password. We’ll keep you signed in on this device.</p>' +
      '<div class="row-2">' +
        '<label class="field"><span class="label">First name</span><input class="input' + (S.errors.first ? ' is-invalid' : '') + '" data-field="first" value="' + esc(d.first) + '" autocomplete="given-name" autocapitalize="words" data-autofocus>' + fieldErr('first') + '</label>' +
        '<label class="field"><span class="label">Last name</span><input class="input' + (S.errors.last ? ' is-invalid' : '') + '" data-field="last" value="' + esc(d.last) + '" autocomplete="family-name" autocapitalize="words">' + fieldErr('last') + '</label>' +
      '</div>' +
      '<label class="field"><span class="label">Email</span><input class="input' + (S.errors.email ? ' is-invalid' : '') + '" type="email" inputmode="email" data-field="email" value="' + esc(d.email) + '" autocomplete="email" autocapitalize="off" spellcheck="false">' + fieldErr('email') +
        (S.emailTaken ? '<span class="error">This email is already signed up. <a href="#/signin">Sign in instead</a></span>' : '') + '</label>' +
      '<label class="field"><span class="label">Create a password</span><span class="input-wrap"><input class="input' + (S.errors.password ? ' is-invalid' : '') + '" type="password" data-field="password" value="' + esc(S.password) + '" autocomplete="new-password" minlength="6"><button class="icon-btn reveal" type="button" data-act="reveal" aria-label="Show password">' + icon('eye') + '</button></span>' +
        (S.errors.password ? fieldErr('password') : '<span class="hint">At least 6 characters.</span>') + '</label>' +
      shirtFields(d);
  }

  function stepGoal(d, title, lead) {
    return '<h1>' + esc(title) + '</h1><p class="lead">' + esc(lead) + '</p>' +
      '<div class="goal-grid" role="radiogroup" aria-label="Main focus">' + C.goals.map(function (g) {
        var on = d.goal === g.id;
        return '<button class="goal' + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" data-act="goal" data-goal="' + g.id + '"><span class="g-icon">' + icon(g.icon, 'ico-lg') + '</span><span class="g-title">' + esc(g.label) + '</span><span class="g-sub">' + esc(g.blurb) + '</span></button>';
      }).join('') + '</div>' + fieldErr('goal');
  }

  function ynHtml(act, attrs, value, label) {
    return '<div class="yn" role="group" aria-label="' + esc(label) + '">' +
      '<button class="yn-btn yes' + (value === true ? ' is-on' : '') + '" data-act="' + act + '" ' + attrs + ' data-val="1" aria-pressed="' + (value === true) + '">' + (value === true ? icon('check', 'ico-sm') : '') + 'Yes</button>' +
      '<button class="yn-btn no' + (value === false ? ' is-on' : '') + '" data-act="' + act + '" ' + attrs + ' data-val="0" aria-pressed="' + (value === false) + '">No</button></div>';
  }

  function stepTrack(d, editing) {
    var flag = !!S.errors.track;
    return '<h1>' + (editing ? 'Your daily checklist' : 'What do you want to track each day?') + '</h1>' +
      '<p class="lead">Choose Yes or No for each habit. The recommended ones start on Yes.</p>' +
      '<div class="note" style="margin-bottom:14px">' + icon('play', 'ico-sm') + ' <b>Everyone</b> also gets a short daily video — it’s always on your list.</div>' +
      (flag ? '<div class="form-error" role="alert">' + esc(S.errors.track) + '</div>' : '') +
      '<div class="track-list">' + C.tracking.map(function (t) {
        var v = d.track[t.id] === true ? true : d.track[t.id] === false ? false : null;
        var html = '<div class="track' + (v === true ? ' is-yes' : '') + (flag && v === null ? ' is-missing' : '') + '" data-track="' + t.id + '"><span class="t-icon">' + icon(t.icon) + '</span><span><span class="t-title">' + esc(t.label) + (t.recommended ? ' <span class="badge badge-silver">Recommended</span>' : '') + '</span><span class="t-sub">' + esc(t.sub) + '</span>' +
          (flag && v === null ? '<span class="t-need">Choose Yes or No</span>' : '') + '</span>' +
          ynHtml('track', 'data-id="' + t.id + '"', v, t.label);
        // Other: the habit is typed right here.
        if (t.id === 'other' && v === true) {
          html += '<div class="track-more"><label class="field" style="margin:0"><span class="label">Your habit</span><input class="input' + (S.errors.other ? ' is-invalid' : '') + '" data-field="other.0" value="' + esc(d.other[0] || '') + '" placeholder="e.g. No alcohol" maxlength="60" autocapitalize="sentences">' + fieldErr('other') + '</label>' +
            ideaChips('other', C.otherIdeas, String(d.other[0] || '').trim()) + '</div>';
        }
        return html + '</div>';
      }).join('') + '</div>';
  }

  function ideaChips(target, list, current) {
    return '<div class="chips" style="margin-top:10px">' + list.map(function (x) {
      var on = Array.isArray(current) ? current.indexOf(x) >= 0 : current === x;
      return '<button class="chip chip-sm' + (on ? ' is-on' : '') + '" data-act="idea" data-target="' + target + '" data-val="' + esc(x) + '">' + esc(x) + '</button>';
    }).join('') + '</div>';
  }

  function stepDetails(d, editing) {
    var t = d.track, parts = [];
    if (t.nutrition) {
      var macros = d.plan === 'macros'
        ? '<div class="row-4" style="margin-top:14px">' + [['protein', 'Protein (g)'], ['carbs', 'Carbs (g)'], ['fat', 'Fat (g)'], ['calories', 'Calories']].map(function (m) {
            return '<label class="field" style="margin:0"><span class="label">' + m[1] + '</span><input class="input" inputmode="numeric" data-field="macros.' + m[0] + '" value="' + esc(d.macros[m[0]]) + '" placeholder="optional"></label>';
          }).join('') + '</div><label class="check-line" style="margin-top:12px"><input type="checkbox" data-field="macros.wantHelp"' + (d.macros.wantHelp ? ' checked' : '') + '><span>I’d like help setting my macros</span></label>'
        : '';
      var other = d.plan === 'other' ? '<label class="field" style="margin:14px 0 0"><span class="label">Tell us about your plan</span><input class="input' + (S.errors.planOther ? ' is-invalid' : '') + '" data-field="planOther" value="' + esc(d.planOther) + '" placeholder="e.g. Mediterranean, gluten-free, keto">' + fieldErr('planOther') + '</label>' : '';
      parts.push('<section class="card detail-card"><h3>' + icon('plate') + 'Your nutrition plan</h3><p class="lead-sm">Choose the plan you’ll follow for all six weeks.</p><div class="option-list">' +
        C.plans.map(function (p) {
          var on = d.plan === p.id;
          return '<button class="option' + (on ? ' is-on' : '') + '" data-act="plan" data-plan="' + p.id + '" aria-pressed="' + on + '"><span class="o-icon">' + icon(p.icon) + '</span><span class="o-text"><span class="o-title">' + esc(p.label) + (p.recommended ? ' <span class="badge badge-silver">Recommended</span>' : '') + '</span><span class="o-sub">' + esc(p.blurb) + '</span></span><span class="radio"></span></button>';
        }).join('') + '</div>' + fieldErr('plan') + macros + other + '</section>');
    }
    if (t.sleep) {
      parts.push('<section class="card detail-card"><h3>' + icon('moon') + 'Sleep goal</h3><p class="lead-sm">How many hours a night are you aiming for? Seven is the minimum.</p><div class="chips">' +
        sleepChoices().map(function (h) { return '<button class="chip' + (Number(d.sleepHours) === h ? ' is-on' : '') + '" data-act="sleep" data-val="' + h + '">' + h + (h === 9 ? '+' : '') + ' hrs</button>'; }).join('') + '</div></section>');
    }
    if (t.protein) {
      parts.push('<section class="card detail-card"><h3>' + icon('protein') + 'Protein goal</h3><p class="lead-sm">Your daily minimum, in grams. A good target for most people who train is about 0.7–1 g per pound of your goal bodyweight.</p>' +
        '<label class="field" style="margin:0"><span class="label">Grams of protein a day</span><input class="input' + (S.errors.proteinG ? ' is-invalid' : '') + '" inputmode="numeric" data-field="proteinG" value="' + esc(d.proteinG || '') + '" placeholder="e.g. 140" maxlength="3">' +
        (S.errors.proteinG ? fieldErr('proteinG') : '<span class="hint">Example: a 180-lb goal works out to about 125–180 g a day.</span>') + '</label></section>');
    }
    if (t.hydration) {
      var calc = d.bodyweight && Number(d.bodyweight) > 50 ? Math.round(Number(d.bodyweight) / 2) : 0;
      parts.push('<section class="card detail-card"><h3>' + icon('drop') + 'Water goal</h3><p class="lead-sm">Our rule of thumb: half your bodyweight in ounces each day.</p>' +
        '<div class="seg" style="margin-bottom:14px"><button data-act="hydro-mode" data-val="weight" class="' + (d.hydrationMode !== 'custom' ? 'is-on' : '') + '">Use my weight</button><button data-act="hydro-mode" data-val="custom" class="' + (d.hydrationMode === 'custom' ? 'is-on' : '') + '">Set my own</button></div>' +
        (d.hydrationMode === 'custom'
          ? '<label class="field" style="margin:0"><span class="label">Ounces per day</span><input class="input' + (S.errors.hydrationOz ? ' is-invalid' : '') + '" inputmode="numeric" data-field="hydrationOz" value="' + esc(d.hydrationOz) + '" placeholder="e.g. 90">' + fieldErr('hydrationOz') + '</label>'
          : '<label class="field" style="margin:0"><span class="label">Your bodyweight (lbs)</span><input class="input' + (S.errors.hydrationOz ? ' is-invalid' : '') + '" inputmode="numeric" data-field="bodyweight" value="' + esc(d.bodyweight) + '" placeholder="e.g. 180"><span class="hint" id="hydroCalc">' + (calc ? 'Your goal: <b style="color:var(--text)">' + calc + ' oz</b> a day. We only keep the goal, not your weight.' : 'We only keep the goal, not your weight.') + '</span>' + fieldErr('hydrationOz') + '</label>') +
        '</section>');
    }
    if (t.finishers) {
      parts.push('<section class="card detail-card"><h3>' + icon('bolt') + 'Finishers</h3><p class="lead-sm">How many finisher workouts will you aim for each week? Each one counts on the day you do it, and any you miss count against Sunday’s score.</p><div class="chips">' +
        finisherChoices().map(function (n) { return '<button class="chip' + (Number(d.finishersPerWeek) === n ? ' is-on' : '') + '" data-act="fin" data-val="' + n + '">' + n + ' / week</button>'; }).join('') + '</div></section>');
    }
    if (t.skill) {
      parts.push('<section class="card detail-card"><h3>' + icon('target') + 'Skill work</h3><p class="lead-sm">Which skill do you want to work on?</p><input class="input' + (S.errors.skill ? ' is-invalid' : '') + '" data-field="skill" value="' + esc(d.skill) + '" placeholder="e.g. Double-unders" maxlength="60">' + fieldErr('skill') + ideaChips('skill', C.skillIdeas, d.skill) + '</section>');
    }
    if (t.mobility) {
      parts.push('<section class="card detail-card"><h3>' + icon('stretch') + 'Mobility</h3><p class="lead-sm">What mobility do you want to work on?</p><input class="input' + (S.errors.mobility ? ' is-invalid' : '') + '" data-field="mobility" value="' + esc(d.mobility) + '" placeholder="e.g. Hips and ankles" maxlength="60">' + fieldErr('mobility') + ideaChips('mobility', C.mobilityIdeas, d.mobility) + '</section>');
    }
    return (editing ? '' : '<h1>A few details</h1><p class="lead">These fill in your daily checklist.</p>') + parts.join('');
  }
  // Choices from the backend, kept inside Kevin's rules even if an old config is cached on this phone.
  function sleepChoices() { var c = ((S && S.config && S.config.sleepChoices) || []).filter(function (h) { return h >= 7; }); return c.length ? c : [7, 7.5, 8, 8.5, 9]; }
  function finisherChoices() { var c = ((S && S.config && S.config.finisherChoices) || []).filter(function (n) { return n >= 1 && n <= 3; }); return c.length ? c : [1, 2, 3]; }
  /** The sleep goal and finishers a week that will be saved (the same on Review). */
  function sleepValue(d) { return sleepChoices().indexOf(Number(d.sleepHours)) >= 0 ? Number(d.sleepHours) : 7; }
  function finisherValue(d) { return finisherChoices().indexOf(Number(d.finishersPerWeek)) >= 0 ? Number(d.finishersPerWeek) : 2; }

  function stepCoaches(d, editing) {
    var coaches = S.config.coaches;
    return '<h1>' + (editing ? 'Your coaches' : 'Who would you like to work with?') + '</h1><p class="lead">Tap the coaches in order of preference — your first tap is your #1. Tap again to undo. We’ll do our best to match you.</p>' +
      '<div class="coach-grid">' + coaches.map(function (name) {
        var rank = d.coaches.indexOf(name);
        return '<button class="coach' + (rank >= 0 ? ' is-on' : '') + '" data-act="coach" data-name="' + esc(name) + '" aria-pressed="' + (rank >= 0) + '">' + (rank >= 0 ? '<span class="rank">' + (rank + 1) + '</span>' : '') +
          '<span class="avatar">' + esc(name.slice(0, 1).toUpperCase()) + '</span><span>' + esc(name) + '</span><span class="c-sub">' + (rank >= 0 ? (['1st', '2nd', '3rd', '4th', '5th', '6th'][rank] || (rank + 1) + 'th') + ' choice' : 'Coach') + '</span></button>';
      }).join('') + '</div>' +
      (d.coaches.length ? '<p class="center" style="margin-top:16px"><button class="btn-link" data-act="coach-none">Clear my picks</button></p>' : '');
  }

  function setupFromDraft(d) {
    var t = {};
    C.tracking.forEach(function (x) { t[x.id] = d.track[x.id] === true; });
    var s = { goal: d.goal, track: t };
    if (t.nutrition) {
      s.plan = d.plan;
      if (d.plan === 'other') s.planOther = d.planOther;
      if (d.plan === 'macros') s.macros = { protein: d.macros.protein, carbs: d.macros.carbs, fat: d.macros.fat, calories: d.macros.calories, wantHelp: !!d.macros.wantHelp };
    }
    if (t.sleep) s.sleepHours = sleepValue(d);
    if (t.protein) s.proteinG = Math.round(Number(d.proteinG) || 0);
    if (t.hydration) s.hydrationOz = hydrationOz(d);
    if (t.finishers) s.finishersPerWeek = finisherValue(d);
    if (t.skill) s.skill = d.skill;
    if (t.mobility) s.mobility = d.mobility;
    if (t.other) s.other = [String(d.other[0] || '').trim()].filter(Boolean);
    s.coaches = d.coaches.slice();
    return s;
  }
  function hydrationOz(d) {
    if (d.hydrationMode === 'custom') return Math.round(Number(d.hydrationOz) || 0);
    return d.bodyweight && Number(d.bodyweight) > 50 ? Math.round(Number(d.bodyweight) / 2) : Math.round(Number(d.hydrationOz) || 0);
  }

  function checklistPreviewText(d) {
    var t = d.track, out = ['Daily video'];
    if (t.nutrition) out.push(d.plan === 'other' ? 'Nutrition: ' + (d.planOther || 'your plan') : 'Nutrition: ' + ((planInfo(d.plan) || {}).label || 'pick a plan'));
    if (t.workout) out.push('Daily workout');
    if (t.sleep) out.push('Sleep ' + sleepValue(d) + '+ hrs');
    if (t.protein) out.push('Protein ' + (Number(d.proteinG) || '?') + ' g');
    if (t.hydration) out.push('Water ' + (hydrationOz(d) || '?') + ' oz');
    if (t.finishers) out.push('Finishers ' + finisherValue(d) + '/week');
    if (t.skill) out.push('Skill: ' + (d.skill || '?'));
    if (t.mobility) out.push('Mobility: ' + (d.mobility || '?'));
    if (t.recovery) out.push('Recovery');
    if (t.other && String(d.other[0] || '').trim()) out.push(String(d.other[0]).trim());
    return out;
  }

  function stepReview(d) {
    var c = S.config;
    var rows = [
      ['You', esc(d.first + ' ' + d.last) + '<span class="sub">' + esc(d.email) + '</span>', 'about'],
      ['Joining as', d.memberType === 'remote' ? 'Remote participant<span class="sub">$' + esc(c.remotePrice) + ' by ' + esc({ venmo: 'Venmo', zelle: 'Zelle', card: 'credit card' }[d.payment] || '') + '</span>' : 'Current Koda member', d.memberType === 'remote' ? 'payment' : ''],
      ['Shirt', esc((d.shirt === 'tank' ? 'Ladies Tank' : 'T-Shirt') + ' · ' + d.size), 'about'],
      ['Main focus', esc(goalLabel(d.goal)), 'goal'],
      ['Checklist', checklistPreviewText(d).map(esc).join('<br>'), 'track'],
      ['Coaches', d.coaches.length ? d.coaches.map(function (x, i) { return (i + 1) + '. ' + esc(x); }).join('<br>') : 'No preference', 'coaches'],
    ];
    return '<h1>Look good?</h1><p class="lead">You can change your checklist, coaches and shirt any time after you join.</p>' +
      '<div class="card review-sec">' + rows.map(function (r) {
        return '<div class="review-row"><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span>' + (r[2] ? '<button class="btn-link" style="font-size:14px" data-act="jump" data-step="' + r[2] + '">Edit</button>' : '') + '</div>';
      }).join('') + '</div>' +
      (!S.password || S.askPassword ? (S.askPassword = true, '<label class="field" style="margin-top:18px"><span class="label">Your password</span><span class="input-wrap"><input class="input' + (S.errors.password ? ' is-invalid' : '') + '" type="password" data-field="password" value="' + esc(S.password) + '" autocomplete="new-password" minlength="6"><button class="icon-btn reveal" type="button" data-act="reveal" aria-label="Show password">' + icon('eye') + '</button></span>' +
        (S.errors.password ? fieldErr('password') : '<span class="hint">Type it once more — we don’t keep it on this device while you sign up.</span>') + '</label>') : '');
  }

  function validateStep(step, d, editing) {
    var e = {};
    if (step === 'payment' && !d.payment) e.payment = 'Choose how you’d like to pay.';
    if (step === 'about') {
      if (!String(d.first).trim()) e.first = 'Enter your first name.';
      if (!String(d.last).trim()) e.last = 'Enter your last name.';
      if (!validEmail(d.email)) e.email = 'Enter a valid email.';
      if (String(S.password).length < 6) e.password = 'Use at least 6 characters.';
      if (!d.shirt) e.shirt = 'Choose a T-Shirt or a Ladies Tank.';
      else if (!d.size) e.size = 'Choose your size.';
    }
    if (step === 'shirt') {
      if (!d.shirt) e.shirt = 'Choose a T-Shirt or a Ladies Tank.';
      else if (!d.size) e.size = 'Choose your size.';
    }
    if (step === 'goal' && !d.goal) e.goal = 'Pick one to continue.';
    if (step === 'track') {
      if (!trackAnswered(d)) e.track = 'Choose Yes or No for each habit.';
      if (d.track.other === true && !String(d.other[0] || '').trim()) e.other = 'Type the habit you want to track, or choose No.';
    }
    if (step === 'details' || (editing && step === 'track')) {
      var t = d.track;
      var grams = Number(d.proteinG);
      if (t.nutrition && !d.plan) e.plan = 'Choose your nutrition plan.';
      if (t.nutrition && d.plan === 'other' && !String(d.planOther).trim()) e.planOther = 'Tell us a little about your plan.';
      if (t.protein && !(grams >= 30 && grams <= 400)) e.proteinG = 'Enter your daily protein goal in grams (30 to 400).';
      if (t.hydration && hydrationOz(d) < 24) e.hydrationOz = d.hydrationMode === 'custom' ? 'Enter your daily goal in ounces.' : 'Enter your bodyweight to set your goal.';
      if (t.skill && !String(d.skill).trim()) e.skill = 'Name the skill you’ll work on.';
      if (t.mobility && !String(d.mobility).trim()) e.mobility = 'Name the area you’ll work on.';
    }
    if (step === 'review' && String(S.password).length < 6) e.password = 'Use at least 6 characters.';
    return e;
  }

  function joinNext(step) {
    var d = S.draft;
    S.errors = validateStep(step, d);
    S.formError = '';
    if (step === 'about' && S.emailTaken) S.errors.email = S.errors.email || ' ';
    if (Object.keys(S.errors).length) {
      render();
      var first = app.querySelector('.track.is-missing, .is-invalid, .error');
      if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (step === 'review') return submitRegistration();
    if (S.returnToReview && !(step === 'track' && needsDetails(d) && Object.keys(validateStep('details', d)).length)) {
      S.returnToReview = false;
      go('#/join/review');
      return;
    }
    var steps = joinSteps(d);
    var next = steps[steps.indexOf(step) + 1];
    if (step === 'track' && !needsDetails(d)) next = 'coaches';
    go('#/join/' + next);
  }

  function submitRegistration() {
    var d = S.draft;
    if (String(S.password).length < 6) { S.formError = 'Please re-enter your password.'; go('#/join/about'); return; }
    S.busy = true;
    render();
    api('register', {
      token: '', memberType: d.memberType, payment: d.memberType === 'remote' ? d.payment : '', first: d.first.trim(), last: d.last.trim(),
      // The beta link's flag goes as is: the server knows whether a beta is open (and stops a beta
      // sign-up that comes after it ended instead of making it a real one).
      email: d.email.trim(), password: S.password, shirt: d.shirt, size: d.size, setup: setupFromDraft(d), beta: !!store.get('res27.beta', false),
    }).then(function (r) {
      S.busy = false;
      S.token = r.token;
      store.set('res27.token', r.token);
      S.password = '';
      S.askPassword = false;
      S.draft = newDraft();
      store.del('res27.draft');
      S.sheet = { html: welcomeSheet(r.me, r.emailed) };
      S.me = r.me; S.loadedDay = localToday();
      cacheMe();
      go('#/today');
    }, function (e) {
      S.busy = false;
      S.formError = e.message;
      if (e.code === 'exists') { S.emailTaken = true; go('#/join/about'); return; }
      if (e.code === 'beta_over') {
        // The beta ended while this page was open: drop the beta, and go back over the real steps (payment included).
        store.del('res27.beta');
        S.config = Object.assign({}, S.config, { beta: null });
        store.set('res27.config', S.config);
        loadConfig();
        go('#/join/' + joinSteps(d)[0]);
        return;
      }
      render();
      window.scrollTo(0, 0);
    });
  }

  function welcomeSheet(me, emailed) {
    var p = me.person, c = me.config, prog = me.program;
    S.me = S.me || me;
    // Earlier days that can still be filled in (the edit window), counted so the promise is exact.
    var open = prog.phase === 'during' ? Math.max(0, diffDays(prog.editFrom, prog.today)) : 0;
    var when = prog.phase === 'before' ? (prog.beta ? 'The beta test starts ' : 'Day 1 is ') + fmtLong(prog.start) + '.'
      : prog.phase === 'during' && prog.dayNumber === 1 ? (prog.beta ? 'This is the beta test, and today is Day 1!' : 'Today is Day 1!')
      : prog.phase === 'during' ? (prog.beta ? 'This is the beta test. ' : '') + 'Day 1 was ' + fmtLong(prog.start) + ', so today is Day ' + prog.dayNumber + '.' +
        (open ? ' You can still fill in ' + (open === 1 ? 'yesterday' : 'the last ' + open + ' days') + '.' : '')
      : 'The ' + (prog.beta ? 'beta test' : 'challenge') + ' ended ' + fmtLong(prog.end) + '.';
    var btn = p.type === 'Remote' && !p.paid ? payButtons(p, false) : '';
    var how = p.payment === 'Venmo' ? 'on Venmo to ' + c.venmo : p.payment === 'Zelle' ? 'with Zelle to ' + c.zelle + ', with your name in the memo' : 'by card \u2014 ' + (c.cardUrl ? 'use the button below' : 'we\u2019ll email you a secure link');
    var pay = p.type === 'Remote' && !p.paid ? '<div class="callout callout-warn" style="margin-bottom:14px">' + icon('info') + '<span><b style="color:inherit">One more step:</b> send your $' + esc(c.remotePrice) + ' ' + esc(how) + '.' +
      (btn ? '<span style="display:block;margin-top:10px">' + btn + '</span>' : '') + '</span></div>' : '';
    return '<div class="grab"></div><div class="center" style="margin-bottom:8px"><span class="avatar avatar-lg" style="margin:0 auto 12px">' + icon('check', 'ico-lg') + '</span></div>' +
      '<h2 class="center">You\u2019re in, ' + esc(p.first) + '!</h2><p class="muted center" style="margin:0 0 18px">' + esc(when) + ' ' + (emailed ? 'We sent a welcome email to ' + esc(p.email) + '.' : 'Bookmark this page so you can find it again.') + '</p>' + pay +
      '<div class="note" style="margin-bottom:16px"><b>Tip:</b> add this app to your home screen so it\u2019s one tap away. Sign in once there and it remembers you.</div>' +
      '<button class="btn btn-primary btn-block" data-act="close-sheet">Let\u2019s go</button>';
  }

  /* ============================================================ sign in / reset */

  function viewSignIn() {
    return '<div class="auth"><form class="card auth-card" data-form="signin" novalidate>' +
      '<a class="brand" href="#/"><span class="mark">' + kx() + '</span><span class="name">Resolutions<small>2027</small></span></a>' +
      '<h1>Welcome back</h1><p class="lead">Sign in with the email you signed up with. We’ll keep you signed in on this device.</p>' +
      (S.formError ? '<div class="form-error" role="alert">' + esc(S.formError) + '</div>' : '') +
      '<label class="field"><span class="label">Email</span><input class="input" type="email" inputmode="email" name="email" autocomplete="username" autocapitalize="off" spellcheck="false" value="' + esc(S.resetEmail || '') + '" required data-autofocus></label>' +
      '<label class="field"><span class="label">Password</span><span class="input-wrap"><input class="input" type="password" name="password" autocomplete="current-password" required><button class="icon-btn reveal" type="button" data-act="reveal" aria-label="Show password">' + icon('eye') + '</button></span></label>' +
      '<button class="btn btn-primary btn-block" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? '<span class="spinner"></span>' : 'Sign in') + '</button>' +
      '<p class="auth-alt"><a href="#/forgot">Forgot your password?</a></p>' +
      '<p class="auth-alt" style="margin-top:8px">New here? <a href="#/">Join the challenge</a></p>' +
    '</form></div>' + toastHtml();
  }

  function viewForgot() {
    var body;
    if (S.resetStage === 'code') {
      body = '<h1>Check your email</h1><p class="lead">We sent a 6-digit code to <b>' + esc(S.resetEmail) + '</b>. It works for 20 minutes.</p>' +
        (S.formError ? '<div class="form-error" role="alert">' + esc(S.formError) + '</div>' : '') +
        '<label class="field"><span class="label">Code</span><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required data-autofocus style="letter-spacing:.3em;font-weight:700"></label>' +
        '<label class="field"><span class="label">New password</span><span class="input-wrap"><input class="input" type="password" name="password" autocomplete="new-password" minlength="6" required><button class="icon-btn reveal" type="button" data-act="reveal" aria-label="Show password">' + icon('eye') + '</button></span><span class="hint">At least 6 characters.</span></label>' +
        '<button class="btn btn-primary btn-block" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? '<span class="spinner"></span>' : 'Set password and sign in') + '</button>' +
        '<p class="auth-alt"><button class="btn-link" type="button" data-act="reset-again">Send a new code</button></p>';
    } else {
      body = '<h1>Reset your password</h1><p class="lead">Enter your email and we’ll send you a code.</p>' +
        (S.formError ? '<div class="form-error" role="alert">' + esc(S.formError) + '</div>' : '') +
        '<label class="field"><span class="label">Email</span><input class="input" type="email" inputmode="email" name="email" autocomplete="email" autocapitalize="off" spellcheck="false" value="' + esc(S.resetEmail || '') + '" required data-autofocus></label>' +
        '<button class="btn btn-primary btn-block" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? '<span class="spinner"></span>' : 'Send me a code') + '</button>';
    }
    return '<div class="auth"><form class="card auth-card" data-form="forgot" novalidate><a class="brand" href="#/"><span class="mark">' + kx() + '</span><span class="name">Resolutions<small>2027</small></span></a>' + body +
      '<p class="auth-alt"><a href="#/signin">Back to sign in</a></p></form></div>' + toastHtml();
  }

  function submitSignIn(form) {
    var email = form.email.value.trim(), password = form.password.value;
    S.resetEmail = email;
    if (!validEmail(email) || !password) { S.formError = 'Enter your email and password.'; render(); return; }
    S.busy = true; S.formError = ''; render();
    api('login', { token: '', email: email, password: password }).then(function (r) {
      S.busy = false;
      S.token = r.token;
      store.set('res27.token', r.token);
      S.me = r.me; S.loadedDay = localToday();
      cacheMe();
      go('#/today');
    }, function (e) {
      S.busy = false;
      S.formError = e.message;
      render();
    });
  }

  function submitForgot(form) {
    S.formError = '';
    if (S.resetStage !== 'code') {
      var email = form.email.value.trim();
      if (!validEmail(email)) { S.formError = 'Enter a valid email.'; render(); return; }
      S.resetEmail = email; S.busy = true; render();
      api('resetStart', { token: '', email: email }).then(function () {
        S.busy = false; S.resetStage = 'code'; render();
      }, function (e) { S.busy = false; S.formError = e.message; render(); });
      return;
    }
    var code = form.code.value.replace(/\D/g, ''), password = form.password.value;
    if (code.length !== 6) { S.formError = 'Enter the 6-digit code.'; render(); return; }
    if (password.length < 6) { S.formError = 'Your new password needs at least 6 characters.'; render(); return; }
    S.busy = true; render();
    api('resetFinish', { token: '', email: S.resetEmail, code: code, password: password }).then(function (r) {
      S.busy = false; S.resetStage = 'email';
      S.token = r.token; store.set('res27.token', r.token);
      S.me = r.me; S.loadedDay = localToday(); cacheMe();
      toast('Password updated. You’re signed in.');
      go('#/today');
    }, function (e) { S.busy = false; S.formError = e.message; render(); });
  }

  /* ============================================================ Today / a day */

  function viewToday(dateArg) {
    var p = S.me.program;
    S.renderedDayNext = null;
    // Today's own page (from Videos or the calendar) is the Today screen, Overdue card and all.
    if (dateArg && dateArg === p.today && p.phase === 'during') dateArg = null;
    if (!dateArg) {
      if (p.phase === 'before') return viewBefore();
      if (p.phase === 'after' && !editable(p.end)) return viewAfter();
    }
    var date = dateArg || (p.phase === 'after' ? p.end : p.today);
    var n = diffDays(p.start, date) + 1;
    if (n < 1 || n > p.length) return '<div class="empty card">' + icon('calendar', 'ico-lg') + '<p>That day isn’t part of the challenge.</p><a class="btn btn-secondary" href="#/today">Back to today</a></div>';
    var day = dayInfo(date);
    if (!day || !day.released) return '<a class="btn btn-ghost btn-sm" href="#/today" style="margin-bottom:10px">' + icon('chevL', 'ico-sm') + 'Today</a><div class="empty card">' + icon('lock', 'ico-lg') + '<p><b>Day ' + n + ' unlocks ' + esc(fmtLong(date)) + '.</b></p></div>';
    var key = date + '|' + videoKey(day);
    S.renderedDayNext = key;
    // The main screen lists every earlier day that's still open and unfinished (Overdue), one tap
    // away; an overdue day's own page says what's missing and how long it stays open.
    // (After the last day, the main screen is the last day itself: it gets its own note too.)
    var note = '<div id="dayNote" data-date="' + date + '">' + dayNote(date) + '</div>';
    var top = dateArg
      ? '<a class="btn btn-ghost btn-sm" href="#/today" style="margin:-4px 0 10px -8px">' + icon('chevL', 'ico-sm') + 'Today</a>' + note
      : overdueCard(date) + (date !== p.today ? note : '');
    return top +
      '<div class="with-rail"><div>' +
        '<section id="dayHero">' + dayHero(date, day) + '</section>' +
        weekStrip(date) +
        '<section class="card video-card" style="margin-top:16px" data-date="' + date + '">' + videoBlock(date, day) + '</section>' +
        '<section id="dayBody">' + dayBody(date, day) + '</section>' +
      '</div><aside class="rail">' + railHtml() + '</aside></div>';
  }

  function videoKey(day) { var v = currentVideo(day); return v ? v.url : 'none'; }
  function currentVideo(day) {
    var list = day.videos || [];
    if (!list.length) return null;
    var idx = S.variant[day.date];
    if (idx === undefined) {
      var goal = goalLabel(S.me.person.setup.goal).toLowerCase();
      idx = 0;
      list.forEach(function (v, i) { if (v.label && goal && v.label.toLowerCase().indexOf(goal.split(' ')[0]) >= 0) idx = i; });
      S.variant[day.date] = idx;
    }
    return list[idx] || list[0];
  }

  function ringSvg(pct) {
    var r = 44, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
    return '<svg viewBox="0 0 104 104" aria-hidden="true"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b9c2cc"/></linearGradient></defs>' +
      '<circle class="track" cx="52" cy="52" r="' + r + '" fill="none" stroke-width="9"/><circle class="fill" cx="52" cy="52" r="' + r + '" fill="none" stroke-width="9" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '"/></svg>';
  }

  function dayHero(date, day) {
    var p = S.me.program, sc = dayScore(date) || { pct: 0, done: 0, of: 0, score: 0, bonus: 0, points: 0 };
    var n = diffDays(p.start, date) + 1;
    var t = totals();
    var theme = day.theme ? '<span class="theme"><span class="wk">WK ' + day.week + '</span>' + esc(day.theme) + '</span>' : '<span class="theme"><span class="wk">WK ' + day.week + '</span>Week ' + day.week + '</span>';
    return '<div class="hero">' + kx('watermark') +
      '<div class="hero-top"><div>' +
        // (The beta says so in the top bar and the sidebar; here it would push the date onto a second line.)
        '<div class="kick">' + esc((p.preview && !p.beta ? 'Preview · ' : '') + (date === p.today ? 'Today · ' : '') + fmt(date, { weekday: 'short', month: 'short', day: 'numeric' })) + '</div>' +
        '<div class="day">Day ' + n + '<small>/ ' + p.length + '</small></div>' + theme +
      '</div>' +
      '<div class="ring" role="img" aria-label="Score ' + fmtScore(sc.score) + ' out of 10">' + ringSvg(sc.pct) + '<div class="label"><div><span class="pct">' + fmtScore(sc.score) + '</span><span class="of">out of 10</span></div></div></div></div>' +
      '<div class="hero-stats"><span class="hero-stat">' + icon('check', 'ico-sm') + '<span><b>' + sc.done + ' of ' + sc.of + '</b> done</span></span>' +
        (sc.bonus ? '<span class="hero-stat">' + icon('spark', 'ico-sm') + '<span><b>+' + fmtPts(sc.bonus) + '</b> bonus</span></span>' : '') +
        '<span class="hero-stat">' + icon('flame', 'ico-sm') + '<span><b>' + t.streak + '</b>-day streak</span></span><span class="hero-stat">' + icon('trophy', 'ico-sm') + '<span><b>' + fmtPts(t.points) + '</b> total</span></span></div>' +
    '</div>';
  }

  function videoBlock(date, day) {
    var list = day.videos || [];
    var v = currentVideo(day);
    var variants = list.length > 1 ? '<div class="variant-bar" role="group" aria-label="Choose a version">' + list.map(function (x, i) {
      return '<button class="chip chip-sm' + (S.variant[date] === i ? ' is-on' : '') + '" data-act="variant" data-date="' + date + '" data-i="' + i + '">' + esc(x.label || 'Version ' + (i + 1)) + '</button>';
    }).join('') + '</div><div style="height:12px"></div>' : '';
    var frame;
    if (!v) {
      frame = '<div class="video-frame"><div class="video-empty"><div>' + kx('mark') + (date === S.me.program.today
        ? '<b>Today’s video is on its way</b><span style="font-size:14px">Check back soon. You can still check off your list below.</span>'
        : '<b>No video was posted for this day</b>') + '</div></div></div>';
    } else if (v.youtube) {
      frame = '<div class="video-frame" id="videoMount"><button class="poster" data-act="play" data-date="' + date + '" style="background-image:url(https://i.ytimg.com/vi/' + esc(v.youtube) + '/hqdefault.jpg)" aria-label="Play video: ' + esc(day.title) + '"><span class="play">' + icon('play') + '</span><span class="poster-meta"><span>Day ' + day.n + '</span><span>' + (v.standIn ? '2026 video (stand-in)' : day.presenter ? 'with ' + esc(day.presenter) : '') + '</span></span></button></div>';
    } else {
      frame = '<div class="video-frame" id="videoMount"><a class="poster" href="' + esc(v.url) + '" target="_blank" rel="noopener" data-act="ext-video" data-date="' + date + '"><span class="play">' + icon('play') + '</span><span class="poster-meta"><span>Opens in a new tab</span><span>' + icon('external', 'ico-sm') + '</span></span></a></div>';
    }
    return variants + frame + '<div class="video-meta" id="videoMeta">' + videoMeta(date, day) + '</div>';
  }

  function videoMeta(date, day) {
    var a = answersFor(date);
    var watched = a.video === 1;
    var v = currentVideo(day);
    return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' + (day.category ? '<span class="badge">' + esc(day.category) + '</span>' : '') +
      '<span class="badge ' + (watched ? 'badge-good' : '') + '">' + (watched ? icon('check', 'ico-sm') + 'Watched' : 'Counts toward ' + (date === S.me.program.today ? 'today’s' : 'this day’s') + ' score') + '</span>' +
      (v && v.standIn ? '<span class="badge badge-warn" title="The 2027 video isn’t filmed yet. The beta plays the 2026 video this day reuses.">Beta: 2026 stand-in video</span>' : '') + '</div>' +
      '<h2>' + esc(day.title || 'Day ' + day.n) + '</h2>' + (day.about ? '<p>' + esc(day.about) + '</p>' : '') +
      (day.action ? '<div class="action-box">' + icon('target') + '<span><b>' + (date === S.me.program.today ? 'Today’s action' : 'Day ' + day.n + ' action') + '</b>' + esc(day.action) + '</span></div>' : '');
  }

  function dayBody(date, day) {
    var parts = [checklistCard(date, day)];
    var t = S.me.person.setup.track || {};
    if (t.finishers && date === S.me.program.today && S.me.finishers && S.me.finishers.length) parts.push(finishersCard());
    var tip = goalTip(day.week);
    if (tip) parts.push('<section class="card card-pad" style="margin-top:16px"><div class="kicker">Coach tip · ' + esc(goalLabel(S.me.person.setup.goal)) + '</div><p style="margin:8px 0 0;font-size:15.5px;font-weight:500">' + esc(tip) + '</p></section>');
    if (date === S.me.program.today) parts.push(installCard());
    return parts.join('');
  }

  function goalTip(week) { var list = C.tips[S.me.person.setup.goal]; return list ? list[Math.max(0, Math.min(list.length - 1, (week || 1) - 1))] : ''; }

  function saveStateHtml() {
    var s = S.saveState;
    if (s === 'saving') return '<span class="save-state is-saving" role="status"><span class="dot"></span>Saving…</span>';
    if (s === 'saved') return '<span class="save-state is-saved" role="status"><span class="dot"></span>Saved</span>';
    if (s === 'error') return '<button class="save-state is-error" data-act="retry-save" style="border:0;background:none">' + icon('info', 'ico-sm') + 'Not saved · retry</button>';
    return '<span class="save-state"><span class="dot"></span>Saves as you tap</span>';
  }

  function checklistCard(date, day) {
    var items = itemsForDate(date);
    var can = editable(date);
    if (!items) {
      return '<section class="card" id="checklistCard" data-date="' + date + '" style="margin-top:16px"><div class="card-head"><h3>Your checklist</h3></div><div class="card-body"><p class="muted" style="margin:0">' +
        (stale() ? 'Updating to today…' : date < S.me.program.editFrom ? 'You didn’t check in this day, and it’s locked now.' : 'Nothing here yet.') + '</p></div></section>';
    }
    var a = answersFor(date);
    var units = unitsOf(items);
    var short = shortfallFor(date, units);
    var sc = score(units, a, short);
    var rows = items.map(function (it) { return checkRow(date, it, a, can); }).join('');
    var perfect = sc.of && sc.score >= 10 ? '<div class="perfect">' + icon('medal') + '<span>Perfect day! 10 out of 10.</span></div>' : '';
    // Last day of the week: say why missed finishers lower the score.
    if (short > 0) {
      var goal = Number(finisherUnit(units)[3]) || 0, doneF = finishersDone(date), miss = Math.max(0, goal - doneF);
      perfect += '<div class="note locked-note">' + icon('bolt', 'ico-sm') + ' Finishers this week: ' + doneF + ' of ' + goal + '. ' + (miss === 1 ? 'The one you missed counts' : 'The ' + miss + ' you missed count') + ' against ' + (date === S.me.program.today ? 'today’s' : 'this day’s') + ' score.</div>';
    }
    var lockNote = can ? '' : stale()
      ? '<div class="note locked-note">' + icon('clock', 'ico-sm') + ' Updating to today…</div>'
      : '<div class="note locked-note">' + icon('lock', 'ico-sm') + ' This day is locked. Each week stays open until midnight on the ' + esc(openDayName()) + ' after it, when the scores are pulled.</div>';
    return '<section class="card" id="checklistCard" data-date="' + date + '" style="margin-top:16px"><div class="card-head"><h3>Your checklist</h3>' + (can ? saveStateHtml() : '<span class="badge">' + fmtScore(sc.score) + ' / 10</span>') + '</div>' +
      '<ul class="checklist">' + rows + '</ul>' + perfect + lockNote + '</section>';
  }

  function checkRow(date, it, a, can) {
    var dis = can ? '' : ' aria-disabled="true"';
    if (it.kind === 'meals') {
      var yes = it.units.filter(function (u) { return a[u[0]] === 1; }).length;
      var cls = yes === it.units.length ? ' is-done' : '';
      var chips = it.units.map(function (u) {
        var v = a[u[0]];
        return '<button class="meal' + (v === 1 ? ' is-on' : v === 0 ? ' is-off' : '') + '" data-act="meal" data-date="' + date + '" data-key="' + esc(u[0]) + '" aria-pressed="' + (v === 1) + '"' + (can ? '' : ' disabled') + '>' + (v === 1 ? icon('check', 'ico-sm') : v === 0 ? icon('x', 'ico-sm') : '') + esc(u[3] || 'Meal') + '</button>';
      }).join('');
      return '<li class="ci' + cls + '"><span class="ci-icon">' + (yes === it.units.length ? icon('check') : icon(it.icon || 'plate')) + '</span><div><div class="ci-label">' + esc(it.label) + '</div><div class="ci-sub">' + esc(it.sub || '') + (it.sub ? ' · ' : '') + yes + ' of ' + it.units.length + ' on plan</div></div>' +
        (can ? '<button class="meals-all" data-act="meals-all" data-date="' + date + '">All on plan</button>' : '<span></span>') +
        '<div class="ci-meals"' + dis + '>' + chips + '</div></li>';
    }
    var k = it.units[0][0];
    var v = a[k];
    var state = v === 1 ? ' is-done' : v === 0 ? ' is-no' : '';
    var extra = '';
    return '<li class="ci' + state + (it.bonus ? ' is-bonus' : '') + '"><span class="ci-icon">' + (v === 1 ? icon('check') : icon(it.icon || 'star')) + '</span>' +
      '<div><div class="ci-label">' + esc(it.label) + extra + '</div>' + (it.sub ? '<div class="ci-sub">' + esc(it.bonus && date !== S.me.program.today ? String(it.sub).replace(/^Today only/, 'That day only') : it.sub) + '</div>' : '') + '</div>' +
      '<div class="yn" role="group" aria-label="' + esc(it.label) + '"' + dis + '>' +
        '<button class="yn-btn yes' + (v === 1 ? ' is-on' : '') + '" data-act="answer" data-date="' + date + '" data-key="' + esc(k) + '" data-val="1" aria-pressed="' + (v === 1) + '"' + (can ? '' : ' disabled') + '>' + (v === 1 ? icon('check', 'ico-sm') : '') + 'Yes</button>' +
        '<button class="yn-btn no' + (v === 0 ? ' is-on' : '') + '" data-act="answer" data-date="' + date + '" data-key="' + esc(k) + '" data-val="0" aria-pressed="' + (v === 0) + '"' + (can ? '' : ' disabled') + '>No</button>' +
      '</div></li>';
  }

  function weekRange(date) {
    var p = S.me.program, n = diffDays(p.start, date), wk = Math.floor(n / 7);
    var from = addDays(p.start, wk * 7);
    return [from, addDays(from, 6)];
  }

  function finishersCard() {
    var p = S.me.program, range = weekRange(p.today), done = 0;
    for (var d = range[0]; d <= range[1]; d = addDays(d, 1)) if (answersFor(d).finisher === 1) done++;
    var goal = S.me.person.setup.finishersPerWeek || 2;
    return '<section class="card" id="finishersCard" style="margin-top:16px"><div class="card-head"><h3>This week’s finishers</h3><span class="badge ' + (done >= goal ? 'badge-good' : '') + '">' + done + ' of ' + goal + ' done</span></div>' +
      S.me.finishers.map(function (f) {
        var link = f.videos && f.videos[0] ? ' <a href="' + esc(f.videos[0].url) + '" target="_blank" rel="noopener" class="btn-link" style="font-size:13.5px">Demo video</a>' : '';
        return '<div class="list-row" style="align-items:flex-start"><span class="ci-icon">' + icon('bolt') + '</span><span class="grow"><span class="title">' + esc(f.name) + '</span><span class="meta" style="display:block;white-space:pre-line">' + esc(f.workout) + '</span>' + link + '</span></div>';
      }).join('') + '</section>';
  }

  function railHtml() {
    var p = S.me.person, s = p.setup, t = totals();
    var plan = s.track && s.track.nutrition ? (s.plan === 'other' ? s.planOther : (planInfo(s.plan) || {}).label) : 'Not tracking';
    return '<div class="card"><div class="card-head"><h3>Your challenge</h3><a class="btn-link" style="font-size:13.5px" href="#/profile">Edit</a></div>' +
      '<div class="list-row"><span class="grow"><span class="meta">Main focus</span><span class="title" style="display:block">' + esc(goalLabel(s.goal)) + '</span></span></div>' +
      '<div class="list-row"><span class="grow"><span class="meta">Nutrition plan</span><span class="title" style="display:block">' + esc(plan || '') + '</span></span></div>' +
      '<div class="list-row"><span class="grow"><span class="meta">Coach</span><span class="title" style="display:block">' + esc(p.coach || 'Assigned soon') + '</span></span></div>' +
      '<div class="list-row"><span class="grow"><span class="meta">Team</span><span class="title" style="display:block">' + esc(p.team || 'Announced soon') + '</span></span></div></div>' +
      '<div class="card card-pad"><div class="kicker">So far</div><div style="display:flex;justify-content:space-between;margin-top:10px"><span><b style="font-size:22px">' + fmtPts(t.points) + '</b><br><span class="subtle" style="font-size:12.5px">points</span></span><span><b style="font-size:22px">' + t.days + '</b><br><span class="subtle" style="font-size:12.5px">days logged</span></span><span><b style="font-size:22px">' + t.streak + '</b><br><span class="subtle" style="font-size:12.5px">streak</span></span></div></div>';
  }

  function refreshDayParts() {
    var r = route();
    var p = S.me.program;
    var date = r.name === 'day' && r.args[0] ? r.args[0] : (p.phase === 'after' ? p.end : p.today);
    var day = dayInfo(date);
    if (!day) return render();
    var hero = document.getElementById('dayHero');
    var meta = document.getElementById('videoMeta');
    var body = document.getElementById('dayBody');
    if (!hero || !body) return;
    hero.innerHTML = dayHero(date, day);
    if (meta) meta.innerHTML = videoMeta(date, day);
    var y = window.scrollY;
    body.innerHTML = dayBody(date, day);
    var rail = app.querySelector('.rail');
    if (rail) rail.innerHTML = railHtml();
    refreshStatusParts();
    window.scrollTo(0, y);
  }

  /** Repaints the checklist after a tap or a save, but only if that day is the one on screen. */
  function updateChecklistOnly(date) {
    if (!S.me) return;
    var rail = app.querySelector('.rail');
    if (rail) rail.innerHTML = railHtml();
    refreshStatusParts();
    var card = document.getElementById('checklistCard');
    var day = dayInfo(date);
    if (!card || !day || card.getAttribute('data-date') !== date) return;
    var a = document.activeElement, sel = '';
    if (a && card.contains(a) && a.dataset && a.dataset.act) {
      sel = '[data-act="' + a.dataset.act + '"]' + (a.dataset.key ? '[data-key="' + a.dataset.key + '"]' : '') + (a.dataset.val ? '[data-val="' + a.dataset.val + '"]' : '');
    }
    var tmp = document.createElement('div');
    tmp.innerHTML = checklistCard(date, day);
    card.replaceWith(tmp.firstChild);
    if (sel) { var again = document.querySelector('#checklistCard ' + sel); if (again) again.focus({ preventScroll: true }); }
    var hero = document.getElementById('dayHero');
    if (hero) hero.innerHTML = dayHero(date, day);
    var meta = document.getElementById('videoMeta');
    if (meta) meta.innerHTML = videoMeta(date, day);
    var fc = document.getElementById('finishersCard');
    if (fc && S.me.finishers && S.me.finishers.length) { var t2 = document.createElement('div'); t2.innerHTML = finishersCard(); fc.replaceWith(t2.firstChild); }
  }

  /** Kevin's Venmo link with the amount and a note filled in, as on the Hyrox pages. */
  function venmoPayUrl(note) {
    var c = S.config, handle = String(c.venmo || '').trim().replace(/^@/, '');
    if (!handle) return '';
    return 'https://venmo.com/?txn=pay&audience=private&recipients=' + encodeURIComponent(handle) + '&amount=' + encodeURIComponent(c.remotePrice) + '&note=' + encodeURIComponent(note || 'Koda Resolutions 2027');
  }
  function payButtons(person, small) {
    var c = S.config, cls = 'btn ' + (small ? 'btn-secondary btn-sm' : 'btn-primary btn-block');
    var name = person ? ' - ' + person.first + ' ' + person.last : '';
    if (person && person.payment === 'Zelle') return '<button class="' + cls + '" data-act="copy" data-text="' + esc(c.zelle) + '">' + icon('copy', 'ico-sm') + 'Copy Zelle: ' + esc(c.zelle) + '</button>';
    if (person && person.payment === 'Credit Card') return c.cardUrl ? '<a class="' + cls + '" href="' + esc(c.cardUrl) + '" target="_blank" rel="noopener">' + icon('card', 'ico-sm') + 'Pay $' + esc(c.remotePrice) + ' by card</a>' : '';
    var url = (S.me && S.me.payUrl) || venmoPayUrl('Koda Resolutions 2027' + name);
    return url ? '<a class="' + cls + '" href="' + esc(url) + '" target="_blank" rel="noopener">' + icon('phone', 'ico-sm') + 'Pay $' + esc(c.remotePrice) + ' on Venmo</a>' : '';
  }

  function viewBefore() {
    var p = S.me.program, person = S.me.person, c = S.config;
    var days = diffDays(p.today, p.start);
    var ready = store.get('res27.ready', {}) || {};
    var payBtn = payButtons(person, true);
    var pay = person.type === 'Remote' && !person.paid
      ? '<div class="callout callout-warn" style="margin-top:16px">' + icon('info') + '<span><b style="color:inherit">Payment pending.</b> Send $' + esc(c.remotePrice) + ' ' + esc(person.payment === 'Venmo' ? 'on Venmo to ' + c.venmo : person.payment === 'Zelle' ? 'with Zelle to ' + c.zelle : 'by card' + (c.cardUrl ? '' : ' — watch your email for a secure link')) + (person.payment === 'Credit Card' ? '' : ' with your name in the note') + '. We’ll mark it here when it comes in.' +
        (payBtn ? '<span style="display:block;margin-top:10px">' + payBtn + '</span>' : '') + '</span></div>'
      : (person.type === 'Remote' ? '<div class="callout callout-good" style="margin-top:16px">' + icon('check') + '<span><b style="color:inherit">Payment received.</b> You’re all set.</span></div>' : '');
    // A beta tester (or other test account) after the beta: it looks like a real sign-up, but it isn't one.
    if (person.type === 'Test') {
      pay = '<div class="callout callout-warn" style="margin-top:16px">' + icon('info') + '<span><b style="color:inherit">This is a test account.</b> Test and beta accounts are deleted before Day 1, so sign up again for the real challenge when sign-ups open.</span></div>';
    }
    var list = S.me.preview || [];
    var preview = '<section class="card" style="margin-top:16px"><div class="card-head"><h3>Your daily checklist</h3><a class="btn-link" style="font-size:14px" href="#/edit/track">Edit</a></div>' +
      '<div class="card-body" style="padding-bottom:6px"><p class="muted" style="margin:0">Starting Day 1, you’ll check these off every day.</p></div>' +
      '<ul class="checklist">' + list.map(function (it) {
        return '<li class="ci"><span class="ci-icon">' + icon(it.icon || 'star') + '</span><div><div class="ci-label">' + esc(it.label) + '</div>' + (it.sub ? '<div class="ci-sub">' + esc(it.sub) + '</div>' : '') + '</div><span class="badge">' + (it.kind === 'meals' ? '4 meals' : it.units[0][2] === 1 ? 'weekly goal' : it.units[0][2] === 2 ? 'bonus' : 'yes / no') + '</span></li>';
      }).join('') + '</ul></section>';
    var getReady = '<section class="card" style="margin-top:16px"><div class="card-head"><h3>Get ready for Day 1</h3><span class="badge">' + C.getReady.filter(function (x, i) { return ready[i]; }).length + ' of ' + C.getReady.length + '</span></div><ul class="checklist">' +
      C.getReady.map(function (g, i) {
        var on = !!ready[i];
        var more = g.cookbook ? ' <a href="#/nutrition/cookbook">Open the cookbook</a>' : g.link ? ' <a href="' + g.link + '">Open</a>' : '';
        return '<li class="ci' + (on ? ' is-done' : '') + '"><span class="ci-icon">' + icon(on ? 'check' : 'calendar') + '</span><div><div class="ci-label">' + esc(g.title) + '</div><div class="ci-sub">' + esc(g.text) + more + '</div></div>' +
          '<button class="yn-btn yes' + (on ? ' is-on' : '') + '" data-act="ready" data-i="' + i + '" aria-pressed="' + on + '">' + (on ? icon('check', 'ico-sm') + 'Done' : 'Done?') + '</button></li>';
      }).join('') + '</ul></section>';
    var tip = goalTip(1);
    return '<div class="with-rail"><div>' +
      '<section class="hero">' + kx('watermark') +
        '<div class="kick">' + esc(S.config.programName) + '</div>' +
        '<div class="day" style="font-size:52px;margin-top:10px">' + (days === 1 ? 'Starts tomorrow' : days + ' days to go') + '</div>' +
        '<div class="date">Day 1 is ' + esc(fmtLong(p.start)) + ' · ' + esc(weeksText(p.length)) + ', through ' + esc(fmt(p.end, { month: 'short', day: 'numeric' })) + '</div>' +
        '<div class="hero-stats"><span class="hero-stat">' + icon('target', 'ico-sm') + esc(goalLabel(person.setup.goal)) + '</span>' + (person.setup.track && person.setup.track.nutrition ? '<span class="hero-stat">' + icon('plate', 'ico-sm') + esc(person.setup.plan === 'other' ? person.setup.planOther : (planInfo(person.setup.plan) || {}).label) + '</span>' : '') + '</div>' +
      '</section>' + pay + preview + getReady +
      (tip ? '<section class="card card-pad" style="margin-top:16px"><div class="kicker">Coach tip · ' + esc(goalLabel(person.setup.goal)) + '</div><p style="margin:8px 0 0;font-size:15.5px;font-weight:500">' + esc(tip) + '</p></section>' : '') +
      installCard() +
    '</div><aside class="rail">' + railHtml() + '</aside></div>';
  }

  function viewAfter() {
    var t = totals(), p = S.me.program;
    return '<section class="hero">' + kx('watermark') + '<div class="kick">' + esc((p.beta ? 'Beta test · ' : '') + S.config.programName) + '</div><div class="day" style="font-size:54px;margin-top:10px">You finished!</div><div class="date">' + esc(weeksText(p.length)) + ', ' + esc(fmt(p.start, { month: 'short', day: 'numeric' })) + ' – ' + esc(fmt(p.end, { month: 'short', day: 'numeric' })) + '</div>' +
      '<div class="hero-stats"><span class="hero-stat">' + icon('trophy', 'ico-sm') + '<b>' + fmtPts(t.points) + '</b> points</span><span class="hero-stat">' + icon('calendar', 'ico-sm') + '<b>' + t.days + '</b> days logged</span><span class="hero-stat">' + icon('chart', 'ico-sm') + '<b>' + fmtScore(t.average) + '</b> average out of 10</span></div></section>' +
      (p.beta
        ? '<section class="card card-pad" style="margin-top:16px"><h3 style="margin:0 0 6px">Thanks for testing!</h3><p class="muted" style="margin:0 0 14px">That was the beta. Beta accounts are deleted before the real challenge starts ' + esc(fmtLong(S.config.startDate)) + ', so sign up again for that one when sign-ups open.</p><a class="btn btn-secondary" href="#/leaderboard">See the leaderboard</a></section>'
        : '<section class="card card-pad" style="margin-top:16px"><h3 style="margin:0 0 6px">What’s next?</h3><p class="muted" style="margin:0 0 14px">Keep the habits that worked. Your videos and nutrition guides stay here for you.</p><a class="btn btn-secondary" href="#/leaderboard">See the final standings</a></section>');
  }

  function installCard() {
    if (store.get('res27.noinstall', false)) return '';
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone;
    var mobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent);
    if (standalone || !mobile) return '';
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var how = ios ? 'In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>. Sign in once there and it remembers you.' : (S.installEvent ? 'One tap and it’s on your home screen.' : 'In Chrome, tap the <b>⋮ menu</b>, then <b>Add to Home screen</b>.');
    return '<section class="card install" style="margin-top:16px"><span class="i-icon">' + kx() + '</span><span class="grow"><b>Put Resolutions on your home screen</b>' + how + '</span>' +
      (S.installEvent ? '<button class="btn btn-primary btn-sm" data-act="install">Add</button>' : '') + '<button class="icon-btn" data-act="no-install" aria-label="Dismiss">' + icon('x') + '</button></section>';
  }

  /* ============================================================ video player */

  var ytPromise = null;
  function loadYT() {
    if (ytPromise) return ytPromise;
    ytPromise = new Promise(function (resolve, reject) {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (prev) prev(); resolve(window.YT); };
      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = function () { ytPromise = null; reject(new Error('yt')); };
      document.head.appendChild(s);
      setTimeout(function () { reject(new Error('yt timeout')); }, 10000);
    });
    return ytPromise;
  }
  function destroyPlayer() {
    clearInterval(S.watchTimer);
    if (S.player && S.player.destroy) { try { S.player.destroy(); } catch (e) {} }
    S.player = null;
  }
  function playVideo(date) {
    var day = dayInfo(date), v = day && currentVideo(day);
    var mount = document.getElementById('videoMount');
    if (!v || !v.youtube || !mount) return;
    destroyPlayer();
    mount.innerHTML = '<div class="yt-host"><div id="ytHost"></div></div>';
    loadYT().then(function (YT) {
      S.player = new YT.Player('ytHost', {
        videoId: v.youtube, host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onStateChange: function (e) {
            clearInterval(S.watchTimer);
            if (e.data === YT.PlayerState.ENDED) return markWatched(date);
            if (e.data === YT.PlayerState.PLAYING) {
              S.watchTimer = setInterval(function () {
                var pl = S.player;
                if (!pl || !pl.getDuration) return;
                var dur = pl.getDuration(), t = pl.getCurrentTime();
                if (dur > 0 && t / dur >= 0.85) { clearInterval(S.watchTimer); markWatched(date); }
              }, 2000);
            }
          },
        },
      });
    }).catch(function () {
      mount.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(v.youtube) + '?autoplay=1&rel=0&playsinline=1&modestbranding=1" title="' + esc(day.title) + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
    });
  }
  function markWatched(date) {
    if (!editable(date) || answersFor(date).video === 1) return;
    var caughtUp = setAnswer(date, 'video', 1, undefined, true);
    toast(caughtUp ? 'Video checked off. ' + dayName(date) + ' is all caught up.' : 'Nice — video checked off.');
  }

  /* ============================================================ saving answers */

  /**
   * wasLeft: habits still unanswered before this tap, when the caller already changed some (All on
   * plan). Returns true when this answer finished an earlier day (and says so unless quiet).
   */
  function setAnswer(date, key, val, wasLeft, quiet) {
    if (!editable(date)) return false;
    var before = wasLeft === undefined ? habitsLeft(date) : wasLeft;
    S.pending[date] = S.pending[date] || {};
    S.pending[date][key] = val;
    persistPending();
    S.saveState = 'saving';
    updateChecklistOnly(date);
    // An overdue day just got its last answer.
    var caughtUp = date !== S.me.program.today && before > 0 && habitsLeft(date) === 0;
    if (caughtUp && !quiet) toast(dayName(date) + ' is all caught up.');
    clearTimeout(S.saveTimers[date]);
    S.saveTimers[date] = setTimeout(function () { flushSave(date); }, 650);
    return caughtUp;
  }

  /**
   * Sends one day's unsent answers as a patch (only what changed; null clears). They stay in
   * storage until the server confirms them, so a closed tab or a dropped connection loses nothing.
   */
  function flushSave(date) {
    var pend = S.pending[date];
    if (!pend || !Object.keys(pend).length) return Promise.resolve();
    if (S.inflight[date]) { S.again[date] = true; return Promise.resolve(); }
    if (!S.me || !S.token) return Promise.resolve();
    var session = S.session;
    var sent = clone(pend);
    S.inflight[date] = true;
    S.saveState = 'saving';
    return api('save', { date: date, answers: sent, patch: true }).then(function (r) {
      if (session !== S.session || !S.me) return;
      S.me.history[date] = r.entry;
      S.me.totals = r.totals;
      var left = S.pending[date] || {};
      Object.keys(sent).forEach(function (k) { if (left[k] === sent[k]) delete left[k]; });
      if (!Object.keys(left).length) delete S.pending[date];
      persistPending();
      cacheMe();
      S.retryDelay = 0;
    }, function (e) {
      if (session !== S.session) return;
      if (e.code === 'locked_day' || e.code === 'auth' || e.code === 'inactive') {
        delete S.pending[date];
        persistPending();
        if (e.code === 'locked_day') { toast(e.message, true); loadMe(true); }
      } else {
        S.saveError = e.message;
        scheduleRetry();
      }
    }).catch(function () {}).then(function () {
      if (session !== S.session) return;
      S.inflight[date] = false;
      if (S.again[date]) { S.again[date] = false; flushSave(date); return; }
      var busy = Object.keys(S.inflight).some(function (d) { return S.inflight[d]; });
      S.saveState = busy ? 'saving' : hasPending() ? 'error' : 'saved';
      updateChecklistOnly(date);
    });
  }

  /** Failed saves (no signal, server busy) try again on their own: 5 s, 15 s, 45 s, then every 2 minutes. */
  function scheduleRetry() {
    clearTimeout(S.retryTimer);
    S.retryDelay = Math.min(120000, S.retryDelay ? S.retryDelay * 3 : 5000);
    S.retryTimer = setTimeout(function () { if (S.token && navigator.onLine !== false) flushAllPending(); else scheduleRetry(); }, S.retryDelay);
  }

  function flushAllPending() {
    if (!S.me) return;
    var dropped = 0;
    Object.keys(S.pending || {}).forEach(function (date) {
      var p = S.pending[date];
      if (!p || !Object.keys(p).length) { delete S.pending[date]; return; }
      if (stale()) return; // wait for today's data before deciding anything is locked
      if (!editable(date)) { dropped++; delete S.pending[date]; return; }
      flushSave(date);
    });
    persistPending();
    if (dropped) toast('Some answers for a day that’s now locked couldn’t be saved.', true);
  }

  /* ============================================================ leaderboard */

  /** "Team Iron" for "Iron"; a name that already starts with Team stays as it is. */
  function teamLabel(name) { name = String(name || '').trim(); return /^team\b/i.test(name) ? name : 'Team ' + name; }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  /** Team standings from the server (team averages only), refreshed when the page opens if older than a minute. */
  function loadBoard(force) {
    if (!S.token || !S.me || S.boardLoading) return;
    // At most one automatic try a minute, success or not, so a phone with no signal never loops.
    if (!force && Date.now() - S.boardTriedAt < 60000) return;
    S.boardTriedAt = Date.now();
    S.boardLoading = true;
    var session = S.session;
    api('leaderboard').then(function (r) {
      if (session !== S.session) return;
      S.boardLoading = false;
      S.board = r.board;
      S.myTeam = r.myTeam || '';
      S.boardAt = Date.now();
      S.boardError = '';
      if (route().name === 'leaderboard' || route().name === 'progress') render();
    }, function (e) {
      if (session !== S.session) return;
      S.boardLoading = false;
      S.boardError = e.message;
      if (route().name === 'leaderboard' || route().name === 'progress') render();
    });
  }

  /**
   * Leaderboard (Kevin, 11/10/2026): the team standings first, plus your own few numbers. Nobody
   * sees anyone else's own score: the server only sends team averages, and none at all for a team
   * of fewer than 3 people (their average would be someone's own score).
   */
  function rankTeams(teams, view) {
    var scored = teams.filter(function (x) { return x[view] !== null && x[view] !== undefined; });
    scored.sort(function (x, y) { return (y[view] - x[view]) || x.name.localeCompare(y.name); });
    var rank = 0, prev = null;
    scored.forEach(function (x, i) { if (x[view] !== prev) { rank = i + 1; prev = x[view]; } x.rank = rank; });
    var small = teams.filter(function (x) { return scored.indexOf(x) < 0; }).sort(function (x, y) { return x.name.localeCompare(y.name); });
    small.forEach(function (x) { x.rank = 0; });
    return { scored: scored, small: small };
  }

  function viewLeaderboard() {
    var p = S.me.program, person = S.me.person, t = totals(), b = S.board;
    var weeks = Math.ceil(p.length / 7);
    var started = p.phase !== 'before';
    var sub = !started ? 'Starts ' + fmtLong(p.start) : p.phase === 'after' ? 'Final standings' : 'Week ' + Math.min(Math.ceil(p.dayNumber / 7), weeks) + ' of ' + weeks;
    var canWeek = !!(b && b.week);
    var view = canWeek && S.boardView === 'week' ? 'week' : 'overall';
    var copy = function () { return b ? b.teams.map(function (x) { return Object.assign({}, x); }) : []; };
    var shownRows = rankTeams(copy(), view);
    // Your place is always the overall one, whichever view the list is on.
    var overall = rankTeams(copy(), 'overall');
    var myKey = S.myTeam || String(person.team || '').trim().replace(/^team\s+/i, '').toLowerCase();
    var mineOverall = overall.scored.concat(overall.small).filter(function (x) { return x.key === myKey; })[0] || null;
    // Before Day 1, or before anyone has a point, there's nothing to rank yet.
    var ranked = started && overall.scored.some(function (x) { return x.overall > 0; });
    var place = ranked && mineOverall && mineOverall.rank ? mineOverall.rank : 0;

    // You: your team and overall place, then four plain numbers.
    var teamName = mineOverall ? mineOverall.name : person.team;
    var teamLine = person.team ? teamLabel(teamName) + (place ? ' · ' + ordinal(place) + ' of ' + plural(overall.scored.length, 'team') : '') : (started ? 'Not on a team yet' : 'Teams are announced before Day 1');
    var soFar = Math.min(p.length, p.phase === 'after' ? p.length : Math.max(1, p.dayNumber));
    var stats = started
      ? '<div class="lb-stats">' +
          '<div><b>' + esc(fmtPts(t.points)) + '</b><span>points</span></div>' +
          '<div><b>' + esc(fmtScore(t.average)) + '<small>/10</small></b><span>daily average</span></div>' +
          '<div><b>' + t.days + '<small>/' + soFar + '</small></b><span>days logged</span></div>' +
          '<div><b>' + t.streak + '</b><span>day streak</span></div>' +
        '</div>'
      : '<p class="lb-later">Your points, daily average and streak start counting on Day 1, ' + esc(fmtLong(p.start)) + '.</p>';
    var you = '<section class="card lb-you">' +
      '<div class="lb-you-top"><span class="avatar">' + esc(initials(person)) + '</span><span class="lb-you-name"><b>' + esc(person.first + ' ' + person.last) + '</b><span>' + esc(teamLine) + '</span></span>' +
        (place ? '<span class="lb-place' + (place === 1 ? ' is-first' : '') + '" aria-hidden="true">' + ordinal(place) + '</span>' : '') + '</div>' + stats + '</section>';

    // Team standings.
    var all = shownRows.scored.concat(shownRows.small);
    var mineKey = mineOverall ? mineOverall.key : '';
    var min = (b && b.minPeople) || 3;
    var body;
    if (!b && S.boardError) {
      body = '<div class="lb-empty"><p>' + esc(S.boardError) + '</p><button class="btn btn-secondary btn-sm" data-act="board-retry">Try again</button></div>';
    } else if (!b) {
      body = '<ol class="lb-list" aria-busy="true">' + [1, 2, 3].map(function () { return '<li class="lb-row"><span class="lb-rank"></span><span class="skeleton" style="height:20px"></span><span></span></li>'; }).join('') + '</ol>';
    } else if (!all.length) {
      body = '<div class="lb-empty">' + icon('users', 'ico-lg') + '<p>' + esc(started ? 'Teams aren’t set yet. The standings show up here as soon as they are.' : 'Teams are announced before Day 1. The team standings show up right here.') + '</p></div>';
    } else {
      var row = function (x) {
        var isMine = x.key === mineKey;
        var hasScore = x.rank > 0;
        var score = !hasScore ? '<span class="lb-score is-none"><span>Score shows once the team has ' + min + ' people</span></span>'
          : ranked ? '<span class="lb-score"><b>' + esc(fmtPts(x[view])) + '</b><span>pts per person</span></span>' : '<span class="lb-score"></span>';
        return '<li class="lb-row' + (isMine ? ' is-mine' : '') + (hasScore && ranked ? '' : ' is-unranked') + '"><span class="lb-rank' + (ranked && x.rank && x.rank <= 3 ? ' r' + x.rank : '') + '">' + (ranked && x.rank ? x.rank : '') + '</span>' +
          '<span class="lb-team"><b>' + esc(teamLabel(x.name)) + '</b><span>' + esc(plural(x.people, 'person', 'people')) + (isMine ? ' · your team' : '') + '</span></span>' + score + '</li>';
      };
      body = (ranked ? '' : '<p class="lb-range">' + esc(started ? 'Standings show up once teams start scoring.' : 'Standings start ' + fmtLong(p.start) + '.') + '</p>') +
        '<ol class="lb-list">' + all.map(row).join('') + '</ol>';
    }
    var weekName = p.phase === 'after' ? 'Last week' : 'This week';
    var seg = canWeek && ranked ? '<div class="seg seg-sm" role="group" aria-label="Which standings">' +
      '<button data-act="board-view" data-view="overall" class="' + (view === 'overall' ? 'is-on' : '') + '" aria-pressed="' + (view === 'overall') + '">Overall</button>' +
      '<button data-act="board-view" data-view="week" class="' + (view === 'week' ? 'is-on' : '') + '" aria-pressed="' + (view === 'week') + '">' + weekName + '</button></div>' : '';
    var range = view === 'week' && b && ranked ? '<p class="lb-range">Week ' + b.week + ' · ' + esc(fmt(b.weekFrom, { month: 'short', day: 'numeric' })) + ' – ' + esc(fmt(b.weekTo, { month: 'short', day: 'numeric' })) + '</p>' : '';
    var board = '<section class="card lb-board"><div class="card-head"><h3>Team standings</h3>' + seg + '</div>' + range + body +
      (all.length ? '<p class="lb-foot">A team’s score is its average points per person, so every team has the same shot, whatever its size.</p>' : '') + '</section>';

    return '<h1 class="page-title">Leaderboard</h1><p class="page-sub">' + esc(sub) + '</p>' + you + board;
  }

  /* ============================================================ nutrition */

  function viewNutrition(tab) {
    var s = S.me.person.setup, t = s.track || {};
    var plan = t.nutrition ? s.plan : 'recommended';
    var tabs = [['mine', 'My plan'], ['recommended', 'Recommended'], ['plant', 'Plant Based'], ['other', 'Other plans'], ['cookbook', 'Koda Cookbook'], ['resources', 'More']];
    var head = '<h1 class="page-title">Nutrition</h1><p class="page-sub">Your food rules and resources for all six weeks.</p>' +
      '<div class="tabs-scroll" role="tablist">' + tabs.map(function (x) { return '<a class="tab-chip' + (tab === x[0] ? ' is-on' : '') + '" role="tab" aria-selected="' + (tab === x[0]) + '" href="#/nutrition/' + x[0] + '">' + x[1] + '</a>'; }).join('') + '</div>';
    var body;
    if (tab === 'recommended') body = guideHtml('recommended');
    else if (tab === 'plant') body = guideHtml('plant');
    else if (tab === 'other') body = otherPlansHtml();
    else if (tab === 'resources') body = resourcesHtml();
    else if (tab === 'cookbook') body = cookbookHtml();
    else {
      var info = planInfo(plan) || {};
      var label = plan === 'other' && s.planOther ? s.planOther : info.label;
      var heroCard = '<section class="card card-pad"><div class="plan-hero"><span class="icon-tile">' + icon(info.icon || 'plate', 'ico-lg') + '</span><span><span class="kicker">' + (t.nutrition ? 'Your plan' : 'You’re not tracking nutrition') + '</span><span style="display:block;font-size:20px;font-weight:800;letter-spacing:-0.015em">' + esc(label) + '</span><span class="muted" style="font-size:14px">' + esc(t.nutrition ? info.blurb : 'Here’s our recommended plan if you want it. You can add nutrition to your checklist on the Profile tab.') + '</span></span></div>' +
        (plan === 'macros' && s.macros ? macrosLine(s.macros) : '') + '</section>';
      if (plan === 'recommended' || plan === 'plant') body = heroCard + searchHtml(plan) + guideHtml(plan, true);
      else body = heroCard + '<section class="card card-pad prose" style="margin-top:16px">' + C.otherPlans[plan].body.map(function (x) { return '<p>' + x + '</p>'; }).join('') + '</section>' + avoidHtml() + searchHtml('recommended', true);
    }
    return head + body;
  }

  function macrosLine(m) {
    var parts = [['Protein', m.protein, 'g'], ['Carbs', m.carbs, 'g'], ['Fat', m.fat, 'g'], ['Calories', m.calories, '']].filter(function (x) { return x[1]; });
    if (!parts.length) return '<p class="muted" style="margin:14px 0 0;font-size:14px">' + (m.wantHelp ? 'You asked for help setting your macros — your coach will reach out.' : 'Add your targets on the Profile tab.') + '</p>';
    return '<div class="stats" style="margin-top:16px">' + parts.map(function (x) { return '<div class="card stat" style="box-shadow:none"><div class="k">' + x[0] + '</div><div class="v">' + esc(x[1]) + '<small>' + x[2] + '</small></div></div>'; }).join('') + '</div>';
  }

  function guideHtml(id, skipIntro) {
    var g = C.guides[id];
    var cat = function (c, kind) {
      return '<div class="food-cat ' + kind + '"><h4 class="' + (kind === 'yes' ? 'yes-head' : kind === 'no' ? 'no-head' : '') + '">' + icon(kind === 'yes' ? 'check' : kind === 'no' ? 'x' : 'info', 'ico-sm') + esc(c.cat) + '</h4><ul>' + c.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' + (c.fine ? '<div class="fine">' + esc(c.fine) + '</div>' : '') + '</div>';
    };
    return (skipIntro ? '' : '<section class="card card-pad"><div class="kicker">Food guide</div><h2 style="margin:4px 0 6px;font-size:21px">' + esc(g.title) + '</h2><p class="muted" style="margin:0">' + esc(g.intro) + '</p></section>' + searchHtml(id)) +
      '<section class="section" style="margin-top:18px"><h3 style="margin:0 0 10px;display:flex;align-items:center;gap:8px" class="yes-head">' + icon('check') + 'Approved</h3><div class="food-grid">' + g.approved.map(function (c) { return cat(c, 'yes'); }).join('') + '</div></section>' +
      (g.moderation ? '<section class="section" style="margin-top:18px"><div class="food-grid">' + g.moderation.map(function (c) { return cat(c, 'mod'); }).join('') + '</div></section>' : '') +
      '<section class="section" style="margin-top:18px"><h3 style="margin:0 0 10px;display:flex;align-items:center;gap:8px" class="no-head">' + icon('x') + 'Not approved</h3><div class="food-grid">' + g.unapproved.map(function (c) { return cat(c, 'no'); }).join('') + '</div></section>' + avoidHtml();
  }

  function avoidHtml() {
    return '<section class="section" style="margin-top:18px"><h3 style="margin:0 0 10px">Avoid on every plan</h3><div class="avoid">' + C.avoidAll.map(function (a) {
      return '<div class="avoid-item">' + icon('x') + '<span><b>' + esc(a.title) + '</b><span>' + esc(a.text) + '</span></span></div>';
    }).join('') + '</div></section>';
  }

  function searchHtml(planId, asReference) {
    return '<section class="card card-pad" style="margin-top:16px"><label class="search-box"><span class="sr-only">Search foods</span>' + icon('search') + '<input class="input" type="search" data-search="' + planId + '" placeholder="Can I eat…? Try “oatmeal”" value="' + esc(S.nutritionQuery) + '" autocomplete="off"></label>' +
      (asReference ? '<p class="subtle" style="font-size:13px;margin:8px 0 0">Searches the Recommended Plan list.</p>' : '') + '<div class="results" id="searchResults">' + searchResults(planId, S.nutritionQuery) + '</div></section>';
  }

  function searchResults(planId, q) {
    q = String(q || '').trim().toLowerCase();
    if (q.length < 2) return '';
    var g = C.guides[planId] || C.guides.recommended, out = [];
    var scan = function (list, kind) {
      (list || []).forEach(function (c) { c.items.forEach(function (i) { if (i.toLowerCase().indexOf(q) >= 0) out.push({ item: i, cat: c.cat, kind: kind }); }); });
    };
    scan(g.approved, 'yes'); scan(g.moderation, 'mod'); scan(g.unapproved, 'no');
    C.avoidAll.forEach(function (a) { if (a.title.toLowerCase().indexOf(q) >= 0 || a.text.toLowerCase().indexOf(q) >= 0) out.push({ item: a.title, cat: 'Every plan', kind: 'no' }); });
    if (!out.length) return '<div class="result">' + icon('info', 'ico-sm') + '<span>Not on the list. Stick to whole, unprocessed foods, and ask your coach if you’re unsure.</span></div>';
    return out.slice(0, 8).map(function (r) {
      return '<div class="result">' + icon(r.kind === 'yes' ? 'check' : r.kind === 'no' ? 'x' : 'info', 'ico-sm') + '<span><b>' + esc(r.item) + '</b> <span class="subtle">· ' + esc(r.cat) + '</span></span><span class="badge ' + (r.kind === 'yes' ? 'badge-good' : r.kind === 'mod' ? 'badge-warn' : '') + '" ' + (r.kind === 'no' ? 'style="background:var(--bad-bg);color:var(--bad)"' : '') + '>' + (r.kind === 'yes' ? 'Approved' : r.kind === 'mod' ? 'In moderation' : 'Not approved') + '</span></div>';
    }).join('');
  }

  function otherPlansHtml() {
    return ['macros', 'whole30', 'carnivore', 'other'].map(function (id) {
      var x = C.otherPlans[id], info = planInfo(id) || {};
      return '<section class="card card-pad prose" style="margin-top:16px"><div class="plan-hero" style="margin-bottom:12px"><span class="icon-tile">' + icon(info.icon || 'plate', 'ico-lg') + '</span><span><span style="display:block;font-size:19px;font-weight:800">' + esc(x.title) + '</span><span class="muted" style="font-size:14px">' + esc(info.blurb || '') + '</span></span></div>' +
        x.body.map(function (b) { return '<p>' + b + '</p>'; }).join('') + '</section>';
    }).join('') + avoidHtml();
  }

  function resourcesHtml() {
    var c = S.config;
    return '<a class="card list-row" style="border-radius:var(--radius-lg)" href="#/nutrition/cookbook"><span class="avatar silver">' + icon('book') + '</span><span class="grow"><span class="title">Koda Cookbook</span><span class="meta" style="display:block">Recipes from the Koda community, right here in the app.</span></span>' + icon('chevR') + '</a>' +
      '<section class="card card-pad prose" style="margin-top:16px"><div class="plan-hero" style="margin-bottom:12px"><span class="icon-tile">' + icon('scale', 'ico-lg') + '</span><span><span style="display:block;font-size:19px;font-weight:800">InBody scan</span><span class="muted" style="font-size:14px">Optional, at the start and end of the challenge</span></span></div>' +
        '<p><b>Before your scan:</b></p><ul><li>No eating or exercise for 3 hours before.</li><li>Be hydrated (water alongside any coffee).</li><li>No alcohol or flying the night before.</li><li>Light clothes, with arms and thighs not touching.</li><li>Not for anyone with a pacemaker or who is pregnant.</li></ul>' +
        '<p><b>Taking it:</b> download the InBody app, connect to the scanner over Bluetooth, enter your height, stand barefoot with heels on the back edge, and hold the handles out at about 45°.</p></section>' +
      '<section class="card card-pad" style="margin-top:16px"><b>Questions about your plan?</b><p class="muted" style="margin:4px 0 12px;font-size:14px">Your coach is here to help. You can also email us.</p><a class="btn btn-secondary btn-sm" href="mailto:' + esc(c.contactEmail) + '">' + icon('mail', 'ico-sm') + esc(c.contactEmail) + '</a></section>';
  }

  /* ============================================================ Koda Cookbook */

  /** The 2026 Koda Resolutions Cookbook (content/cookbook.json, built from the PDF), loaded the first time its tab opens. */
  function loadCookbook(force) {
    if (S.cookbook || S.cookbookLoading || (!force && S.cookbookError)) return;
    S.cookbookLoading = true;
    var onTab = function () { var r = route(); return r.name === 'nutrition' && r.args[0] === 'cookbook'; };
    fetch('content/cookbook.json?v=' + APP_VERSION).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      S.cookbookLoading = false;
      S.cookbook = data;
      S.cookbookError = '';
      if (onTab()) render();
    }, function () {
      S.cookbookLoading = false;
      S.cookbookError = 'The cookbook didn’t load. Check your connection and try again.';
      if (onTab()) render();
    });
  }

  /**
   * Kevin, 11/10: the PDF's sections as dropdowns with the same titles; each opens to its recipes,
   * and each recipe opens to its ingredients, directions and the rest, just as the PDF has them.
   */
  function cookbookHtml() {
    var cb = S.cookbook;
    if (!cb) {
      return S.cookbookError
        ? '<div class="card lb-empty"><p>' + esc(S.cookbookError) + '</p><button class="btn btn-secondary btn-sm" data-act="cookbook-retry">Try again</button></div>'
        : '<section class="cb-hero" aria-busy="true"><div class="cb-kicker">Koda Resolutions</div><div class="cb-title">Cookbook</div><p class="cb-tag">Loading the recipes…</p></section>';
    }
    return '<section class="cb-hero">' + kx('watermark') +
        '<div class="cb-kicker">Koda Resolutions</div><div class="cb-title">Cookbook</div>' +
        (cb.tagline ? '<p class="cb-tag">' + esc(cb.tagline) + '</p>' : '') +
        '<div class="cb-meta"><span>' + esc(plural(cb.count, 'recipe')) + '</span><span>' + esc(plural(cb.sections.length, 'section')) + '</span>' + (cb.edition ? '<span>' + esc(cb.edition) + '</span>' : '') + '</div>' +
        '<label class="cb-search"><span class="sr-only">Search the cookbook</span>' + icon('search') + '<input type="search" data-cbsearch placeholder="Search recipes or ingredients" value="' + esc(S.cookbookQuery) + '" autocomplete="off" enterkeyhint="search"></label>' +
      '</section>' + cookbookListHtml();
  }

  function cookbookListHtml() {
    var cb = S.cookbook, q = S.cookbookQuery.trim().toLowerCase(), shown = 0;
    var sections = cb.sections.map(function (s) {
      var recipes = q ? s.recipes.filter(function (r) { return recipeMatches(r, q); }) : s.recipes;
      if (q && !recipes.length) return '';
      shown += recipes.length;
      return '<details class="acc-item cb-sec" id="cb-' + esc(s.id) + '"' + (q ? ' open' : '') + '><summary><span class="cb-sec-name"><b>' + esc(s.title) + '</b><span>' + esc(plural(recipes.length, 'recipe')) + (q ? ' found' : '') + '</span></span>' + icon('chevR', 'ico-sm acc-chev') + '</summary>' +
        '<div class="cb-sec-body">' + (s.intro && !q ? '<p class="cb-intro">' + esc(s.intro) + '</p>' : '') +
          recipes.map(function (r) { return recipeHtml(r, q); }).join('') + '</div></details>';
    }).join('');
    var none = '<div class="lb-empty"><p>No recipe has “' + esc(S.cookbookQuery.trim()) + '” in it. Try another word.</p></div>';
    return '<section class="card acc cb-list" id="cbList" aria-live="polite">' + (q && !shown ? none : sections) + '</section>';
  }

  /** A search word anywhere in the title, a tag, an ingredient, a step or a note. */
  function recipeMatches(r, q) {
    var texts = [r.title].concat(r.tags || []);
    (r.blocks || []).forEach(function (b) { (b.lines || []).forEach(function (l) { texts.push(l.text); }); });
    return texts.some(function (t) { return String(t).toLowerCase().indexOf(q) >= 0; });
  }

  /** A recipe's lines, as the PDF has them: bullets as a list, numbered steps as a numbered list, the rest as paragraphs. */
  function cookbookLines(lines) {
    var html = '', i = 0;
    while (i < lines.length) {
      var t = lines[i].t;
      if (t === 'li' || t === 'step') {
        var items = '', num = 0;
        while (i < lines.length && lines[i].t === t) {
          num = Number(lines[i].n) || num + 1; // the PDF's own step numbers; count on if one is missing
          items += '<li' + (t === 'step' ? ' value="' + num + '"' : '') + '>' + esc(lines[i].text) + '</li>';
          i++;
        }
        html += t === 'li' ? '<ul class="cb-ul">' + items + '</ul>' : '<ol class="cb-ol">' + items + '</ol>';
      } else {
        html += '<p>' + esc(lines[i].text) + '</p>';
        i++;
      }
    }
    return html;
  }

  function recipeHtml(r, q) {
    var credit = '';
    var body = (r.blocks || []).map(function (b) {
      if (/^credits?$/i.test(String(b.heading).trim())) { credit = b.lines.map(function (l) { return l.text; }).join(', '); return ''; }
      return '<div class="cb-block">' + (b.heading ? '<h4>' + esc(b.heading) + '</h4>' : '') + cookbookLines(b.lines || []) + '</div>';
    }).join('');
    var tags = (r.tags || []).length ? '<span class="cb-tags">' + r.tags.map(function (t) { return '<span class="cb-tag-chip">' + esc(t) + '</span>'; }).join('') + '</span>' : '';
    return '<details class="cb-recipe" id="r-' + esc(r.id) + '"><summary><span class="cb-num">' + esc(r.n) + '</span><span class="cb-rt"><b>' + esc(r.title) + '</b>' + tags + '</span>' + icon('chevR', 'ico-sm acc-chev') + '</summary>' +
      '<div class="cb-body">' + body + (credit ? '<p class="cb-credit">Recipe from ' + esc(credit) + '</p>' : '') + '</div></details>';
  }

  /* ============================================================ videos */

  function viewVideos() {
    var p = S.me.program, weeks = {};
    S.me.days.forEach(function (d) { (weeks[d.week] = weeks[d.week] || []).push(d); });
    var watchedCount = S.me.days.filter(function (d) { return d.released && answersFor(d.date).video === 1; }).length;
    var released = S.me.days.filter(function (d) { return d.released; }).length;
    var html = '<h1 class="page-title">Videos</h1><p class="page-sub">' + (p.phase === 'before' ? 'A new video unlocks every day starting ' + esc(fmtLong(p.start)) + '.' : 'Watched ' + watchedCount + ' of ' + released + ' so far. Missed one? Watch it here any time.') + '</p>';
    Object.keys(weeks).sort(function (a, b) { return a - b; }).forEach(function (w) {
      var list = weeks[w];
      var theme = list[0].theme;
      html += '<section class="card" style="margin-top:16px"><div class="card-head"><h3>Week ' + w + (theme ? ' · ' + esc(theme) : '') + '</h3><span class="subtle" style="font-size:13px">' + esc(fmt(list[0].date, { month: 'short', day: 'numeric' })) + ' – ' + esc(fmt(list[list.length - 1].date, { month: 'short', day: 'numeric' })) + '</span></div><div style="padding-top:8px">' +
        list.map(function (d) {
          if (!d.released) {
            return '<div class="vrow locked"><span class="thumb"><svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + I.lock + '</svg></span><span><span class="t">' + esc(d.title || 'Day ' + d.n) + '</span><span class="m" style="display:block">Day ' + d.n + ' · unlocks ' + esc(fmt(d.date)) + '</span></span><span></span></div>';
          }
          var v = (d.videos || [])[0];
          var thumb = v && v.youtube ? ' style="background-image:url(https://i.ytimg.com/vi/' + esc(v.youtube) + '/mqdefault.jpg)"' : '';
          var watched = answersFor(d.date).video === 1;
          return '<a class="vrow" href="#/day/' + d.date + '"><span class="thumb"' + thumb + '>' + (v && v.youtube ? '' : kx()) + '</span><span><span class="t">' + esc(d.title || 'Day ' + d.n) + '</span><span class="m" style="display:block">Day ' + d.n + ' · ' + esc(fmt(d.date)) + (d.category ? ' · ' + esc(d.category) : '') + (v && v.standIn ? ' · 2026 stand-in' : '') + '</span></span><span class="watched' + (watched ? '' : ' not') + '" aria-label="' + (watched ? 'Watched' : 'Not watched yet') + '">' + icon(watched ? 'check' : 'play', 'ico-sm') + '</span></a>';
        }).join('') + '</div></section>';
    });
    return html;
  }

  /* ============================================================ profile & edits */

  function viewProfile() {
    var p = S.me.person, s = p.setup, c = S.config;
    var checklist = checklistPreviewText(draftFromPerson()).slice(1).map(function (x) { return x.replace(/^Nutrition: .*/, 'Nutrition').replace(/^Skill: /, '').replace(/^Mobility: /, ''); });
    var plan = s.track && s.track.nutrition ? (s.plan === 'other' ? 'Other: ' + s.planOther : (planInfo(s.plan) || {}).label) : 'Not tracking nutrition';
    var row = function (ic, label, value, href) {
      return '<a class="list-row" href="' + href + '"><span class="ci-icon">' + icon(ic) + '</span><span class="grow"><span class="meta">' + esc(label) + '</span><span class="title" style="display:block">' + value + '</span></span>' + icon('chevR') + '</a>';
    };
    var payment = p.type === 'Remote' ? '<section class="card" style="margin-top:16px"><div class="card-head"><h3>Payment</h3><span class="badge ' + (p.paid ? 'badge-good' : 'badge-warn') + '">' + (p.paid ? 'Received' : 'Pending') + '</span></div><div class="card-body"><p class="muted" style="margin:0;font-size:14px">' +
      esc(p.paid ? 'Thanks! Your $' + c.remotePrice + ' remote spot is paid.' : 'Send $' + c.remotePrice + ' ' + (p.payment === 'Venmo' ? 'on Venmo to ' + c.venmo : p.payment === 'Zelle' ? 'with Zelle to ' + c.zelle : 'by card') + (p.payment === 'Credit Card' ? '' : ' with your name in the note') + '. We’ll mark it here when it comes in.') + '</p>' +
      (p.paid ? '' : (function () { var b = payButtons(p, true); return b ? '<div style="margin-top:12px">' + b + '</div>' : ''; })()) + '</div></section>' : '';
    var shirtLocked = !!(c.shirtChangesUntil && localToday() > c.shirtChangesUntil);
    return '<h1 class="page-title">Profile</h1><p class="page-sub">Your challenge setup. Change anything, any time.</p>' +
      '<section class="card card-pad" style="display:flex;gap:16px;align-items:center"><span class="avatar avatar-lg">' + esc(initials(p)) + '</span><span style="min-width:0"><b style="font-size:19px;display:block">' + esc(p.first + ' ' + p.last) + '</b><span class="muted" style="font-size:14px;overflow-wrap:anywhere">' + esc(p.email) + '</span>' +
        '<span class="chips" style="margin-top:8px"><span class="badge">' + (p.type === 'Remote' ? 'Remote participant' : p.type === 'Test' ? (S.me.program.beta ? 'Beta tester' : 'Test account') : 'Koda member') + '</span>' + (p.team ? '<span class="badge badge-brand">' + esc(teamLabel(p.team)) + '</span>' : '') + (p.coach ? '<span class="badge badge-silver">Coach ' + esc(p.coach) + '</span>' : '') + '</span></span></section>' +
      '<section class="card" style="margin-top:16px"><div class="card-head"><h3>My challenge</h3></div><div style="padding-top:8px">' +
        row('target', 'Main focus', esc(goalLabel(s.goal)), '#/edit/goal') +
        row('plate', 'Nutrition plan', esc(plan), '#/edit/track') +
        row('check', 'Daily checklist', esc(checklist.join(' · ') || 'Video only'), '#/edit/track') +
        row('users', 'Coach preference', esc((s.coaches || []).join(', ') || 'No preference'), '#/edit/coaches') +
        (shirtLocked
          ? '<div class="list-row"><span class="ci-icon">' + icon('shirt') + '</span><span class="grow"><span class="meta">Shirt · ordered</span><span class="title" style="display:block">' + esc((p.shirt === 'tank' ? 'Ladies Tank' : 'T-Shirt') + ' · ' + p.size) + '</span><span class="meta" style="display:block">Need a swap? Email us.</span></span></div>'
          : row('shirt', 'Shirt', esc((p.shirt === 'tank' ? 'Ladies Tank' : 'T-Shirt') + ' · ' + p.size), '#/edit/shirt')) +
      '</div></section>' + payment +
      '<section class="card" style="margin-top:16px"><div class="card-head"><h3>Help</h3></div><div style="padding-top:8px">' +
        '<a class="list-row" href="#/faqs"><span class="ci-icon">' + icon('help') + '</span><span class="grow"><span class="title">FAQs</span><span class="meta" style="display:block">Answers to common questions</span></span>' + icon('chevR') + '</a>' +
        '<a class="list-row" href="mailto:' + esc(c.contactEmail) + '"><span class="ci-icon">' + icon('mail') + '</span><span class="grow"><span class="title">Email us</span><span class="meta" style="display:block">' + esc(c.contactEmail) + '</span></span>' + icon('external') + '</a></div></section>' +
      '<section class="card" style="margin-top:16px"><div class="card-head"><h3>Account</h3></div><div style="padding-top:8px">' +
        '<a class="list-row" href="#/edit/password"><span class="ci-icon">' + icon('key') + '</span><span class="grow"><span class="title">Change password</span></span>' + icon('chevR') + '</a>' +
        '<button class="list-row" data-act="signout"><span class="ci-icon">' + icon('logout') + '</span><span class="grow"><span class="title">Sign out</span><span class="meta" style="display:block">On this device</span></span></button>' +
        '<button class="list-row" data-act="signout-all"><span class="ci-icon">' + icon('logout') + '</span><span class="grow"><span class="title">Sign out everywhere</span><span class="meta" style="display:block">Every phone and computer</span></span></button>' +
      '</div></section><p class="center subtle" style="font-size:12px;margin-top:20px">Koda Resolutions 2027 · v' + APP_VERSION + '</p>';
  }

  /**
   * FAQs (its own sidebar item since 11/11; on phones it's under Profile): the questions, then
   * "Ask a question": a box whose text is emailed to the person's coach (or the gym until they
   * have one), who replies to them by email.
   */
  function viewFaqs() {
    var p = S.me.program;
    var tally = fmt(addDays(p.start, 1), { weekday: 'long' });
    var items = C.faq.map(function (f, i) {
      var a = f.a.replace(/\{openDay\}/g, openDayName()).replace(/\{tallyDay\}/g, tally);
      return '<details class="acc-item faq-item" id="faq-' + i + '"><summary><span>' + esc(f.q) + '</span>' + icon('chevR', 'ico-sm acc-chev') + '</summary><p>' + esc(a) + '</p></details>';
    }).join('');
    return '<a class="btn btn-ghost btn-sm phone-only" href="#/profile" style="margin:-4px 0 10px -8px">' + icon('chevL', 'ico-sm') + 'Profile</a>' +
      '<h1 class="page-title">FAQs</h1><p class="page-sub">Quick answers about the challenge and the app.</p>' +
      '<section class="card acc">' + items + '</section>' + askCard();
  }

  /**
   * The Ask a question box. The text stays in memory while typing, so a background refresh never
   * loses it. It names the coach only when the server knows the coach's address (askToCoach is a
   * yes/no; the address itself never reaches the app).
   */
  function askCard() {
    var person = S.me.person, coach = String(person.coach || '').trim(), toCoach = !!(coach && person.askToCoach);
    var where = toCoach ? 'It goes straight to your coach, ' + coach + ', by email.'
      : coach ? 'It goes to the Koda team by email, and they’ll pass it to ' + coach + '.'
      : 'It goes straight to the Koda team by email (you’ll get a coach soon).';
    var done = S.askSent;
    var sent = done ? '<div class="callout ' + (done.sent ? 'callout-good' : 'callout-info') + ' ask-sent" role="status">' + icon(done.sent ? 'check' : 'info') + '<span><b style="color:inherit">' +
      esc(done.sent ? (done.coach ? 'Sent to ' + done.coach + '.' : 'Sent to the Koda team.') : 'Saved.') + '</b> ' +
      esc(done.sent ? 'You’ll get the answer by email at ' + person.email + '.' : 'It didn’t email right away, but the Koda team will see it and get back to you by email.') + '</span></div>' : '';
    var left = 2000 - S.askText.length;
    return '<section class="card card-pad ask-card" style="margin-top:16px"><h3 style="margin:0 0 4px">Ask a question</h3>' +
      '<p class="muted" style="margin:0 0 12px;font-size:14px">' + esc(where) + ' They’ll reply to ' + esc(person.email) + '.</p>' + sent +
      '<label class="sr-only" for="askBox">Your question</label>' +
      '<textarea id="askBox" class="input ask-box" data-ask rows="4" maxlength="2000" placeholder="Type your question here…"' + (S.askBusy ? ' disabled' : '') + '>' + esc(S.askText) + '</textarea>' +
      (S.askError ? '<span class="error" role="alert">' + esc(S.askError) + '</span>' : '') +
      '<div class="ask-foot"><span class="ask-count' + (left < 100 ? ' is-low' : '') + '" aria-live="polite">' + (left < 300 ? left + ' characters left' : '') + '</span>' +
        '<button class="btn btn-primary btn-sm" data-act="ask-send"' + (S.askBusy || S.askText.trim().length < 3 ? ' disabled' : '') + '>' + (S.askBusy ? '<span class="spinner"></span>' : icon('mail', 'ico-sm') + 'Send' + (toCoach ? ' to ' + esc(coach) : '')) + '</button></div>' +
    '</section>';
  }

  function sendQuestion() {
    var q = S.askText.trim();
    if (q.length < 3 || S.askBusy) return;
    S.askBusy = true; S.askError = ''; S.askSent = null;
    render();
    var session = S.session;
    api('ask', { question: q }).then(function (r) {
      if (session !== S.session) return;
      S.askBusy = false;
      S.askText = '';
      S.askSent = { coach: r.coach || '', sent: !!r.sent };
      render();
      toast(!r.sent ? 'Saved. The Koda team will get back to you.' : r.coach ? 'Sent to ' + r.coach + '.' : 'Sent to the Koda team.');
    }, function (e) {
      if (session !== S.session) return;
      S.askBusy = false;
      S.askError = e.message;
      render();
    });
  }

  function draftFromPerson() {
    var p = S.me.person, s = p.setup || {};
    var d = newDraft();
    d.goal = s.goal || '';
    d.track = {};
    C.tracking.forEach(function (x) { d.track[x.id] = !!(s.track && s.track[x.id]); });
    d.plan = s.plan || '';
    d.planOther = s.planOther || '';
    if (s.macros) d.macros = { protein: s.macros.protein || '', carbs: s.macros.carbs || '', fat: s.macros.fat || '', calories: s.macros.calories || '', wantHelp: !!s.macros.wantHelp };
    d.sleepHours = Math.max(7, s.sleepHours || 7);
    d.proteinG = s.proteinG || '';
    d.hydrationOz = s.hydrationOz || '';
    d.hydrationMode = s.hydrationOz ? 'custom' : 'weight';
    d.finishersPerWeek = Math.min(3, s.finishersPerWeek || 2);
    d.skill = s.skill || '';
    d.mobility = s.mobility || '';
    d.other = s.other && s.other.length ? [s.other[0]] : [''];
    d.coaches = (s.coaches || []).slice();
    d.shirt = p.shirt;
    d.size = p.size;
    return d;
  }

  function viewEdit(section) {
    if (!S.edit || S.edit.section !== section) { S.edit = { section: section, d: draftFromPerson() }; S.errors = {}; S.formError = ''; }
    var d = S.edit.d, body;
    if (section === 'goal') body = stepGoal(d, 'Your main focus', 'Your coaching tips follow it.');
    else if (section === 'coaches') body = stepCoaches(d, true);
    else if (section === 'shirt') body = '<h1>Your shirt</h1><p class="lead">Change your style or size.</p>' + shirtFields(d);
    else if (section === 'password') {
      body = '<h1>Change password</h1><p class="lead">You’ll stay signed in here. Other devices will need the new password.</p>' +
        '<label class="field"><span class="label">Current password</span><input class="input" type="password" data-field="pwCurrent" autocomplete="current-password" data-autofocus></label>' +
        '<label class="field"><span class="label">New password</span><span class="input-wrap"><input class="input" type="password" data-field="pwNew" autocomplete="new-password"><button class="icon-btn reveal" type="button" data-act="reveal" aria-label="Show password">' + icon('eye') + '</button></span><span class="hint">At least 6 characters.</span></label>';
    } else {
      section = 'track';
      body = stepTrack(d, true) + (needsDetails(d) ? '<div style="height:18px"></div>' + stepDetails(d, true) : '') +
        (S.me.program.phase === 'during' ? '<p class="muted" style="font-size:13.5px;margin-top:16px">Changes apply to today and every day after. Days you already finished keep their own list.</p>' : '');
    }
    var foot = '<button class="btn btn-secondary" data-act="cancel-edit">Cancel</button><button class="btn btn-primary" data-act="save-edit" data-section="' + section + '"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? '<span class="spinner"></span>' : 'Save') + '</button>';
    return flowFrame({ steps: [], step: '', body: body, foot: foot, backAct: 'cancel-edit' });
  }

  function saveEdit(section) {
    var d = S.edit.d;
    S.formError = '';
    if (section === 'password') {
      var cur = S.edit.pwCurrent || '', next = S.edit.pwNew || '';
      if (!cur) { S.formError = 'Enter your current password. Forgot it? Sign out and use Forgot password.'; render(); return; }
      if (next.length < 6) { S.formError = 'Your new password needs at least 6 characters.'; render(); return; }
      S.busy = true; render();
      api('password', { current: cur, password: next }).then(function (r) {
        S.busy = false; S.token = r.token; store.set('res27.token', r.token); cacheMe(); S.edit = null;
        toast('Password changed.'); go('#/profile');
      }, function (e) { S.busy = false; S.formError = e.message; render(); });
      return;
    }
    S.errors = validateStep(section === 'track' ? 'track' : section, d, true);
    if (section === 'goal' && !d.goal) S.errors.goal = 'Pick one.';
    if (Object.keys(S.errors).length) {
      render();
      // The problem can be far down the page (e.g. a new protein goal): bring it into view.
      var first = app.querySelector('.track.is-missing, .is-invalid, .error');
      if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    var body = { setup: setupFromDraft(d) };
    if (section === 'shirt') { body.shirt = d.shirt; body.size = d.size; }
    S.busy = true; render();
    api('setup', body).then(function (r) {
      S.busy = false; S.edit = null; applyMe(r.me);
      toast('Saved.'); go('#/profile');
    }, function (e) { S.busy = false; S.formError = e.message; render(); window.scrollTo(0, 0); });
  }

  /* ============================================================ toast & sheet */

  var toastTimer = null;
  function toastHtml() { return ''; }
  function toastWrap() {
    var wrap = document.getElementById('toastWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      wrap.id = 'toastWrap';
      wrap.setAttribute('role', 'status');
      wrap.setAttribute('aria-live', 'polite');
      document.body.appendChild(wrap);
    }
    return wrap;
  }
  function toast(msg, isError) {
    var wrap = toastWrap();
    wrap.innerHTML = '<div class="toast' + (isError ? ' is-error' : '') + '">' + icon(isError ? 'info' : 'check', 'ico-sm') + '<span>' + esc(msg) + '</span></div>';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { wrap.innerHTML = ''; }, isError ? 5200 : 2800);
  }
  function openSheet(html) {
    closeSheet(true);
    var el = document.createElement('div');
    el.className = 'sheet-backdrop';
    el.id = 'sheet';
    el.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + html + '</div>';
    el.addEventListener('click', function (e) { if (e.target === el) closeSheet(); });
    document.body.appendChild(el);
  }
  function closeSheet(keepState) {
    var el = document.getElementById('sheet');
    if (el) el.remove();
    if (!keepState) S.sheet = null;
  }

  /* ============================================================ events */

  function setDraftField(d, field, value) {
    if (field.indexOf('macros.') === 0) { d.macros[field.slice(7)] = value; return; }
    if (field.indexOf('other.') === 0) { d.other[Number(field.slice(6))] = value; return; }
    d[field] = value;
  }

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset && el.dataset.ask !== undefined) {
      // Ask a question: keep the text, and update just the counter and the Send button (no repaint while typing).
      S.askText = el.value.slice(0, 2000);
      if (S.askError) { S.askError = ''; var err = el.parentNode.querySelector('.error'); if (err) err.remove(); }
      var card = el.closest('.ask-card');
      var btn = card && card.querySelector('[data-act="ask-send"]');
      if (btn && !S.askBusy) btn.disabled = S.askText.trim().length < 3;
      var count = card && card.querySelector('.ask-count');
      var left = 2000 - S.askText.length;
      if (count) { count.textContent = left < 300 ? left + ' characters left' : ''; count.classList.toggle('is-low', left < 100); }
      return;
    }
    if (el.dataset && el.dataset.cbsearch !== undefined) {
      // Cookbook search: repaint just the list, so the box keeps focus and the keyboard stays up.
      S.cookbookQuery = el.value;
      var list = document.getElementById('cbList');
      if (list && S.cookbook) list.outerHTML = cookbookListHtml();
      return;
    }
    if (el.dataset && el.dataset.search !== undefined) {
      S.nutritionQuery = el.value;
      var box = document.getElementById('searchResults');
      if (box) box.innerHTML = searchResults(el.dataset.search, el.value);
      return;
    }
    var field = el.dataset && el.dataset.field;
    if (!field) return;
    var value = el.type === 'checkbox' ? el.checked : el.value;
    if (route().name === 'edit' && S.edit) {
      if (field === 'pwCurrent' || field === 'pwNew') { S.edit[field] = value; return; }
      setDraftField(S.edit.d, field, value);
    } else if (field === 'password') {
      S.password = value;
    } else {
      setDraftField(S.draft, field, value);
      saveDraft();
    }
    if (field === 'email') S.emailTaken = false;
    if ((field === 'bodyweight' || field === 'hydrationOz') && S.errors.hydrationOz) {
      delete S.errors.hydrationOz;
      var hErr = el.closest('.field') && el.closest('.field').querySelector('.error');
      if (hErr) hErr.remove();
      el.classList.remove('is-invalid');
    }
    var errKey = field.indexOf('other.') === 0 ? 'other' : field;
    if (S.errors[errKey]) { delete S.errors[errKey]; el.classList.remove('is-invalid'); var err = el.closest('.field') && el.closest('.field').querySelector('.error'); if (err) err.remove(); }
    if (field === 'bodyweight') {
      var hint = document.getElementById('hydroCalc');
      var n = Number(value);
      if (hint) hint.innerHTML = n > 50 ? 'Your goal: <b style="color:var(--text)">' + Math.round(n / 2) + ' oz</b> a day. We only keep the goal, not your weight.' : 'We only keep the goal, not your weight.';
    }
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.type !== 'checkbox' || !el.dataset || !el.dataset.field) return;
    if (route().name === 'edit' && S.edit) setDraftField(S.edit.d, el.dataset.field, el.checked);
    else { setDraftField(S.draft, el.dataset.field, el.checked); saveDraft(); }
    if (S.errors[el.dataset.field]) { delete S.errors[el.dataset.field]; var err = el.closest('label') && el.closest('label').nextElementSibling; if (err && err.classList.contains('error')) err.remove(); }
  });

  document.addEventListener('focusout', function (e) {
    var el = e.target;
    if (!el.dataset || el.dataset.field !== 'email' || route().name !== 'join') return;
    var email = el.value.trim();
    if (!validEmail(email)) return;
    api('emailStatus', { token: '', email: email }).then(function (r) {
      if (r.exists && S.draft.email.trim() === email) { S.emailTaken = true; render(); }
    }).catch(function () {});
  });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.dataset || !form.dataset.form) return;
    e.preventDefault();
    if (form.dataset.form === 'signin') submitSignIn(form);
    if (form.dataset.form === 'forgot') submitForgot(form);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.getElementById('sheet')) closeSheet();
    if (e.key === 'Enter' && route().name === 'join' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
      var next = app.querySelector('[data-act="next"]');
      if (next) { e.preventDefault(); next.click(); }
    }
  });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.dataset.act;
    var editing = route().name === 'edit' && S.edit;
    var d = editing ? S.edit.d : S.draft;
    var rerender = function () { if (!editing) saveDraft(); render(); };
    switch (act) {
      case 'join-beta': store.set('res27.beta', true); render(); window.scrollTo(0, 0); break;
      case 'board-view':
        S.boardView = el.dataset.view === 'week' ? 'week' : 'overall';
        render();
        // The repaint replaced the toggle: keep keyboard and screen-reader focus on the chosen button.
        var pressed = document.querySelector('[data-act="board-view"][data-view="' + S.boardView + '"]');
        if (pressed) pressed.focus({ preventScroll: true });
        break;
      case 'board-retry': S.boardError = ''; render(); loadBoard(true); break;
      case 'ask-send': sendQuestion(); break;
      case 'cookbook-retry': S.cookbookError = ''; loadCookbook(true); render(); break;
      case 'choose-type':
        S.draft.memberType = el.dataset.type;
        if (el.dataset.type === 'member') S.draft.payment = '';
        S.errors = {}; S.formError = ''; saveDraft();
        go(el.dataset.type === 'remote' ? '#/join/payment' : '#/join/about');
        break;
      case 'pay': d.payment = el.dataset.method; delete S.errors.payment; rerender(); break;
      case 'shirt': if (d.shirt !== el.dataset.shirt) { d.shirt = el.dataset.shirt; if ((S.config.sizes[d.shirt] || []).indexOf(d.size) < 0) d.size = ''; } delete S.errors.shirt; rerender(); break;
      case 'size': d.size = el.dataset.size; delete S.errors.size; rerender(); break;
      case 'goal': d.goal = el.dataset.goal; delete S.errors.goal; rerender(); break;
      case 'track':
        d.track[el.dataset.id] = el.dataset.val === '1';
        if (S.errors.track && trackAnswered(d)) delete S.errors.track;
        if (el.dataset.id === 'other' && d.track.other !== true) delete S.errors.other;
        rerender(); break;
      case 'plan': d.plan = el.dataset.plan; delete S.errors.plan; rerender(); break;
      case 'sleep': d.sleepHours = Number(el.dataset.val); rerender(); break;
      case 'fin': d.finishersPerWeek = Number(el.dataset.val); rerender(); break;
      case 'hydro-mode':
        d.hydrationMode = el.dataset.val;
        if (d.hydrationMode === 'custom' && !d.hydrationOz && d.bodyweight > 50) d.hydrationOz = Math.round(d.bodyweight / 2);
        rerender(); break;
      case 'idea':
        if (el.dataset.target === 'other') {
          // One Other habit: an idea fills it in, tapping it again clears it.
          d.other = [String(d.other[0] || '').trim() === el.dataset.val ? '' : el.dataset.val];
          delete S.errors.other;
        } else { d[el.dataset.target] = el.dataset.val; delete S.errors[el.dataset.target]; }
        rerender(); break;
      case 'coach':
        var name = el.dataset.name, i = d.coaches.indexOf(name);
        if (i >= 0) d.coaches.splice(i, 1); else d.coaches.push(name);
        rerender(); break;
      case 'coach-none': d.coaches = []; rerender(); break;
      case 'next': joinNext(el.dataset.step); break;
      case 'jump': S.errors = {}; S.returnToReview = true; go('#/join/' + el.dataset.step); break;
      case 'back':
        S.errors = {}; S.formError = '';
        var r = route();
        if (r.name === 'join') {
          var steps = joinSteps(S.draft), at2 = steps.indexOf(r.args[0] || steps[0]);
          go(at2 > 0 ? '#/join/' + steps[at2 - 1] : '#/');
        } else history.back();
        break;
      case 'reveal':
        var input = el.parentNode.querySelector('input');
        if (input) { var show = input.type === 'password'; input.type = show ? 'text' : 'password'; el.innerHTML = icon(show ? 'eyeOff' : 'eye'); el.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); }
        break;
      case 'copy':
        var text = el.dataset.text;
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast('Copied ' + text); }, function () { toast(text); });
        break;
      case 'answer':
        var date = el.dataset.date, key = el.dataset.key, val = Number(el.dataset.val);
        var cur = answersFor(date)[key];
        setAnswer(date, key, cur === val ? null : val);
        break;
      case 'meal':
        var md = el.dataset.date, mk = el.dataset.key, mv = answersFor(md)[mk];
        setAnswer(md, mk, mv === 1 ? 0 : 1);
        break;
      case 'meals-all':
        var ad = el.dataset.date, items = itemsForDate(ad) || [];
        if (!editable(ad)) break;
        var wasLeft = habitsLeft(ad);
        items.forEach(function (it) { if (it.kind === 'meals') it.units.forEach(function (u) { S.pending[ad] = S.pending[ad] || {}; S.pending[ad][u[0]] = 1; }); });
        setAnswer(ad, 'nutrition:m1', 1, wasLeft);
        break;
      case 'play': playVideo(el.dataset.date); break;
      case 'ext-video': setTimeout(function () { markWatched(el.dataset.date); }, 1500); break;
      case 'variant':
        S.variant[el.dataset.date] = Number(el.dataset.i);
        destroyPlayer();
        S.renderedDay = null;
        render();
        break;
      case 'retry-save': Object.keys(S.pending).forEach(function (dt) { flushSave(dt); }); break;
      case 'ready':
        var ready = store.get('res27.ready', {}) || {};
        ready[el.dataset.i] = !ready[el.dataset.i];
        store.set('res27.ready', ready);
        render();
        break;
      case 'no-install': store.set('res27.noinstall', true); var card = el.closest('.install'); if (card) card.remove(); break;
      case 'install':
        if (S.installEvent) { S.installEvent.prompt(); S.installEvent = null; }
        break;
      case 'close-sheet': closeSheet(); break;
      case 'save-edit': saveEdit(el.dataset.section); break;
      case 'cancel-edit': S.edit = null; S.errors = {}; S.formError = ''; go('#/profile'); break;
      case 'signout':
        if (hasPending() && !window.confirm('Some answers haven’t saved yet. Sign out anyway and lose them?')) break;
        signOutLocal(); toast('Signed out.'); go('#/');
        break;
      case 'signout-all':
        if (!window.confirm('Sign out on every phone and computer?')) break;
        api('signoutAll').then(function () { signOutLocal(); toast('Signed out everywhere.'); go('#/'); }, function (err) { toast(err.message, true); });
        break;
      case 'reset-again': S.resetStage = 'email'; S.formError = ''; render(); break;
      case 'reload': S.loadError = ''; render(); loadMe(); break;
    }
  });

  window.addEventListener('hashchange', function () {
    if (route().name !== 'join') S.formError = '';
    if (route().name !== 'edit') S.edit = null;
    if (route().name !== 'forgot') S.resetStage = S.resetStage === 'code' && route().name === 'forgot' ? 'code' : 'email';
    render();
  });

  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); S.installEvent = e; });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !S.token) return;
    var old = Date.now() - S.lastLoad > 10 * 60 * 1000;
    if (stale()) render(); // yesterday's screen locks until today's data arrives
    if (old || stale()) loadMe(true);
    flushAllPending();
  });
  window.addEventListener('online', function () { S.boardTriedAt = 0; S.cookbookError = ''; flushAllPending(); });
  // A tab left open past midnight: lock yesterday's screen and fetch today.
  setInterval(function () {
    if (S.token && S.me && document.visibilityState === 'visible' && stale()) { render(); loadMe(true); }
  }, 60000);

  /* ============================================================ start */

  toastWrap();
  render();
  if (S.token) loadMe();
  else loadConfig();
})();

