/* sg-links.js — one place that knows which address the OTHER computers can reach.
 *
 * Every control panel used to build its output URL from location.host. On the machine
 * running StreamGraphics that reads "http://localhost:4000/lowerthird-output", and a
 * copied localhost link is not just useless on a second computer — it is actively
 * wrong, because it points that computer at ITSELF. So the copy button handed you a
 * link that could never work, and the only way to get a real one was to read the IP
 * off the home page and type the rest by hand. Hence typos.
 *
 * This resolves the reachable base URL once and shares it. If the app was opened over
 * the network already, that address is by definition reachable and is kept. If it was
 * opened on localhost, we ask the server for this computer's LAN address(es).
 *
 * A Windows machine can have several: Wi-Fi, Ethernet, a VPN, and the virtual switches
 * Hyper-V / VirtualBox / Docker leave behind. Only one of them is the one the studio
 * network can see, and no code can be certain which — so the choice is offered and
 * remembered instead of guessed at silently.
 */
(function () {
  var LS_KEY = 'sg_lan_ip';

  function isLoopback(h) {
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || /^127\./.test(h);
  }

  var SG = {
    port: (location.port || '80'),
    ips: [],                 // every LAN address this computer has
    chosen: '',              // the one we're building links from ('' = use location.host)
    localOnly: isLoopback(location.hostname),
    ready: false
  };

  SG._base = location.protocol + '//' + location.host;
  SG._subs = [];

  /* Build a full URL for an app path. Safe to call before /netinfo answers — it just
     returns the current-host version until the real address is known, then every
     subscriber is called again with the better one. */
  SG.url = function (p) { return SG._base + (p.charAt(0) === '/' ? p : '/' + p); };

  SG.base = function () { return SG._base; };

  /* Run fn now and again whenever the base address changes. */
  SG.onbase = function (fn) {
    SG._subs.push(fn);
    try { fn(SG._base); } catch (e) {}
  };

  function setBase(b) {
    if (b === SG._base) return;
    SG._base = b;
    SG._subs.forEach(function (fn) { try { fn(b); } catch (e) {} });
  }

  /* Switch to a specific LAN address and remember it. Passing '' goes back to
     whatever host the browser is on. */
  SG.choose = function (ip) {
    SG.chosen = ip || '';
    try { ip ? localStorage.setItem(LS_KEY, ip) : localStorage.removeItem(LS_KEY); } catch (e) {}
    setBase(ip ? (location.protocol + '//' + ip + ':' + SG.port) : (location.protocol + '//' + location.host));
  };

  /* One lookup per page, however many callers ask. Anyone who asks after the answer
     is in gets it straight back. */
  SG._waiting = [];
  SG._loading = false;

  SG.load = function (cb) {
    if (SG.ready) { if (cb) cb(SG); return; }
    if (cb) SG._waiting.push(cb);
    if (SG._loading) return;
    SG._loading = true;
    SG._fetch();
  };

  SG._done = function () {
    SG.ready = true;
    SG._loading = false;
    var q = SG._waiting; SG._waiting = [];
    q.forEach(function (fn) { try { fn(SG); } catch (e) {} });
  };

  SG._fetch = function () {
    fetch('/netinfo').then(function (r) { return r.json(); }).then(function (n) {
      SG.ips = (n && n.ips) || [];
      if (n && n.port) SG.port = String(n.port);

      // Only override the address when the browser is on loopback. If the panel was
      // opened from another device the host in the bar already works everywhere.
      if (SG.localOnly && SG.ips.length) {
        var saved = '';
        try { saved = localStorage.getItem(LS_KEY) || ''; } catch (e) {}
        SG.choose(SG.ips.indexOf(saved) >= 0 ? saved : SG.ips[0]);
      }
      SG._done();
    }).catch(function () { SG._done(); });
  };

  /* Copy text and flash the button that asked for it. navigator.clipboard needs a
     secure context — over plain http on a LAN address it is usually absent, which is
     exactly the case this feature exists for — so the textarea fallback is not
     optional here, it is the path that actually runs on the network. */
  SG.copy = function (text, btn) {
    var old = btn ? btn.textContent : '';
    function done(okText) {
      if (!btn) return;
      btn.textContent = okText;
      setTimeout(function () { btn.textContent = old; }, 1400);
    }
    function fallback() {
      var t = document.createElement('textarea');
      t.value = text;
      t.setAttribute('readonly', '');
      t.style.position = 'fixed';
      t.style.top = '-1000px';
      document.body.appendChild(t);
      t.select();
      t.setSelectionRange(0, text.length);   // iOS ignores select() alone
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      t.remove();
      done(ok ? 'Copied!' : 'Press Ctrl+C');
      return ok;
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done('Copied!'); }, fallback);
    } else fallback();
  };

  window.SGLinks = SG;
  SG.load();
})();
