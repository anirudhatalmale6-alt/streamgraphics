/* StreamGraphics — Scoreboard control panel. Sends actions; reflects live state. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var sb = null, editing = null; // id of a field being edited (don't clobber it)
  var BOARD = new URLSearchParams(location.search).get('board') || '';   // which scoreboard this panel drives
  function pickBoard(state) { var list = (state && state.scoreboards) || []; return (BOARD && list.filter(function (b) { return b.id === BOARD; })[0]) || list[0] || null; }

  function send(a) {
    if (a && a.board === undefined && String(a.type || '').indexOf('sb_') === 0) a.board = (sb && sb.id) || BOARD;   // target this board
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
  $('btnOnAir').onclick = function () { send({ type: 'sb_show' }); };
  $('btnOffAir').onclick = function () { send({ type: 'sb_hide' }); };

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

  /* ---- fine position nudge ----
   * The 9 anchors are deliberately fixed, so this walks the board off whichever one is
   * selected. Steps are applied to the last value the SERVER sent back, not to a counter kept
   * here, so two panels open on the same board can't drift apart. Readout updates optimistically
   * so a click feels instant; the next state push corrects it if the server clamped the value. */
  var NUDGE_MAX = 600;
  function nudgeNow(axis) { return Math.round(Number((sb && sb.style && sb.style[axis]) || 0)) || 0; }
  function showNudge(x, y) { $('nudgeV').textContent = x + ', ' + y; }
  document.querySelectorAll('#nudgePad button').forEach(function (b) {
    b.onclick = function (e) {
      var x, y;
      if (b.dataset.nreset) { x = 0; y = 0; }
      else {
        var step = e.shiftKey ? 25 : 5;
        x = nudgeNow('offsetX') + (+b.dataset.nx) * step;
        y = nudgeNow('offsetY') + (+b.dataset.ny) * step;
        x = Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, x));
        y = Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, y));
      }
      showNudge(x, y);
      send({ type: 'sb_style', style: { offsetX: x, offsetY: y } });
    };
  });

  /* ---- Browse for a local image: upload it, then use the returned URL ---- */
  function uploadFile(file, done) {
    if (file.size > 25 * 1024 * 1024) { alert('That image is ' + Math.round(file.size / 1048576) + ' MB - too large. Use one under 25 MB, or drop it in the "media" folder and reference it by URL.'); return; }
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

  // download helper + a sample template (so headings are always right) + export current
  function downloadCSV(name, text) {
    var blob = new Blob([text], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function csvField(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  $('libSample').onclick = function () {
    var rows = [
      'TeamName,Seed,TeamLogo,TeamHex,TextColor,Player1,Player2,Player3,Player4,Player5,Player6',
      'Oceanfront Recovery,1,ucla.png,#bdbdbd,#474747,Evan Cory,Casey Patterson,,,,',
      'Citrus Ford,2,usc.png,#f19844,#474747,Taylor Crabb,Taylor Sander,,,,',
      ',,,,,,,,,,   (Seed and TeamName are OPTIONAL - leave Seed blank for unranked events)'
    ];
    downloadCSV('team-library-sample.csv', rows.join('\n'));
  };
  $('libExport').onclick = function () {
    if (!lib.length) { alert('Library is empty - nothing to export.'); return; }
    var maxP = lib.reduce(function (m, t) { return Math.max(m, (t.players || []).length); }, 0) || 2;
    var hdr = ['TeamName', 'Seed', 'TeamLogo', 'TeamHex', 'TextColor'];
    for (var i = 1; i <= maxP; i++) hdr.push('Player' + i);
    var out = [hdr.join(',')];
    lib.forEach(function (t) {
      var row = [t.name, t.seed || '', t.logo, t.rowColor, t.textColor];
      for (var j = 0; j < maxP; j++) row.push((t.players || [])[j] || '');
      out.push(row.map(csvField).join(','));
    });
    downloadCSV('team-library.csv', out.join('\n'));
  };

  /* ---- reflect server state ---- */
  function reflect(s) {
    sb = s;
    var live = !!s.visible;
    $('btnOnAir').classList.toggle('live', live); $('btnOffAir').classList.toggle('standby', !live);

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
      showNudge(Math.round(Number(s.style.offsetX)) || 0, Math.round(Number(s.style.offsetY)) || 0);
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
    var es = SGLive('/events');
    es.onopen = function () { $('conn').className = 'conn ok'; $('connTxt').textContent = 'live'; };
    es.onmessage = function (e) { try { var m = JSON.parse(e.data); if (m.state) { var bd = pickBoard(m.state); if (bd) reflect(bd); reflectBoards(m.state.scoreboards || []); } if (m.state && m.state.library) reflectLibrary(m.state.library); } catch (x) {} };
    es.onerror = function () { $('conn').className = 'conn off'; $('connTxt').textContent = 'reconnecting…'; };
  }
  connect();
  /* The output link. Two things move it: picking a different court (adds ?board=)
     and sg-links.js resolving this computer's LAN address, which is the one that
     works when it is pasted into OBS/vMix on another machine. Keep the path in one
     variable so either can repaint it. */
  var outPath = '/scoreboard-output';
  function paintOut() { $('outUrl').textContent = SGLinks.url(outPath); }
  SGLinks.onbase(paintOut);

  /* The big-button Scorer is normally run from a tablet at the desk, so its link has the same
     trap the prompter remote had: a relative href reads as localhost here, and localhost typed
     into a tablet points the tablet at itself. Address + QR, not just a clickable link. */
  var scorerPath = '/scorer';
  var scorerLink = SGLinks.phoneLink({
    path: function () { return scorerPath; },
    link: $('scorerLink'),
    out:  $('scorerUrl'),
    copy: $('scorerCopy'),
    qr:   $('scorerQr'),
    box:  $('scorerQrBox')
  });

  /* ---- multiple scoreboards ("courts") ---- */
  function escH(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function reflectBoards(boards) {
    var selEl = $('boardSel'); if (!selEl) return;
    var cur = (sb && sb.id) || BOARD || (boards[0] && boards[0].id) || '';
    selEl.innerHTML = boards.map(function (b) { return '<option value="' + b.id + '"' + (b.id === cur ? ' selected' : '') + '>' + escH(b.name) + '</option>'; }).join('');
    $('boardDelete').disabled = boards.length <= 1;
    scorerPath = '/scorer?board=' + encodeURIComponent(cur);
    scorerLink.refresh();          // href, the visible address AND an open QR all follow the board
    outPath = '/scoreboard-output?board=' + encodeURIComponent(cur);
    paintOut();
  }
  function goBoard(id) { location.search = '?board=' + encodeURIComponent(id); }
  $('boardSel').onchange = function () { goBoard($('boardSel').value); };
  $('boardRename').onclick = function () { var n = prompt('Rename this scoreboard:', (sb && sb.name) || ''); if (n != null && n.trim()) send({ type: 'sb_board_rename', board: (sb && sb.id) || BOARD, name: n.trim() }); };
  $('boardDelete').onclick = function () {
    if (!confirm('Delete this scoreboard? Its scores are lost.')) return;
    var delId = (sb && sb.id) || BOARD;
    send({ type: 'sb_board_delete', board: delId }).then(function () { fetch('/state').then(function (r) { return r.json(); }).then(function (s) { var b = (s.state.scoreboards || [])[0]; if (b) goBoard(b.id); }); });
  };
  $('boardNew').onclick = function () {
    var n = prompt('New scoreboard name:', 'Court ' + Date.now().toString().slice(-3)); if (n == null) return;
    send({ type: 'sb_board_add', name: n.trim() || 'Court' }).then(function () {
      fetch('/state').then(function (r) { return r.json(); }).then(function (s) { var list = s.state.scoreboards || []; var b = list[list.length - 1]; if (b) goBoard(b.id); });
    });
  };

  // green-screen toggle + copy link
  $('chroma').onchange = function () { send({ type: 'sb_style', style: { chroma: $('chroma').checked ? 'green' : '' } }); };
  $('copyBtn').onclick = function () { SGLinks.copy($('outUrl').textContent, this); };
})();
