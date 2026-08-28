/* sg-screens.js — put an output on a chosen monitor, from any control panel.
 *
 * This started life inside the teleprompter panel. It is here now because the same job — take
 * this output, put it full screen on that monitor, and give me a way to close it again — is
 * wanted for the graphics builder, the scoreboards and the Program output, and because the
 * awkward parts of it were paid for once already and must not be paid for twice:
 *
 *   🚨 The chosen monitor is remembered BY NAME, not by position in the list. A position is
 *      only stable while the monitors are. Unplug the second of three and a saved "2" points at
 *      a different physical screen — so the output opens on the wrong monitor, in a room where
 *      that can mean it opens in front of the audience.
 *   🚨 The window HANDLE is kept, and survives a reload of the control page. Without it, sending
 *      an output to a monitor was a one-way trip: nothing could close it again, and a full-screen
 *      output window with no chrome is exactly what you cannot find in a hurry. A reload used to
 *      orphan it; re-opening by the same window NAME reclaims it.
 *   🚨 The "Find my monitors" button does NOT hide itself once it has worked. Plug a monitor in
 *      afterwards and there has to be a way to look again.
 *
 * The Window Management API needs a secure context. On the StreamGraphics computer itself
 * http://localhost counts as one, which is exactly where this is used. From a tablet across the
 * network it does not — and could not anyway, since no browser can place a window on another
 * computer's monitor. That case says so, rather than failing quietly.
 *
 * 🚨 THE TELEPROMPTER STILL HAS ITS OWN COPY of this, inside public/prompter.js. It was not
 *    folded in here in the same build: that copy drives a live show, nothing in the test suite
 *    exercises it, and rewiring it blind on the day would have risked a working, paid feature
 *    for tidiness. It is a KNOWN duplicate, not an oversight — CHANGE BOTH, or fold the prompter
 *    onto this module and write the tests for it first. The two are byte-similar today.
 *
 * Usage:
 *   SGScreens.mount({
 *     root: document.getElementById('screenRow'),   // where the controls are drawn
 *     hint: document.getElementById('screenHint'),  // one line of plain English
 *     key: 'sg.lowerthird.screen',                  // storage key — one per panel
 *     outputs: [{ label: 'Open there ▸', path: '/lowerthird-output?fs=1', name: 'sglt' }]
 *   });
 */
