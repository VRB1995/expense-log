// <<LINE-LOGIC  (this block must stay identical in web/line.js and apps_script/Code.gs; tests/check_sync.js verifies it)
var NOTHING = 'Nothing';

function fmtNum(n) {
  return String(Math.round(n * 100) / 100);
}

// Accepts "250", "400.43" or a sum such as "50+40+30".
function parseAmount(text) {
  var s = String(text == null ? '' : text).replace(/\s+/g, '');
  if (!s) return { ok: false, error: 'Enter an amount' };
  var parts = s.split('+');
  var nums = [];
  for (var i = 0; i < parts.length; i++) {
    if (!/^(\d+(\.\d+)?|\.\d+)$/.test(parts[i])) {
      return { ok: false, error: 'Use digits, . and + only' };
    }
    nums.push(parseFloat(parts[i]));
  }
  var total = 0;
  for (var j = 0; j < nums.length; j++) total += nums[j];
  total = Math.round(total * 100) / 100;
  if (total > 100000000) return { ok: false, error: 'Amount too large' };
  var shown = nums.length > 1 ? nums.map(fmtNum).join(' + ') + ' = ' + fmtNum(total) : fmtNum(total);
  return { ok: true, total: total, text: shown };
}

// e = { item, amountText, app, account, counts }. Blank parts are left out cleanly.
function buildLine(e) {
  var a = parseAmount(e.amountText);
  if (!a.ok) return null;
  var item = String(e.item || '').trim();
  var app = String(e.app || '').trim();
  var account = String(e.account || '').trim();
  if (item === NOTHING && a.total === 0 && !app && !account) return NOTHING;
  var paren = [app, account].filter(Boolean).join(', ');
  var core;
  if (item && paren) core = item + ' (' + paren + '): ' + a.text;
  else if (item) core = item + ': ' + a.text;
  else if (paren) core = '(' + paren + '): ' + a.text;
  else core = a.text;
  return e.counts === false ? '(' + core + ')' : core;
}
// LINE-LOGIC>>
