// Expense log — phone app. Plain JavaScript, no build step. line.js (loaded first) provides
// parseAmount, buildLine, fmtNum and NOTHING.
(function () {
  'use strict';

  var VERSION = '3';
  var OTHER = '__other__';
  var LS = {
    cfg: 'ea.cfg', lists: 'ea.lists', queue: 'ea.queue', usage: 'ea.usage',
    srv: 'ea.srv', dirty: 'ea.dirty'
  };

  // ── Storage helpers ──────────────────────────────────────────────────────────────────────
  function lsGet(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage unavailable */ }
  }

  // ── State ────────────────────────────────────────────────────────────────────────────────
  var cfg = lsGet(LS.cfg, null);                                        // { url, token }
  var lists = lsGet(LS.lists, { apps: [], accounts: [], items: [] });
  var queue = lsGet(LS.queue, []);                                      // entries waiting to upload
  var usage = lsGet(LS.usage, {});                                      // item (lowercase) -> times used
  var srv = lsGet(LS.srv, { recent: [], counts: {} });                  // last state from the server
  var dirty = lsGet(LS.dirty, false);                                   // lists changed, not yet uploaded
  var dateTouched = false;
  var touched = { app: false, account: false };                         // user picked a value in this dropdown
  var working = null;                                                  // settings working copy
  var syncing = false, syncAgain = false, lastErr = null, retryTimer = null;
  var waiters = [];                                                     // callers waiting for the current sync
  var rejected = {};                                                    // ids the server refused

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'class') n.className = props[k];
      else if (k === 'text') n.textContent = props[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), props[k]);
      else n.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  // ── Dates and ids ────────────────────────────────────────────────────────────────────────
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function dateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return dateStr(new Date()); }
  function yesterdayStr() { var d = new Date(); d.setDate(d.getDate() - 1); return dateStr(d); }
  function nowStr() {
    var d = new Date();
    return dateStr(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function prettyDate(s) {
    var p = String(s).split('-');
    if (p.length !== 3) return s;
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  // ── Toast ────────────────────────────────────────────────────────────────────────────────
  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2200);
  }

  // ── Backend calls ────────────────────────────────────────────────────────────────────────
  // A URL copied from a browser tab can contain "/u/1/" (the signed-in account index); drop it.
  function normalizeUrl(u) {
    return String(u || '').trim().replace(/\/macros\/u\/\d+\//, '/macros/');
  }

  function validUrl(u) {
    return /^https:\/\/script\.google\.com\//.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u);
  }

  function api(action, payload) {
    var body = Object.assign({ token: cfg.token, action: action }, payload || {});
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 20000);
    // No custom headers: a plain-text POST avoids a CORS preflight, which Apps Script does not answer.
    return fetch(cfg.url, { method: 'POST', body: JSON.stringify(body), redirect: 'follow', signal: ctrl.signal })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        clearTimeout(timer);
        if (!j.ok) { var e = new Error(j.error || 'error'); e.server = true; throw e; }
        return j;
      })
      .catch(function (e) { clearTimeout(timer); throw e; });
  }

  function applyState(st) {
    if (!st) return;
    var before = JSON.stringify(lists);
    if (!dirty) {
      lists = { apps: st.apps || [], accounts: st.accounts || [], items: st.items || [] };
    } else {
      lists.items = st.items || lists.items;
    }
    lsSet(LS.lists, lists);
    srv = { recent: st.recent || [], counts: st.counts || {} };
    lsSet(LS.srv, srv);
    // Rebuild the dropdowns only when the lists really changed, so a background refresh never
    // touches the form the user is looking at.
    if (JSON.stringify(lists) !== before) {
      renderSelects(true);
      renderChips();
    }
    renderRecent();
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    if (queue.length || dirty) retryTimer = setTimeout(sync, 30000);
  }

  // sync() resolves when the upload attempt that covers the caller's entry has finished.
  function sync() {
    if (!cfg) return Promise.resolve();
    if (syncing) {
      syncAgain = true;
      return new Promise(function (resolve) { waiters.push(resolve); });
    }
    syncing = true;
    renderBadge();
    var st = null;
    var chain = Promise.resolve();
    if (queue.length) {
      chain = chain.then(function () {
        var batch = queue.slice();
        return api('add', { entries: batch }).then(function (r) {
          var done = {};
          batch.forEach(function (b) { done[b.id] = true; });
          queue = queue.filter(function (q) { return !done[q.id]; });
          lsSet(LS.queue, queue);
          st = r.state;
          var rej = (r.result && r.result.rejected) || [];
          rej.forEach(function (x) { rejected[x.id] = true; });
          if (rej.length) toast(rej.length + ' entry rejected by the server: ' + rej[0].error, 5000);
        });
      });
    }
    if (dirty) {
      chain = chain.then(function () {
        return api('saveLists', { apps: lists.apps, accounts: lists.accounts }).then(function (r) {
          dirty = false;
          lsSet(LS.dirty, false);
          st = r.state;
        });
      });
    }
    return chain
      .then(function () { return st ? { state: st } : api('init'); })
      .then(function (r) { lastErr = null; applyState(r.state); })
      .catch(function (e) {
        lastErr = e;
        if (e && e.message === 'unauthorized') toast('Token rejected. Check Settings.');
      })
      .then(function () {
        syncing = false;
        renderBadge();
        renderRecent();
        if (syncAgain) { syncAgain = false; return sync(); }
        scheduleRetry();
        var w = waiters;
        waiters = [];
        w.forEach(function (resolve) { resolve(); });
      });
  }

  // Tells the user what happened to an entry they just saved, with its date.
  function announce(entry) {
    var label = prettyDate(entry.date);
    toast('Saving for ' + label + '…', 20000);
    sync().then(function () {
      if (rejected[entry.id]) return; // the rejection message is already on screen
      var waiting = queue.some(function (q) { return q.id === entry.id; });
      toast(waiting
        ? 'Saved on this phone for ' + label + '. Will upload when online.'
        : 'Saved for ' + label + ' ✓', waiting ? 4000 : 2500);
    });
  }

  // ── Rendering ────────────────────────────────────────────────────────────────────────────
  function show(view) {
    ['viewSetup', 'viewLog', 'viewSettings'].forEach(function (v) { $(v).hidden = (v !== view); });
    window.scrollTo(0, 0);
  }

  function renderBadge() {
    var b = $('badge');
    var waiting = queue.length + (dirty ? 1 : 0);
    b.className = 'badge';
    if (!cfg) { b.textContent = ''; return; }
    if (syncing) b.textContent = 'syncing…';
    else if (waiting) { b.textContent = (navigator.onLine === false ? 'offline · ' : '') + waiting + ' waiting'; b.classList.add('warn'); }
    else if (lastErr) { b.textContent = 'not synced'; b.classList.add('warn'); }
    else b.textContent = '✓ synced';
  }

  function fillSelect(sel, list, keep) {
    var cur = keep ? sel.value : null;
    sel.textContent = '';
    list.forEach(function (v) { sel.appendChild(el('option', { value: v, text: v })); });
    sel.appendChild(el('option', { value: '', text: '— none —' }));
    sel.appendChild(el('option', { value: OTHER, text: 'Other…' }));
    var ok = cur !== null && Array.prototype.some.call(sel.options, function (o) { return o.value === cur; });
    if (ok) sel.value = cur;
    else sel.selectedIndex = 0; // default: the top of the list
  }

  // keep = true: a background refresh. A dropdown keeps its current choice only if the user touched
  // it; otherwise it goes back to the default (top of the list), e.g. when the lists first arrive.
  function renderSelects(keep) {
    if (!keep) { touched.app = false; touched.account = false; }
    fillSelect($('app'), lists.apps, keep && touched.app);
    fillSelect($('account'), lists.accounts, keep && touched.account);
    syncOther('app');
    syncOther('account');
    updatePreview();
  }

  function syncOther(name) {
    $(name + 'Other').hidden = ($(name).value !== OTHER);
  }

  function fieldValue(name) {
    var v = $(name).value;
    return v === OTHER ? $(name + 'OtherText').value.trim() : v;
  }

  function rankedItems() {
    var order = {};
    lists.items.forEach(function (x, i) { order[x.toLowerCase()] = i; });
    return lists.items.slice().sort(function (a, b) {
      var la = a.toLowerCase(), lb = b.toLowerCase();
      var ua = usage[la] || 0, ub = usage[lb] || 0;
      return ua !== ub ? ub - ua : order[la] - order[lb];
    });
  }

  function renderChips() {
    var q = $('item').value.trim().toLowerCase();
    var ranked = rankedItems();
    var out = [];
    if (q) {
      var starts = [], has = [];
      ranked.forEach(function (x) {
        var l = x.toLowerCase();
        if (l === q) return;
        if (l.indexOf(q) === 0) starts.push(x);
        else if (l.indexOf(q) > 0) has.push(x);
      });
      out = starts.concat(has).slice(0, 6);
    }
    var box = $('chips');
    box.textContent = '';
    box.hidden = !out.length; // suggestions appear only while typing
    out.forEach(function (x) {
      box.appendChild(el('button', {
        'class': 'chip', type: 'button', text: x,
        onclick: function () { $('item').value = x; renderChips(); updatePreview(); $('amount').focus(); }
      }));
    });
  }

  function currentEntry() {
    return {
      item: $('item').value.trim(),
      amountText: $('amount').value,
      app: fieldValue('app'),
      account: fieldValue('account'),
      counts: !$('notExpense').checked
    };
  }

  function updatePreview() {
    var e = currentEntry();
    var a = parseAmount(e.amountText);
    var hint = $('amountHint');
    hint.className = 'hint';
    if (!e.amountText.trim()) hint.textContent = '';
    else if (!a.ok) { hint.textContent = a.error; hint.classList.add('err'); }
    else if (a.total <= 0) { hint.textContent = 'Amount must be above 0'; hint.classList.add('err'); }
    else if (a.text !== fmtNum(a.total)) hint.textContent = '= ' + fmtNum(a.total);
    else hint.textContent = '';
    var line = a.ok && a.total > 0 ? buildLine(e) : null;
    $('preview').textContent = line || 'Fill the amount to see the line';
    $('save').disabled = !line;
  }

  function renderDate() {
    var d = $('date').value;
    $('dateLabel').textContent = d ? '· ' + prettyDate(d) : '';
    $('dToday').classList.toggle('on', d === todayStr());
    $('dYesterday').classList.toggle('on', d === yesterdayStr());
  }

  function renderRecent() {
    var pendingIds = {};
    var pending = queue.map(function (q) {
      pendingIds[q.id] = true;
      return { id: q.id, date: q.date, line: buildLine(q) || '', pending: true };
    });
    var synced = (srv.recent || []).filter(function (r) { return !pendingIds[r.id]; });
    var all = synced.concat(pending).slice(-5).reverse();
    var box = $('recent');
    box.textContent = '';
    if (!all.length) { box.appendChild(el('div', { 'class': 'empty', text: 'Nothing logged yet.' })); return; }
    all.forEach(function (r) {
      var meta = prettyDate(r.date) + (r.pending ? ' · waiting to upload' : '');
      box.appendChild(el('div', { 'class': 'r' }, [
        el('div', { 'class': 'r-main' }, [
          el('div', { 'class': 'r-line', text: r.line }),
          el('div', { 'class': 'r-meta' + (r.pending ? ' wait' : ''), text: meta })
        ]),
        el('button', { 'class': 'del', type: 'button', 'aria-label': 'Delete entry', text: '🗑', onclick: function () { removeEntry(r); } })
      ]));
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────────────────────────
  function countFor(date) {
    var n = (srv.counts && srv.counts[date]) || 0;
    queue.forEach(function (q) { if (q.date === date && q.item !== NOTHING) n++; });
    return n;
  }

  function addToListIfAsked(name, key) {
    if ($(name).value !== OTHER || !$(name + 'OtherAdd').checked) return;
    var v = $(name + 'OtherText').value.trim();
    if (!v) return;
    var exists = lists[key].some(function (x) { return x.toLowerCase() === v.toLowerCase(); });
    if (!exists) {
      lists[key].push(v);
      dirty = true;
      lsSet(LS.lists, lists);
      lsSet(LS.dirty, true);
    }
  }

  function enqueue(entry) {
    queue.push(entry);
    lsSet(LS.queue, queue);
    renderRecent();
    renderBadge();
    announce(entry); // shows "Saving for <date>…", uploads, then shows the result
  }

  function resetForm() {
    $('amount').value = '';
    $('item').value = '';
    $('notExpense').checked = false;
    $('appOtherText').value = ''; $('appOtherAdd').checked = false;
    $('accountOtherText').value = ''; $('accountOtherAdd').checked = false;
    renderSelects(false);
    renderChips();
    updatePreview();
    // Back to the top of a clean form, ready for the next amount. preventScroll stops the browser
    // from scrolling anywhere else (for example to the Account block) while it moves the focus.
    window.scrollTo(0, 0);
    $('amount').focus({ preventScroll: true });
  }

  function save() {
    var e = currentEntry();
    var a = parseAmount(e.amountText);
    if (!a.ok || a.total <= 0) return;
    var entry = {
      id: uuid(),
      date: $('date').value || todayStr(),
      item: e.item,
      amountText: e.amountText.replace(/\s+/g, ''),
      app: e.app,
      account: e.account,
      counts: e.counts,
      loggedAt: nowStr()
    };
    addToListIfAsked('app', 'apps');
    addToListIfAsked('account', 'accounts');
    if (e.item) {
      var k = e.item.toLowerCase();
      usage[k] = (usage[k] || 0) + 1;
      lsSet(LS.usage, usage);
      if (!lists.items.some(function (x) { return x.toLowerCase() === k; })) {
        lists.items.push(e.item);
        lsSet(LS.lists, lists);
      }
    }
    enqueue(entry);
    resetForm();
  }

  function logNothing() {
    var date = $('date').value || todayStr();
    var n = countFor(date);
    if (n > 0 && !window.confirm(prettyDate(date) + ' already has ' + n + (n === 1 ? ' entry' : ' entries') + '. Add "Nothing" anyway?')) return;
    enqueue({
      id: uuid(), date: date, item: NOTHING, amountText: '0', app: '', account: '',
      counts: true, loggedAt: nowStr()
    });
  }

  function removeEntry(r) {
    if (r.pending) {
      queue = queue.filter(function (q) { return q.id !== r.id; });
      lsSet(LS.queue, queue);
      renderRecent(); renderBadge();
      toast('Removed');
      return;
    }
    if (!window.confirm('Delete this entry?\n\n' + r.line)) return;
    api('delete', { id: r.id })
      .then(function (res) { applyState(res.state); toast('Deleted'); })
      .catch(function () { toast('Could not delete. Check your connection.'); });
  }

  // ── Settings ─────────────────────────────────────────────────────────────────────────────
  function openSettings() {
    working = { apps: lists.apps.slice(), accounts: lists.accounts.slice() };
    $('cfgUrl').value = cfg ? cfg.url : '';
    $('cfgToken').value = cfg ? cfg.token : '';
    $('ver').textContent = 'App version ' + VERSION;
    renderEditors();
    renderSyncInfo();
    show('viewSettings');
  }

  function renderSyncInfo() {
    var parts = [queue.length + ' entries waiting to upload'];
    if (dirty) parts.push('list changes waiting');
    if (lastErr) parts.push('last sync failed: ' + lastErr.message);
    $('syncInfo').textContent = parts.join(' · ');
  }

  function renderEditor(boxId, key) {
    var box = $(boxId);
    box.textContent = '';
    var arr = working[key];
    arr.forEach(function (name, i) {
      var nameEl = el('span', { 'class': 'name' }, [name]);
      if (i === 0) nameEl.appendChild(el('span', { 'class': 'def', text: 'default' }));
      var up = el('button', { type: 'button', 'aria-label': 'Move up', text: '▲', onclick: function () { move(key, i, -1); } });
      var down = el('button', { type: 'button', 'aria-label': 'Move down', text: '▼', onclick: function () { move(key, i, 1); } });
      var del = el('button', { type: 'button', 'aria-label': 'Remove', text: '✕', onclick: function () { arr.splice(i, 1); renderEditors(); } });
      if (i === 0) up.disabled = true;
      if (i === arr.length - 1) down.disabled = true;
      box.appendChild(el('div', { 'class': 'row' }, [nameEl, up, down, del]));
    });
  }

  function renderEditors() {
    renderEditor('edApps', 'apps');
    renderEditor('edAccounts', 'accounts');
  }

  function move(key, i, dir) {
    var arr = working[key];
    var j = i + dir;
    if (j < 0 || j >= arr.length) return;
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    renderEditors();
  }

  function addEntry(inputId, key) {
    var v = $(inputId).value.trim();
    if (!v) return;
    if (working[key].some(function (x) { return x.toLowerCase() === v.toLowerCase(); })) { toast('Already in the list'); return; }
    working[key].push(v);
    $(inputId).value = '';
    renderEditors();
  }

  function saveSettings() {
    var url = normalizeUrl($('cfgUrl').value), token = $('cfgToken').value.trim();
    if (!validUrl(url) || !token) { toast('Check the URL and token'); return; }
    var connChanged = !cfg || cfg.url !== url || cfg.token !== token;
    cfg = { url: url, token: token };
    lsSet(LS.cfg, cfg);
    var listsChanged = JSON.stringify(working.apps) !== JSON.stringify(lists.apps) ||
      JSON.stringify(working.accounts) !== JSON.stringify(lists.accounts);
    if (listsChanged) {
      lists.apps = working.apps; lists.accounts = working.accounts;
      dirty = true;
      lsSet(LS.lists, lists); lsSet(LS.dirty, true);
    }
    renderSelects(false);
    show('viewLog');
    renderBadge();
    toast('Settings saved');
    if (connChanged || listsChanged) sync();
  }

  // ── Setup and wiring ─────────────────────────────────────────────────────────────────────
  function readHashConfig() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    var u = normalizeUrl(p.get('u')), t = p.get('t');
    if (u && t && validUrl(u)) {
      cfg = { url: u, token: t };
      lsSet(LS.cfg, cfg);
    }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  }

  function saveSetup() {
    var url = normalizeUrl($('setupUrl').value), token = $('setupToken').value.trim();
    if (!validUrl(url) || !token) { toast('Check the URL and token'); return; }
    cfg = { url: url, token: token };
    lsSet(LS.cfg, cfg);
    start();
  }

  function setDate(d) {
    $('date').value = d;
    renderDate();
  }

  function wire() {
    $('btnSettings').addEventListener('click', function () {
      if ($('viewSettings').hidden) openSettings(); else show('viewLog');
    });
    $('setupSave').addEventListener('click', saveSetup);
    $('amount').addEventListener('input', updatePreview);
    $('item').addEventListener('input', function () { renderChips(); updatePreview(); });
    $('notExpense').addEventListener('change', updatePreview);
    $('plus').addEventListener('click', function () {
      var a = $('amount');
      var s = a.selectionStart == null ? a.value.length : a.selectionStart;
      var e = a.selectionEnd == null ? s : a.selectionEnd;
      a.value = a.value.slice(0, s) + '+' + a.value.slice(e);
      a.focus();
      a.setSelectionRange(s + 1, s + 1);
      updatePreview();
    });
    ['app', 'account'].forEach(function (name) {
      $(name).addEventListener('change', function () {
        touched[name] = true;
        syncOther(name);
        if ($(name).value === OTHER) $(name + 'OtherText').focus();
        updatePreview();
      });
      $(name + 'OtherText').addEventListener('input', updatePreview);
    });
    document.querySelectorAll('[data-clear]').forEach(function (b) {
      b.addEventListener('click', function () {
        var name = b.getAttribute('data-clear');
        touched[name] = true;
        $(name).value = '';
        syncOther(name);
        updatePreview();
      });
    });
    $('dToday').addEventListener('click', function () { dateTouched = false; setDate(todayStr()); });
    $('dYesterday').addEventListener('click', function () { dateTouched = true; setDate(yesterdayStr()); });
    $('date').addEventListener('change', function () { dateTouched = true; renderDate(); });
    $('save').addEventListener('click', save);
    $('nothing').addEventListener('click', logNothing);
    $('settingsBack').addEventListener('click', function () { show('viewLog'); });
    $('settingsSave').addEventListener('click', saveSettings);
    $('addAppBtn').addEventListener('click', function () { addEntry('addApp', 'apps'); });
    $('addAccountBtn').addEventListener('click', function () { addEntry('addAccount', 'accounts'); });
    $('syncNow').addEventListener('click', function () { sync().then(renderSyncInfo); });
    window.addEventListener('online', sync);
    window.addEventListener('offline', renderBadge);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (!dateTouched) setDate(todayStr());
      sync();
    });
  }

  function start() {
    if (!cfg) { show('viewSetup'); renderBadge(); return; }
    show('viewLog');
    setDate(todayStr());
    renderSelects(false);
    renderChips();
    renderRecent();
    renderBadge();
    updatePreview();
    sync();
  }

  readHashConfig();
  wire();
  start();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // When a new version takes over, reload once so it runs straight away. Skipped on the very
    // first install (nothing to replace) and while a half-typed entry is on screen. Waiting
    // entries are kept in the phone's storage, so a reload never loses them.
    var hadController = !!navigator.serviceWorker.controller;
    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || reloaded) return;
      if ($('amount').value || $('item').value) { toast('Update ready. Reopen the app to use it.'); return; }
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline start is a bonus */ });
  }
})();
