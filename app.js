// Wordle Painter UI. Game logic lives in wordle.js; word lists in words.js.
(() => {
  const W = window.Wordle;
  const ANSWERS = window.WORDS_ANSWERS.split(' ');
  const EXTRA = window.WORDS_EXTRA.split(' ');
  const ALL = ANSWERS.concat(EXTRA); // common words first, so they're suggested first
  const ANSWER_SET = new Set(ANSWERS);
  const ALL_SET = new Set(ALL);
  const isWord = w => ALL_SET.has(w);
  const ROWS = 6, COLS = 5;

  // 5 rows each; the 6th (answer) row is always green.
  const PRESETS = [
    { name: 'Heart', rows: ['01010', '11111', '11111', '01110', '00100'] },
    { name: 'Smile', rows: ['00000', '01010', '00000', '10001', '01110'] },
    { name: 'Invader', rows: ['01010', '11111', '10101', '11111', '01010'] },
    { name: 'Rocket', rows: ['00100', '01110', '01110', '11111', '10101'] },
    { name: 'Arrow', rows: ['00100', '01110', '11111', '00100', '00100'] },
    { name: 'Diamond', rows: ['00100', '01110', '11111', '01110', '00100'] },
    { name: 'Ring', rows: ['01110', '10001', '10001', '10001', '01110'] },
    { name: 'Moon', rows: ['01110', '11000', '11000', '11000', '01110'] },
    { name: 'X', rows: ['10001', '01010', '00100', '01010', '10001'] },
    { name: 'Cross', rows: ['20002', '02020', '00200', '02020', '20002'] },
    { name: 'Eyes', rows: ['00000', '11011', '11011', '00000', '00000'] },
    { name: 'Stairs', rows: ['20000', '22000', '22200', '22220', '00000'] },
    { name: 'Wave', rows: ['10000', '01000', '00100', '00010', '00001'] },
    { name: 'Checker', rows: ['10101', '01010', '10101', '01010', '10101'] },
  ];

  const state = {
    grid: Array.from({ length: ROWS }, (_, r) => Array(COLS).fill(r === ROWS - 1 ? 2 : 0)),
    answer: '',
    brush: 1,
    count: ROWS, // guesses taken; row count-1 is the answer row
    commonOnly: false,
    unique: true,
    hard: false,
    offsets: Array(ROWS).fill(0),
    pins: {}, // row -> word typed or pinned by the user
    daily: null, // { date, id, hidden } when using a real Wordle answer
    revealed: new Set(), // guess rows shown while the daily answer is hidden
    editing: null, // row currently being typed into
  };
  // Remembers what was painted in a row while it's acting as the answer row.
  let stash = {};
  let lastRows = null;
  let draft = '';

  const $ = s => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const hidden = () => !!(state.daily && state.daily.hidden);
  const activePins = () => Object.fromEntries(Object.entries(state.pins).filter(([r]) => +r < state.count - 1));

  // ---------- Undo / redo ----------
  const undoStack = [], redoStack = [];
  const snapshot = () => JSON.stringify({ grid: state.grid, count: state.count, pins: state.pins, stash });
  function restore(snap) {
    const s = JSON.parse(snap);
    state.grid = s.grid; state.count = s.count; state.pins = s.pins; stash = s.stash;
    state.offsets.fill(0);
    renderPaint(); update();
  }
  function remember(snap = snapshot()) {
    undoStack.push(snap);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    renderHistory();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); renderHistory(); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); renderHistory(); }
  function renderHistory() { $('#undoBtn').disabled = !undoStack.length; $('#redoBtn').disabled = !redoStack.length; }
  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);

  // ---------- URL state ----------
  let pendingDaily = null;
  function loadHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const g = h.get('g');
    if (g && /^[012]{25}$/.test(g)) for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) state.grid[r][c] = +g[r * 5 + c];
    const a = (h.get('a') || '').toLowerCase();
    if (/^[a-z]{5}$/.test(a)) state.answer = a;
    if (h.get('common') === '1') state.commonOnly = true;
    if (h.get('unique') === '0') state.unique = false;
    if (h.get('hard') === '1') state.hard = true;
    const n = +h.get('n');
    if (n >= 1 && n <= ROWS) state.count = n;
    state.grid[state.count - 1].fill(2);
    for (const part of (h.get('p') || '').split('.')) {
      const m = /^([0-4])([a-z]{5})$/.exec(part);
      if (m) state.pins[+m[1]] = m[2];
    }
    const d = h.get('d');
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) pendingDaily = d;
    return !!g;
  }
  function saveHash() {
    const p = new URLSearchParams();
    p.set('g', state.grid.slice(0, 5).map(r => r.join('')).join(''));
    if (state.daily) p.set('d', state.daily.date); // never put a real puzzle's answer in the URL
    else if (state.answer) p.set('a', state.answer);
    if (state.count !== ROWS) p.set('n', state.count);
    if (state.hard) p.set('hard', '1');
    if (state.commonOnly) p.set('common', '1');
    if (!state.unique) p.set('unique', '0');
    const pins = Object.entries(state.pins).map(([r, w]) => r + w).join('.');
    if (pins) p.set('p', pins);
    history.replaceState(null, '', '#' + p.toString());
  }

  // ---------- Paint grid ----------
  const paint = $('#paint');
  const paintTiles = [];
  const LOCK_SVG = '<svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  for (let r = 0; r < ROWS; r++) {
    const row = el('div', 'row');
    row.appendChild(el('span', 'row-flag', '!'));
    paintTiles.push([]);
    for (let c = 0; c < COLS; c++) {
      const t = el('div', 'tile');
      t.dataset.r = r; t.dataset.c = c;
      row.appendChild(t);
      paintTiles[r].push(t);
    }
    row.insertAdjacentHTML('beforeend', LOCK_SVG);
    paint.appendChild(row);
  }
  function renderPaint() {
    for (let r = 0; r < ROWS; r++) {
      paint.children[r].classList.toggle('locked', r === state.count - 1);
      paint.children[r].classList.toggle('unused', r >= state.count);
      for (let c = 0; c < COLS; c++)
        paintTiles[r][c].className = r < state.count ? 'tile c' + state.grid[r][c] : 'tile unused';
    }
    document.querySelectorAll('.seg-btn').forEach(b => b.setAttribute('aria-pressed', +b.dataset.count === state.count));
  }

  function setCount(n, record = true) {
    if (n === state.count) return;
    if (record) remember();
    const old = state.count - 1;
    state.grid[old] = stash[old] || Array(COLS).fill(0);
    delete stash[old];
    stash[n - 1] = state.grid[n - 1];
    state.grid[n - 1] = Array(COLS).fill(2);
    state.count = n;
    state.offsets.fill(0);
    renderPaint(); update();
  }
  document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => setCount(+b.dataset.count)));

  let painting = false, paintVal = 0, strokeSnap = null;
  function tileAt(x, y) {
    const t = document.elementFromPoint(x, y);
    return t && t.closest ? t.closest('#paint .tile') : null;
  }
  function paintTile(t) {
    if (!t) return;
    const r = +t.dataset.r, c = +t.dataset.c;
    if (r >= state.count) return;
    if (r === state.count - 1) {
      paint.children[r].classList.remove('shake'); void paint.children[r].offsetWidth; paint.children[r].classList.add('shake');
      return;
    }
    if (state.grid[r][c] !== paintVal) {
      if (strokeSnap) { remember(strokeSnap); strokeSnap = null; }
      state.grid[r][c] = paintVal;
      delete state.pins[r]; // repainting a row replaces any word typed for it
      state.offsets[r] = 0;
      renderPaint();
      update();
    }
  }
  paint.addEventListener('pointerdown', e => {
    const t = e.target.closest('.tile');
    if (!t) return;
    e.preventDefault();
    const r = +t.dataset.r, c = +t.dataset.c;
    paintVal = state.grid[r][c] === state.brush && r < state.count - 1 ? 0 : state.brush;
    painting = true;
    strokeSnap = snapshot();
    paintTile(t);
  });
  window.addEventListener('pointermove', e => { if (painting) paintTile(tileAt(e.clientX, e.clientY)); });
  window.addEventListener('pointerup', () => { painting = false; strokeSnap = null; });
  window.addEventListener('pointercancel', () => { painting = false; strokeSnap = null; });

  function setBrush(b) {
    state.brush = b;
    document.querySelectorAll('.brush').forEach(x => x.setAttribute('aria-pressed', +x.dataset.brush === b));
  }
  document.querySelectorAll('.brush').forEach(b => b.addEventListener('click', () => setBrush(+b.dataset.brush)));
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || $('#modal').open) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod || e.altKey) return;
    if (e.key === '1' || e.key === '2' || e.key === '3') setBrush(+e.key - 1);
  });

  function setPicture(rows) {
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < 5; c++) state.grid[r][c] = rows[r][c];
    state.pins = {};
    state.offsets.fill(0);
    renderPaint(); update();
  }
  const presetWrap = $('#presets');
  for (const p of PRESETS) {
    const b = el('button', 'preset');
    b.title = p.name;
    b.innerHTML = `<span class="thumb">${p.rows.concat('22222').map(row => row.split('').map(v => `<i class="c${v}"></i>`).join('')).join('')}</span><span class="pname">${p.name}</span>`;
    b.addEventListener('click', () => {
      remember();
      setCount(ROWS, false);
      setPicture(p.rows.map(s => s.split('').map(Number)));
    });
    presetWrap.appendChild(b);
  }
  $('#clearPic').addEventListener('click', () => { remember(); setPicture(Array.from({ length: state.count - 1 }, () => Array(5).fill(0))); });
  $('#randomPic').addEventListener('click', () => {
    remember();
    // Random but achievable: take patterns from real words when an answer is set.
    const rows = [];
    for (let r = 0; r < state.count - 1; r++) {
      if (state.answer.length === 5) {
        const w = ALL[Math.floor(Math.random() * ALL.length)];
        const p = W.score(w, state.answer);
        if (W.encode(p) === W.ALL_GREEN) { r--; continue; }
        rows.push(p);
      } else rows.push(Array.from({ length: 5 }, () => [0, 0, 1, 2][Math.floor(Math.random() * 4)]));
    }
    setPicture(rows);
  });

  // ---------- Modal ----------
  const modal = $('#modal');
  function ask({ title, body, ok, cancel = 'Cancel' }) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = body;
    $('#modalOk').textContent = ok;
    $('#modalCancel').textContent = cancel;
    modal.returnValue = '';
    modal.showModal();
    $('#modalCancel').focus();
    return new Promise(res => modal.addEventListener('close', () => res(modal.returnValue === 'ok'), { once: true }));
  }

  // ---------- Answer input ----------
  const input = $('#answerInput');
  const box = $('#answerBox');
  const slots = [...box.querySelectorAll('.slot')];
  const prettyDate = d => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  function localDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function dailyName(daily) {
    return `${daily.date === localDate() ? "Today's Wordle" : `Wordle for ${prettyDate(daily.date)}`} #${daily.id.toLocaleString()}`;
  }
  function renderAnswer() {
    const isHidden = hidden();
    input.value = isHidden ? '' : state.answer;
    slots.forEach((s, i) => {
      const ch = isHidden ? '?' : state.answer[i] || '';
      if (s.textContent !== ch) s.textContent = ch;
      s.classList.toggle('filled', !!ch && !isHidden);
      s.classList.toggle('masked', isHidden);
      s.classList.toggle('cursor', !isHidden && i === Math.min(state.answer.length, 4));
    });
    const note = $('#answerNote');
    note.className = 'answer-note';
    if (state.daily) note.textContent = isHidden ? 'Type to replace it with your own word' : dailyName(state.daily);
    else if (state.answer.length < 5) note.textContent = state.answer ? `${5 - state.answer.length} more letter${state.answer.length === 4 ? '' : 's'}` : 'Tap the boxes and type a word';
    else if (ANSWER_SET.has(state.answer)) note.textContent = 'In the common word list';
    else if (ALL_SET.has(state.answer)) note.textContent = 'Valid Wordle word';
    else { note.textContent = "Not in Wordle's word list, but we'll still solve for it"; note.className = 'answer-note warn'; }

    $('#dailyStart').hidden = !!state.daily;
    $('#dailyBar').hidden = !isHidden;
    if (isHidden) $('#dailyLabel').textContent = `${dailyName(state.daily)} · answer hidden`;
    $('#saveLettersNote').textContent = isHidden ? 'Contains spoilers for this puzzle' : 'Shows every guess';
  }
  function setAnswer(word, daily = null) {
    state.answer = word;
    state.daily = daily;
    state.revealed.clear();
    state.offsets.fill(0);
    renderAnswer(); update(true); renderFound();
  }
  input.addEventListener('input', () => setAnswer(input.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, 5)));
  input.addEventListener('focus', () => box.classList.add('focus'));
  input.addEventListener('blur', () => box.classList.remove('focus'));
  $('#randomAnswer').addEventListener('click', () => setAnswer(ANSWERS[Math.floor(Math.random() * ANSWERS.length)]));

  // ---------- Today's Wordle (spoiler-gated) ----------
  let dailyData = null;
  async function loadDaily() {
    if (!dailyData) {
      const r = await fetch('daily.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      dailyData = await r.json();
    }
    return dailyData;
  }
  // Stored as base64(ROT13(word)) so nobody gets spoiled by glancing at the file.
  const decode = w => atob(w).replace(/[a-z]/g, c => String.fromCharCode((c.charCodeAt(0) - 84) % 26 + 97));

  async function useDaily(date) {
    let entry;
    try { entry = (await loadDaily())[date]; } catch { toast("Couldn't load the daily puzzle. Try again in a bit."); return; }
    if (!entry) { toast(`No puzzle found for ${prettyDate(date)}.`); return; }
    const isToday = date === localDate();
    const ok = await ask({
      title: 'Spoiler warning',
      body: `<p>This uses the answer to <b>${isToday ? "today's Wordle" : `the Wordle for ${prettyDate(date)}`} (#${entry.id.toLocaleString()})</b>.</p>` +
        `<p>The answer and the guesses stay <b>hidden</b>: you'll only see colours until you choose to reveal them.</p>` +
        `<p>The guesses give the answer away, so only reveal them if you've already played${isToday ? ' today' : ''}.</p>`,
      ok: 'Load it hidden',
    });
    if (!ok) return;
    setAnswer(decode(entry.w), { date, id: entry.id, hidden: true });
  }
  $('#dailyBtn').addEventListener('click', () => useDaily(localDate()));
  $('#dailyClear').addEventListener('click', () => setAnswer(''));
  async function revealAll() {
    const ok = await ask({
      title: 'Reveal the answer?',
      body: `<p>This shows the answer to <b>${dailyName(state.daily)}</b> and every guess. Only do this if you've already played it.</p>`,
      ok: 'Reveal everything',
    });
    if (!ok) return;
    state.daily.hidden = false;
    renderAnswer(); update(true); renderFound();
  }
  $('#dailyReveal').addEventListener('click', revealAll);

  // ---------- Solving ----------
  const indexCache = new Map();
  function getIndex(answer, commonOnly) {
    const key = answer + (commonOnly ? ':c' : ':a');
    if (!indexCache.has(key)) indexCache.set(key, W.buildIndex(answer, commonOnly ? ANSWERS : ALL));
    return indexCache.get(key);
  }

  const results = $('#results');
  const resultRows = [];
  const CHEV_L = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg>';
  const CHEV_R = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg>';
  const PIN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76V5h6v5.76l2 3.24H7z"/><path d="M8 2h8"/></svg>';
  const PIN_ON = PIN.replace('<path d="M9 10.76', '<path fill="currentColor" d="M9 10.76');
  const EYE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  for (let r = 0; r < ROWS; r++) {
    const rr = el('div', 'rrow');
    const row = el('div', 'row');
    row.dataset.r = r;
    row.appendChild(el('span', 'row-flag', '!'));
    const tiles = [];
    for (let c = 0; c < COLS; c++) { const t = el('div', 'tile'); row.appendChild(t); tiles.push(t); }
    const cyc = el('div', 'cycler');
    rr.append(row, cyc);
    results.appendChild(rr);
    resultRows.push({ row, tiles, cyc, word: null });
  }

  function cyclerHTML(info, r, rowHidden) {
    if (!info) return '';
    if (info.status === 'answer') return `<span class="tag win">Answer</span>`;
    if (info.status === 'impossible') return '<span class="tag bad">Impossible</span>';
    if (rowHidden) return `<button class="show" data-show="${r}">${EYE}Show</button>`;
    const pinned = info.pinned;
    const fixed = pinned || info.count <= 1;
    return `<button data-r="${r}" data-d="-1" ${fixed ? 'disabled' : ''} aria-label="Previous word">${CHEV_L}</button>` +
      `<span class="count">${pinned ? 'Pinned' : `${(info.idx + 1).toLocaleString()} / ${info.count.toLocaleString()}`}</span>` +
      `<button data-r="${r}" data-d="1" ${fixed ? 'disabled' : ''} aria-label="Next word">${CHEV_R}</button>` +
      `<button class="pin ${pinned ? 'on' : ''}" data-pin="${r}" title="${pinned ? 'Unpin' : 'Pin this word'}" aria-label="${pinned ? 'Unpin' : 'Pin'}">${pinned ? PIN_ON : PIN}</button>` +
      (info.repeated ? '<span class="tag rep" title="No unused word fits, so this repeats an earlier guess">repeat</span>' : '');
  }
  results.addEventListener('click', e => {
    if (!lastRows) return;
    const b = e.target.closest('button[data-r]');
    if (b) { const r = +b.dataset.r; state.offsets[r] = lastRows[r].idx + +b.dataset.d; update(true); return; }
    const pin = e.target.closest('button[data-pin]');
    if (pin) {
      const r = +pin.dataset.pin;
      remember();
      if (state.pins[r]) delete state.pins[r]; else state.pins[r] = lastRows[r].word;
      update(true); return;
    }
    const show = e.target.closest('button[data-show]');
    if (show) { state.revealed.add(+show.dataset.show); update(true); return; }
    const row = e.target.closest('.row.editable');
    if (row) startEdit(+row.dataset.r);
  });

  // ---------- Typing your own guess ----------
  const editInput = el('input', 'edit-input');
  Object.assign(editInput, { type: 'text', maxLength: 5, autocomplete: 'off', spellcheck: false });
  editInput.setAttribute('autocapitalize', 'off');
  editInput.setAttribute('aria-label', 'Type a guess for this row');
  function startEdit(r) {
    if (state.editing !== null) return;
    state.editing = r;
    draft = '';
    editInput.value = '';
    resultRows[r].row.appendChild(editInput);
    editInput.focus();
    update(true);
  }
  function endEdit(commit) {
    const r = state.editing;
    if (r === null) return;
    state.editing = null;
    editInput.remove();
    if (commit && draft.length === 5) {
      remember();
      state.pins[r] = draft;
      if (!isWord(draft)) toast(`${draft.toUpperCase()} isn't in Wordle's word list`);
    }
    update(true);
  }
  editInput.addEventListener('input', () => {
    draft = editInput.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, 5);
    editInput.value = draft;
    update(true);
  });
  editInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); endEdit(true); }
    if (e.key === 'Escape') { e.preventDefault(); endEdit(false); }
  });
  editInput.addEventListener('blur', () => endEdit(true));

  function renderResults(rows, ready, isHidden) {
    for (let r = 0; r < ROWS; r++) {
      const info = rows && rows[r];
      const rr = resultRows[r];
      const used = r < state.count;
      const editing = state.editing === r;
      const rowHidden = isHidden && !!info && (info.status === 'answer' || !state.revealed.has(r));
      const word = editing ? draft : rowHidden ? '' : info && info.word ? info.word : '';
      const colors = editing && ready && draft.length === 5 ? W.score(draft, state.answer) : state.grid[r];
      const changed = word !== rr.word && !editing;
      rr.word = editing ? null : word;
      rr.row.classList.toggle('bad', !!info && info.status === 'impossible' && !editing);
      rr.row.classList.toggle('editing', editing);
      rr.row.classList.toggle('editable', ready && used && r < state.count - 1 && !rowHidden && !editing);
      rr.row.title = rr.row.classList.contains('editable') ? 'Click to type your own word' : '';
      rr.tiles.forEach((t, c) => {
        t.className = used ? 'tile c' + colors[c] + (word || editing || rowHidden ? '' : ' empty') : 'tile unused';
        if (!editing && info && info.status === 'impossible' && info.cols.includes(c)) t.classList.add('culprit');
        t.textContent = word[c] || '';
        if (changed && word) { t.style.animationDelay = (c * 45) + 'ms'; t.classList.add('flip'); }
      });
      rr.cyc.innerHTML = editing ? '<span class="count" style="min-width:0">Enter to save · Esc to cancel</span>' : cyclerHTML(info, r, rowHidden);
    }
  }

  function update(keepFind) {
    if (!keepFind) clearFind();
    saveHash();
    const ready = state.answer.length === 5;
    const isHidden = hidden();
    let rows = null;
    if (ready) {
      rows = W.solve(state.grid.slice(0, state.count), state.answer, {
        index: getIndex(state.answer, state.commonOnly),
        fallbackIndex: state.commonOnly ? getIndex(state.answer, false) : null,
        unique: state.unique,
        offsets: state.offsets,
        hard: state.hard,
        pins: activePins(),
        isWord,
        hideLetters: isHidden,
      });
    }
    lastRows = rows;
    renderResults(rows, ready, isHidden);
    $('#resultsHint').hidden = !ready || isHidden || state.count < 2;

    // Mark problems on the paint grid too
    for (let r = 0; r < ROWS; r++) {
      const info = rows && rows[r];
      const bad = !!info && info.status === 'impossible';
      paint.children[r].classList.toggle('bad', bad);
      paintTiles[r].forEach((t, c) => t.classList.toggle('culprit', bad && info.cols.includes(c)));
    }

    // Status + problem list
    const status = $('#status');
    const problems = $('#problems');
    problems.innerHTML = '';
    const bad = rows ? rows.map((x, r) => ({ ...x, r })).filter(x => x.status === 'impossible') : [];
    const mode = state.hard ? ' in hard mode' : '';
    if (!ready) {
      status.className = 'status idle';
      status.innerHTML = '<span class="dot">…</span><div><strong>Enter an answer</strong><span class="sub">Type a 5-letter word in step 2 and the guesses appear here.</span></div>';
    } else if (!bad.length) {
      const reps = rows.filter(x => x.repeated).length;
      status.className = 'status ok';
      const sub = isHidden
        ? `Guesses are hidden so ${state.daily.date === localDate() ? "today's" : 'this'} answer isn't spoiled. <button class="link" data-reveal-all>Reveal everything</button>`
        : `Play these guesses in order${mode} to draw it.${reps ? ` ${reps} row${reps > 1 ? 's' : ''} had to repeat a word.` : ' Use the arrows to try other words.'}`;
      status.innerHTML = `<span class="dot">✓</span><div><strong>Your picture works${mode}!</strong><span class="sub">${sub}</span></div>`;
    } else {
      status.className = 'status bad';
      const who = isHidden ? 'this answer' : state.answer.toUpperCase();
      status.innerHTML = `<span class="dot">!</span><div><strong>${bad.length} row${bad.length > 1 ? 's' : ''} can't be made with ${who}${mode}</strong><span class="sub">Problem rows are outlined in red and the tiles causing it are ringed. Not sure which word to use? Try <b>Find answers that fit my picture</b> in step 2.</span></div>`;
      for (const b of bad) {
        const fixes = [];
        if (b.canWiden) fixes.push('<button class="link" data-widen>Allow uncommon words</button>');
        if (b.kind === 'early') fixes.push(`<button class="link" data-solve-on="${b.r + 1}">Make row ${b.r + 1} the answer</button>`);
        if (b.kind === 'pin' && b.actual) fixes.push(`<button class="link" data-match="${b.r}">Repaint row to match</button>`);
        if (b.kind === 'pin') fixes.push(`<button class="link" data-unpin="${b.r}">Remove your word</button>`);
        if (b.kind === 'hard' || b.kind === 'hard-chain') fixes.push('<button class="link" data-easy>Turn off hard mode</button>');
        const li = el('li');
        li.innerHTML = `<span class="rn">Row ${b.r + 1}</span><span>${b.reason}${fixes.length ? ' ' + fixes.join(' · ') : ''}</span>`;
        problems.appendChild(li);
      }
    }
    $('#copyWords').disabled = !ready || !!bad.length;
  }

  function onFix(e) {
    if (e.target.closest('[data-widen]')) { state.commonOnly = false; $('#optCommon').checked = false; update(); }
    if (e.target.closest('[data-easy]')) { state.hard = false; $('#optHard').checked = false; update(); }
    if (e.target.closest('[data-reveal-all]')) revealAll();
    const solveOn = e.target.closest('[data-solve-on]');
    if (solveOn) setCount(+solveOn.dataset.solveOn);
    const match = e.target.closest('[data-match]');
    if (match) {
      const r = +match.dataset.match;
      remember();
      state.grid[r] = W.score(state.pins[r], state.answer);
      renderPaint(); update();
    }
    const unpin = e.target.closest('[data-unpin]');
    if (unpin) { remember(); delete state.pins[+unpin.dataset.unpin]; update(true); }
  }
  $('#problems').addEventListener('click', onFix);
  $('#status').addEventListener('click', onFix);

  // ---------- Find answers that fit ----------
  const packed = { all: null, common: null };
  let findJob = 0, found = null, foundNote = '', showAll = false;
  function clearFind() { findJob++; found = null; $('#findOut').innerHTML = ''; $('#findProgress').hidden = true; $('#findBtn').disabled = false; }
  function renderFound() {
    const out = $('#findOut');
    if (!found) return;
    if (!found.length) {
      out.innerHTML = foundNote || `No common answer can draw this picture${state.hard ? ' in hard mode' : ''}. Try fewer all-yellow rows, or turn off "No repeated guesses"${state.hard ? ' or hard mode' : ''}.`;
      return;
    }
    const shown = showAll ? found : found.slice(0, 40);
    const isHidden = hidden();
    out.innerHTML = `<strong style="color:var(--text)">${found.length.toLocaleString()}</strong> of ${ANSWERS.length.toLocaleString()} common answers work${state.hard ? ' in hard mode' : ''}. Pick one:` +
      '<div class="words">' + shown.map(w => `<button data-word="${w}" class="${w === state.answer && !isHidden ? 'on' : ''}">${w}</button>`).join('') + '</div>' +
      (found.length > shown.length ? `<button class="more" data-more>Show all ${found.length.toLocaleString()}</button>` : '');
  }
  $('#findBtn').addEventListener('click', () => {
    const job = ++findJob;
    const words = state.commonOnly ? ANSWERS : ALL;
    const key = state.commonOnly ? 'common' : 'all';
    if (!packed[key]) packed[key] = W.pack(words);
    const grid = state.grid.slice(0, state.count).map(r => r.slice());
    const { unique, hard } = state;
    const pins = activePins();
    const hasPins = Object.keys(pins).length > 0;
    const codes = new Set(grid.slice(0, -1).map(W.encode));
    foundNote = '';
    if (hard) {
      const issue = W.hardPatternIssues(grid)[0];
      if (issue) {
        found = []; foundNote = `No answer can work: row ${issue.row + 1}. ${issue.reason}`;
        renderFound(); return;
      }
    }
    const hits = [];
    const bar = $('#findProgress');
    bar.hidden = false; bar.firstElementChild.style.width = '0';
    $('#findBtn').disabled = true;
    $('#findOut').textContent = 'Checking every answer…';
    let i = 0;
    (function step() {
      if (job !== findJob) return;
      const end = performance.now() + 14;
      while (i < ANSWERS.length && performance.now() < end) {
        const a = ANSWERS[i++];
        if (!hasPins && !W.works(grid, a, packed[key], unique)) continue;
        if (hard || hasPins) {
          const rows = W.solve(grid, a, { index: W.buildIndexFor(codes, a, packed[key], words), unique, hard, pins, isWord, offsets: [] });
          if (rows.some(x => x.status === 'impossible' || x.repeated)) continue;
        }
        hits.push(a);
      }
      bar.firstElementChild.style.width = (100 * i / ANSWERS.length) + '%';
      if (i < ANSWERS.length) return requestAnimationFrame(step);
      bar.hidden = true;
      $('#findBtn').disabled = false;
      // Shuffle so the list isn't always alphabetical.
      for (let k = hits.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [hits[k], hits[j]] = [hits[j], hits[k]]; }
      found = hits; showAll = false;
      renderFound();
    })();
  });
  $('#findOut').addEventListener('click', e => {
    const b = e.target.closest('button[data-word]');
    if (b) { setAnswer(b.dataset.word); return; }
    if (e.target.closest('[data-more]')) { showAll = true; renderFound(); }
  });

  // ---------- Options & actions ----------
  $('#optHard').addEventListener('change', e => { state.hard = e.target.checked; state.offsets.fill(0); update(); });
  $('#optCommon').addEventListener('change', e => { state.commonOnly = e.target.checked; state.offsets.fill(0); update(); });
  $('#optUnique').addEventListener('change', e => { state.unique = e.target.checked; update(); });
  $('#shuffle').addEventListener('click', () => {
    for (let r = 0; r < ROWS; r++) state.offsets[r] = Math.floor(Math.random() * 1e6);
    update(true);
  });

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
  }
  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg); }
    catch { window.prompt('Copy this:', text); }
  }
  const EMOJI = ['⬛', '🟨', '🟩'];
  $('#copyWords').addEventListener('click', () => {
    if (lastRows) copy(lastRows.map((x, i) => `${i + 1}. ${x.word.toUpperCase()}`).join('\n'), hidden() ? 'Guesses copied (contains spoilers)' : 'Guesses copied');
  });
  $('#copyEmoji').addEventListener('click', () => {
    // Same header format as the real game's share text, e.g. "Wordle 1,234 4/6*".
    const head = `Wordle${state.daily ? ' ' + state.daily.id.toLocaleString() : ''} ${state.count}/6${state.hard ? '*' : ''}`;
    copy(head + '\n\n' + state.grid.slice(0, state.count).map(r => r.map(c => EMOJI[c]).join('')).join('\n'), 'Emoji grid copied');
  });
  $('#copyLink').addEventListener('click', () => copy(location.href, 'Link copied'));

  // ---------- Save image ----------
  const saveMenu = $('#saveMenu');
  $('#saveBtn').addEventListener('click', e => { e.stopPropagation(); saveMenu.hidden = !saveMenu.hidden; });
  document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) saveMenu.hidden = true; });
  saveMenu.addEventListener('click', async e => {
    const b = e.target.closest('[data-save]');
    if (!b) return;
    saveMenu.hidden = true;
    const letters = b.dataset.save === 'letters';
    if (letters && (!lastRows || lastRows.some(x => x.status === 'impossible'))) { toast('Fix the impossible rows first, or save colours only'); return; }
    await saveImage(letters);
  });
  async function saveImage(withLetters) {
    try { await document.fonts.ready; } catch {}
    const css = getComputedStyle(document.documentElement);
    const v = name => css.getPropertyValue(name).trim();
    const n = state.count, tile = 64, gap = 8, pad = 28, scale = 2;
    const w = pad * 2 + 5 * tile + 4 * gap, h = pad * 2 + n * tile + (n - 1) * gap;
    const canvas = document.createElement('canvas');
    canvas.width = w * scale; canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = v('--bg'); ctx.fillRect(0, 0, w, h);
    const fills = [v('--grey'), v('--yellow'), v('--green')];
    ctx.font = '800 32px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let r = 0; r < n; r++) for (let c = 0; c < 5; c++) {
      const x = pad + c * (tile + gap), y = pad + r * (tile + gap);
      ctx.fillStyle = fills[state.grid[r][c]];
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, tile, tile, 7); else ctx.rect(x, y, tile, tile);
      ctx.fill();
      if (withLetters) { ctx.fillStyle = '#fff'; ctx.fillText(lastRows[r].word[c].toUpperCase(), x + tile / 2, y + tile / 2 + 2); }
    }
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wordle-painter${withLetters && !state.daily ? '-' + state.answer : ''}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Image saved');
  }

  // ---------- Explainer examples (rendered with the real scorer) ----------
  const examples = [
    ['those', 'geese', 'The answer has one E. The green E in spot 5 claims it, so the two earlier E\'s are grey.'],
    ['abbey', 'bobby', 'After the green B in spot 3, one B is left over. The first extra B takes it (yellow) and the next one is grey.'],
    ['speed', 'erase', 'Nothing is green, so both E\'s in SPEED are in the pool. Both E\'s in the guess turn yellow.'],
  ];
  const exWrap = $('#examples');
  for (const [ans, guess, text] of examples) {
    const p = W.score(guess, ans);
    const mk = (word, cols, lbl) => `<div class="mini"><span class="lbl">${lbl}</span>${word.split('').map((ch, i) =>
      `<div class="tile ${cols ? 'c' + cols[i] : ''}" ${cols ? '' : 'style="background:transparent;border:2px solid var(--border-strong);color:var(--text)"'}>${ch}</div>`).join('')}</div>`;
    exWrap.appendChild(el('div', 'example', mk(ans, null, 'Answer') + mk(guess, p, 'Guess') + `<div style="font-size:13px">${text}</div>`));
  }

  // ---------- Init ----------
  if (!loadHash()) {
    PRESETS[0].rows.forEach((row, r) => row.split('').forEach((v, c) => state.grid[r][c] = +v));
    state.answer = 'heart';
  }
  $('#optHard').checked = state.hard;
  $('#optCommon').checked = state.commonOnly;
  $('#optUnique').checked = state.unique;
  setBrush(1);
  renderPaint();
  renderAnswer();
  renderHistory();
  update();
  if (pendingDaily) useDaily(pendingDaily);
})();