(function () {
  'use strict';

  function canPlace() { return typeof window.getScreenDetails === 'function' && window.isSecureContext; }

  function mapScreens(d) {
    return (d.screens || []).map(function (s, i) {
      return {
        left: s.availLeft, top: s.availTop, width: s.availWidth, height: s.availHeight,
        label: (s.label || ('Monitor ' + (i + 1))) + ' — ' + s.width + '×' + s.height + (s.isPrimary ? ' (main)' : '')
      };
    });
  }

  function mount(opts) {
    var root = opts.root, hintEl = opts.hint;
    if (!root) return null;
    var SKEY = opts.key || 'sg.screen';
    var OPEN_KEY = SKEY + '.sent';
    var outputs = opts.outputs || [];
    var what = opts.what || 'output';       // the word used in "… window closed"

    // --- markup, built here so a panel only has to provide an empty row ---
    var btnFind = document.createElement('button');
    btnFind.className = 'btn ghost'; btnFind.type = 'button'; btnFind.textContent = 'Find my monitors';
    var pick = document.createElement('select');
    pick.className = 'inp'; pick.style.width = 'auto'; pick.style.display = 'none';
    root.appendChild(btnFind); root.appendChild(pick);
    var sendBtns = outputs.map(function (o, i) {
      var b = document.createElement('button');
      b.className = i === 0 ? 'btn' : 'btn ghost'; b.type = 'button';
      b.textContent = o.label; b.style.display = 'none';
      root.appendChild(b);
      return b;
    });
    var btnClose = document.createElement('button');
    btnClose.className = 'btn ghost'; btnClose.type = 'button';
    btnClose.textContent = '✕ Close ' + what + ' window'; btnClose.style.display = 'none';
    root.appendChild(btnClose);

    function hint(t) { if (hintEl) hintEl.textContent = t; }

    var screens = [], screenDetails = null, sentWins = {};

    function openNames() {
      try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '[]') || []; } catch (e) { return []; }
    }
    function rememberOpen(name, yes) {
      var list = openNames().filter(function (n) { return n !== name; });
      if (yes) list.push(name);
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(list)); } catch (e) {}
    }
    function liveCount() {
      var n = 0;
      Object.keys(sentWins).forEach(function (k) {
        var w = sentWins[k];
        // A window the operator closed by hand must not keep the button lit.
        if (!w || w.closed) { delete sentWins[k]; rememberOpen(k, false); } else n++;
      });
      return n;
    }
    function refreshCloseBtn() {
      // Either we hold a live handle, or a previous page-load left one behind we can reclaim.
      btnClose.style.display = (liveCount() > 0 || openNames().length > 0) ? '' : 'none';
    }

    function closeSent() {
      var names = {}, k;
      for (k in sentWins) names[k] = 1;
      openNames().forEach(function (n) { names[n] = 1; });
      Object.keys(names).forEach(function (name) {
        var w = sentWins[name];
        /* No live handle — this page was reloaded since sending. Re-opening by NAME with an
           empty url hands back the existing window without navigating it, so it can be closed.
           If no such window exists we get a blank one, closed on the same line. */
        if (!w || w.closed) { try { w = window.open('', name); } catch (e) { w = null; } }
        if (w) { try { w.close(); } catch (e) {} }
        delete sentWins[name];
        rememberOpen(name, false);
      });
      hint('Window closed. The monitor is yours again.');
      refreshCloseBtn();
    }

    function openOn(out) {
      var i = Math.max(0, Math.min(screens.length - 1, +pick.value || 0));
      var s = screens[i];
      // Both: the name survives a monitor being unplugged, the index is the fallback for a
      // screen whose name the browser would not tell us.
      try {
        localStorage.setItem(SKEY, String(i));
        localStorage.setItem(SKEY + '.name', s ? s.label : '');
      } catch (e) {}
      var url = (window.SGLinks ? SGLinks.url(out.path) : out.path);
      var feat = s
        ? 'popup=yes,left=' + s.left + ',top=' + s.top + ',width=' + s.width + ',height=' + s.height
        : 'popup=yes';
      // A distinct name per output, so re-sending replaces that window rather than piling up.
      var name = out.name;
      var w = window.open(url, name, feat);
      if (!w) { hint('Your browser blocked that pop-up. Allow pop-ups for this address and try again.'); return; }
      sentWins[name] = w;
      rememberOpen(name, true);
      // Chrome sizes a re-used window to its old bounds, so say it again once it is there.
      if (s) { try { w.moveTo(s.left, s.top); w.resizeTo(s.width, s.height); } catch (e) {} }
      try { w.focus(); } catch (e) {}
      hint('Sent to ' + (s ? s.label : 'a new window') +
           '. If it is not full screen, click the window once and press F11.');
      refreshCloseBtn();
    }

    function fillScreens(list) {
      var before = screens.length;
      screens = list;
      pick.innerHTML = '';
      list.forEach(function (s, i) {
        var o = document.createElement('option');
        o.value = String(i); o.textContent = s.label;
        pick.appendChild(o);
      });
      var want = -1, savedName = '';
      try { savedName = localStorage.getItem(SKEY + '.name') || ''; } catch (e) {}
      if (savedName) {
        for (var i = 0; i < list.length; i++) if (list[i].label === savedName) { want = i; break; }
      }
      if (want < 0) {
        var savedIdx = 0;
        try { savedIdx = parseInt(localStorage.getItem(SKEY), 10) || 0; } catch (e) {}
        want = Math.max(0, Math.min(list.length - 1, savedIdx));
      }
      pick.value = String(want);
      pick.style.display = list.length ? '' : 'none';
      sendBtns.forEach(function (b) { b.style.display = ''; });
      btnFind.style.display = '';
      btnFind.textContent = list.length ? 'Check for monitor changes' : 'Find my monitors';
      if (!list.length) return;
      var changed = before && before !== list.length;
      hint((changed ? 'Monitor list updated — ' + list.length + ' connected. ' : '') +
        (list.length > 1
          ? 'Pick the monitor and send it. The choice is remembered by name.'
          : 'Only one monitor is connected, so this will open on it.') +
        (savedName && want >= 0 && list[want] && list[want].label === savedName ? '' :
         (savedName ? ' ("' + savedName + '" is not connected right now.)' : '')));
    }

    function watchScreens(d) {
      if (!d || d === screenDetails) return;
      screenDetails = d;
      if (typeof d.addEventListener !== 'function') return;
      d.addEventListener('screenschange', function () { fillScreens(mapScreens(d)); });
    }

    btnFind.onclick = function () {
      if (!canPlace()) {
        // Deliberately explicit about WHY: the reason changes what the operator should do.
        hint(window.isSecureContext
          ? 'This browser cannot place windows on a chosen monitor (Chrome and Edge can). Open the output link and drag that window to the monitor, then press F11.'
          : 'Placing a window on a chosen monitor only works on the StreamGraphics computer itself. From another device, open the output link over there and drag it across, or use it as a browser source.');
        fillScreens([]);
        sendBtns.forEach(function (b) { b.style.display = ''; });
        pick.style.display = 'none';
        return;
      }
      window.getScreenDetails().then(function (d) {
        watchScreens(d);
        fillScreens(mapScreens(d));
      }).catch(function () {
        hint('Permission to see your monitors was declined. Allow it in the address bar, or open the output link and drag the window across.');
      });
    };
    pick.onchange = function () {
      var s = screens[+this.value];
      try { localStorage.setItem(SKEY + '.name', s ? s.label : ''); localStorage.setItem(SKEY, this.value); } catch (e) {}
    };
    sendBtns.forEach(function (b, i) { b.onclick = function () { openOn(outputs[i]); }; });
    btnClose.onclick = closeSent;

    if (!canPlace()) {
      btnFind.textContent = 'Open the output in its own window';
    } else if (navigator.permissions && navigator.permissions.query) {
      /* The browser remembers this permission, so on the studio PC it has usually already been
         given. Where it has, fill the list in on load and keep watching — a monitor swapped
         between shows is then simply right, with nothing to press. Where it has not, nothing
         happens: asking is the operator's move, not something to spring on them on page load. */
      try {
        navigator.permissions.query({ name: 'window-management' }).then(function (st) {
          if (!st || st.state !== 'granted') return;
          window.getScreenDetails().then(function (d) { watchScreens(d); fillScreens(mapScreens(d)); })
            .catch(function () {});
        }).catch(function () {});
      } catch (e) {}
    }
    refreshCloseBtn();

    return { refresh: function () { btnFind.onclick(); }, close: closeSent, canPlace: canPlace };
  }

  window.SGScreens = { mount: mount, canPlace: canPlace };
})();
