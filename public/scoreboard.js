/* StreamGraphics — Scoreboard control panel. Sends actions; reflects live state. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var sb = null, editing = null; // id of a field being edited (don't clobber it)

  function send(a) {
    return fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).catch(function () {});
  }
  function fmt(v) { return v == null ? '--' : String(v); }

  /* ---- build the per-game +/- boxes for each team ---- */
  function buildGames(teamIdx) {
    var wrap = $('games' + teamIdx), html = '';
    for (var g = 0; g < 3; g++) {
      html += '<div class="gamebox" data-g="' + g + '">'
            + '<div class="gl">Game ' + (g + 1) + '</div>'
            + '<div class="gv" data-gv="' + g + '">--</div>'
            + '<div class="pm"><button data-d="-1">−</button><button data-d="1">+</button></div>'
            + '</div>';
    }
    wrap.innerHTML = html;
    wrap.querySelectorAll('.pm button').forEach(function (b) {
      b.onclick = function () {
        var g = +b.closest('.gamebox').dataset.g;
        send({ type: 'sb_score', team: teamIdx, game: g, delta: +b.dataset.d });
      };
    });
    // click a game box (not the buttons) to make it the active/highlighted column
    wrap.querySelectorAll('.gamebox').forEach(function (box) {
      box.addEventListener('click', function (e) {
        if (e.target.tagName === 'BUTTON') return;
        send({ type: 'sb_setActive', game: +box.dataset.g });
      });
    });
  }
  buildGames(0); buildGames(1);

  /* ---- team name/seed/colour fields ---- */
  document.querySelectorAll('.teamcard').forEach(function (card) {
    var ti = +card.dataset.team;
    card.querySelectorAll('[data-f]').forEach(function (inp) {
      inp.addEventListener('focus', function () { editing = 't' + ti + inp.dataset.f; });
      inp.addEventListener('blur', function () { editing = null; });
      inp.addEventListener('input', function () {
        var a = { type: 'sb_team', team: ti }; a[inp.dataset.f] = inp.value; send(a);
      });
    });
  });

  // clear row/text colour buttons -> set that field back to "" (unset)
  document.querySelectorAll('.clr').forEach(function (b) {
    b.onclick = function () {
      var ti = +b.closest('.teamcard').dataset.team;
      var a = { type: 'sb_team', team: ti }; a[b.dataset.clr] = ''; send(a);
    };
  });

  /* ---- match info ---- */
  [['mPresenter','presenter'],['mTitle','title'],['mBracket','bracketLabel'],['mEventLogo','eventLogoUrl']].forEach(function (p) {
    var el = $(p[0]);
    el.addEventListener('focus', function () { editing = p[0]; });
    el.addEventListener('blur', function () { editing = null; });
    el.addEventListener('input', function () { var a = { type: 'sb_meta' }; a[p[1]] = el.value; send(a); });
  });

  /* ---- match buttons ---- */
  $('btnRestart').onclick = function () { send({ type: 'sb_restart' }); };
  $('btnNextGame').onclick = function () {
    if (!sb) return;
    // find first game that is "--" for either team
    var next = -1;
    for (var g = 0; g < sb.gamesCount; g++) { if (sb.teams[0].games[g] == null || sb.teams[1].games[g] == null) { next = g; break; } }
    if (next >= 0) send({ type: 'sb_startGame', game: next });
  };
  $('btnBackGame').onclick = function () { send({ type: 'sb_backGame' }); };

  // event-logo placement + size
  $('mLogoPlace').addEventListener('focus', function () { editing = 'mLogoPlace'; });
  $('mLogoPlace').addEventListener('blur', function () { editing = null; });
  $('mLogoPlace').onchange = function () { send({ type: 'sb_meta', eventLogoPlacement: $('mLogoPlace').value }); };
  $('mLogoSize').addEventListener('focus', function () { editing = 'mLogoSize'; });
  $('mLogoSize').addEventListener('blur', function () { editing = null; });
  $('mLogoSize').oninput = function () { $('mLogoSizeV').textContent = $('mLogoSize').value; send({ type: 'sb_meta', eventLogoSize: +$('mLogoSize').value }); };
  $('btnShow').onclick = function () { send({ type: 'sb_show' }); };
  $('btnHide').onclick = function () { send({ type: 'sb_hide' }); };

  /* ---- look ---- */
  function pushStyle() {
    send({ type: 'sb_style', style: {
      accent: $('stAccent').value, bracketColor: $('stBracket').value,
      animation: $('stAnim').value, backdropUrl: $('stBackdrop').value.trim()
    }});
  }
  ['stAccent','stBracket','stAnim','stBackdrop'].forEach(function (id) {
    $(id).addEventListener('focus', function () { editing = id; });
    $(id).addEventListener('blur', function () { editing = null; });
    $(id).oninput = pushStyle;
  });
  document.querySelectorAll('#posGrid button').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('#posGrid button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); send({ type: 'sb_style', style: { position: b.dataset.pos } });
    };
  });

  /* ---- Browse for a local image: upload it, then use the returned URL ---- */
  function uploadFile(file, done) {
    var r = new FileReader();
    r.onload = function () {
      fetch('/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, data: r.result }) })
        .then(function (x) { return x.json(); })
        .then(function (res) { if (res && res.ok && res.url) done(res.url); else alert('Upload failed - try a PNG/JPG under ~15MB.'); })
        .catch(function () { alert('Upload failed.'); });
    };
    r.readAsDataURL(file);
  }
  document.querySelectorAll('[data-browse-team]').forEach(function (inp) {
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return; var ti = +inp.dataset.browseTeam;
      uploadFile(f, function (url) { send({ type: 'sb_team', team: ti, logoUrl: url }); }); inp.value = '';
    };
  });
  document.querySelectorAll('[data-browse-meta]').forEach(function (inp) {
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return; var key = inp.dataset.browseMeta;
      uploadFile(f, function (url) { var a = { type: 'sb_meta' }; a[key] = url; send(a); }); inp.value = '';
    };
  });
  document.querySelectorAll('[data-browse-style]').forEach(function (inp) {
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return; var key = inp.dataset.browseStyle;
      uploadFile(f, function (url) { var st = {}; st[key] = url; send({ type: 'sb_style', style: st }); }); inp.value = '';
    };
  });

  /* ---- Team Library (mail-merge): pick a team to fill a match side ---- */
  var lib = [], libSig = '';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function resolveLogo(logo) {
    logo = String(logo || '').trim();
    if (!logo) return '';
    if (/^(https?:)?\/\//i.test(logo) || logo.charAt(0) === '/' || /^data:/.test(logo)) return logo;
    return '/logos/' + logo; // bare filename from the sheet -> the logos folder
  }
  function reflectLibrary(library) {
    lib = (library && library.teams) || [];
    $('libCount').textContent = lib.length ? '· ' + lib.length + ' teams' : '· empty';
    var sig = lib.length + '#' + lib.map(function (t) { return t.name; }).join('|');
    if (sig === libSig) return;
    libSig = sig;
    document.querySelectorAll('.libteam').forEach(function (sel) {
      sel.innerHTML = '<option value="">— load team from library —</option>' +
        lib.map(function (t, i) {
          var label = t.name || t.players.slice(0, 2).join(' / ') || ('Team ' + (i + 1));
          return '<option value="' + i + '">' + esc(label) + '</option>';
        }).join('');
    });
  }
  document.querySelectorAll('.libteam').forEach(function (sel) {
    sel.onchange = function () {
      var ti = +sel.dataset.team, t = lib[+sel.value];
      if (!t) return;
      // seed comes from the sheet only if it had a Rank/Seed column; otherwise blank
      // (so unranked tournaments show no "(n)" at all).
      send({ type: 'sb_team', team: ti, rowColor: t.rowColor || '', textColor: t.textColor || '',
             logoUrl: resolveLogo(t.logo), seed: t.seed || '', p1: t.players[0] || '', p2: t.players[1] || '' });
      var card = document.querySelector('.teamcard[data-team="' + ti + '"]');
      card.querySelectorAll('.libplayer').forEach(function (ps) {
        ps.disabled = false;
        var want = ps.dataset.slot === 'p2' ? 1 : 0;
        ps.innerHTML = t.players.map(function (p, j) { return '<option' + (j === want ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('');
      });
    };
  });
  document.querySelectorAll('.libplayer').forEach(function (ps) {
    ps.onchange = function () { var a = { type: 'sb_team', team: +ps.dataset.team }; a[ps.dataset.slot] = ps.value; send(a); };
  });
  // CSV import (his columns: TeamName, TeamLogo, TeamColor, TeamHex, TextColor, Player1..6)
  function parseCSV(text) {
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  function csvToTeams(text) {
    var rows = parseCSV(text).filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    if (rows.length < 2) return [];
    var hdr = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var idx = function (names) { for (var n = 0; n < names.length; n++) { var k = hdr.indexOf(names[n]); if (k >= 0) return k; } return -1; };
    var iName = idx(['teamname', 'name', 'team']), iLogo = idx(['teamlogo', 'logo']),
        iHex = idx(['teamhex', 'hex', 'rowcolor', 'color']), iText = idx(['textcolor', 'text']),
        iSeed = idx(['seed', 'rank', 'ranking', 'seeding']); // OPTIONAL \u2014 omit for unranked events
    var pcols = []; hdr.forEach(function (h, k) { if (/^player/.test(h)) pcols.push(k); });
    var clean = function (v) { return String(v == null ? '' : v).replace(/\u00a0/g, ' ').trim(); };
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r], players = pcols.map(function (k) { return clean(row[k]); }).filter(Boolean);
      var name = iName >= 0 ? clean(row[iName]) : '';
      if (!name && !players.length) continue;                 // sponsor column is OPTIONAL
      out.push({ name: name, logo: iLogo >= 0 ? clean(row[iLogo]) : '', rowColor: iHex >= 0 ? clean(row[iHex]) : '',
                 textColor: iText >= 0 ? clean(row[iText]) : '', seed: iSeed >= 0 ? clean(row[iSeed]) : '', players: players });
    }
    return out;
  }
  $('libImport').onchange = function () {
    var f = $('libImport').files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      var teams = csvToTeams(r.result);
      if (!teams.length) { alert('No teams found in that CSV — expected a header row with TeamName, TeamHex, TextColor, TeamLogo, Player1…'); return; }
      send({ type: 'lib_import', teams: teams });
    };
    r.readAsText(f); $('libImport').value = '';
  };
  $('libClear').onclick = function () { if (confirm('Clear the whole team library?')) send({ type: 'lib_clear' }); };

  /* ---- reflect server state ---- */
  function reflect(s) {
    sb = s;
    var live = !!s.visible;
    $('airState').textContent = live ? 'ON AIR' : 'OFF AIR';
    $('airState').classList.toggle('live', live);

    s.teams.forEach(function (tm, ti) {
      var card = document.querySelector('.teamcard[data-team="' + ti + '"]');
      card.querySelectorAll('[data-f]').forEach(function (inp) {
        var f = inp.dataset.f, key = 't' + ti + f;
        if (editing === key) return;
        var val = tm[f];
        if (inp.type === 'color') {
          // empty rowColor/textColor means "unset" — show a neutral default in the picker
          inp.value = (val && /^#/.test(val)) ? val : (f === 'textColor' ? '#111111' : (f === 'rowColor' ? '#ffffff' : (tm.color || '#888888')));
        } else {
          inp.value = val == null ? '' : val;
        }
      });
      $('sw' + ti).style.background = tm.color || '#888';
      // game boxes
      for (var g = 0; g < 3; g++) {
        var gv = $('games' + ti).querySelector('[data-gv="' + g + '"]');
        if (gv) gv.textContent = fmt(tm.games[g]);
        var box = $('games' + ti).querySelectorAll('.gamebox')[g];
        if (box) box.classList.toggle('active', g === (s.activeGame | 0));
      }
    });

    if (editing !== 'mPresenter') $('mPresenter').value = s.presenter || '';
    if (editing !== 'mTitle') $('mTitle').value = s.title || '';
    if (editing !== 'mBracket') $('mBracket').value = s.bracketLabel || '';
    if (editing !== 'mEventLogo') $('mEventLogo').value = s.eventLogoUrl || '';
    if (editing !== 'mLogoPlace') $('mLogoPlace').value = s.eventLogoPlacement || 'inline';
    if (editing !== 'mLogoSize') { $('mLogoSize').value = s.eventLogoSize || 150; $('mLogoSizeV').textContent = s.eventLogoSize || 150; }
    if (s.style) {
      if (editing !== 'stAccent') $('stAccent').value = s.style.accent || '#1e64d2';
      if (editing !== 'stBracket') $('stBracket').value = s.style.bracketColor || '#7a1420';
      if (editing !== 'stAnim') $('stAnim').value = s.style.animation || 'slide-up';
      if (editing !== 'stBackdrop') $('stBackdrop').value = s.style.backdropUrl || '';
      if ($('chroma')) $('chroma').checked = !!s.style.chroma;
      if (s.style.position) document.querySelectorAll('#posGrid button').forEach(function (b) {
        b.classList.toggle('on', b.dataset.pos === s.style.position);
      });
    }

    // compact preview
    var pv = '';
    s.teams.forEach(function (tm) {
      var cells = '';
      for (var g = 0; g < s.gamesCount; g++) {
        cells += '<span style="display:inline-block;width:34px;text-align:center;font-weight:800;'
              + (g === (s.activeGame|0) ? 'color:#8ab4ff;' : 'color:#e7edf5;') + '">' + fmt(tm.games[g]) + '</span>';
      }
      pv += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #26303f">'
          + '<span style="width:10px;height:10px;border-radius:2px;background:' + (tm.color||'#888') + ';display:inline-block"></span>'
          + '<span style="flex:1;color:#e7edf5;font-weight:700">' + (tm.p1||'') + ' / ' + (tm.p2||'')
          + (tm.seed ? ' <span style="color:#8da0b8">(' + tm.seed + ')</span>' : '') + '</span>' + cells + '</div>';
    });
    $('pvRows').innerHTML = pv;
  }

  function connect() {
    var es = new EventSource('/events');
    es.onopen = function () { $('conn').className = 'conn ok'; $('connTxt').textContent = 'live'; };
    es.onmessage = function (e) { try { var m = JSON.parse(e.data); if (m.state && m.state.scoreboard) reflect(m.state.scoreboard); if (m.state && m.state.library) reflectLibrary(m.state.library); } catch (x) {} };
    es.onerror = function () { $('conn').className = 'conn off'; $('connTxt').textContent = 'reconnecting…'; };
  }
  connect();
  $('outUrl').textContent = location.protocol + '//' + location.host + '/scoreboard-output';

  // green-screen toggle + copy link
  $('chroma').onchange = function () { send({ type: 'sb_style', style: { chroma: $('chroma').checked ? 'green' : '' } }); };
  $('copyBtn').onclick = function () {
    var url = $('outUrl').textContent, b = $('copyBtn'), old = b.textContent;
    var ok = function () { b.textContent = 'Copied!'; setTimeout(function () { b.textContent = old; }, 1200); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(ok, ok);
    else { var t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); ok(); } catch (e) {} t.remove(); }
  };
})();
