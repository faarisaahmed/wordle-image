// Core Wordle logic: scoring (with correct duplicate-letter handling) and the picture solver.
// Works in the browser (window.Wordle) and in Node (module.exports) so it can be tested.
(function (root) {
  const GREY = 0, YELLOW = 1, GREEN = 2;
  const ALL_GREEN = 242; // encode([2,2,2,2,2])

  // Official Wordle colouring:
  //  1. Every letter in the right spot is green.
  //  2. Remaining answer letters form a pool. Left to right, each non-green guess letter is
  //     yellow if the pool still holds a copy of it (and that copy is consumed), else grey.
  function score(guess, answer) {
    const res = [GREY, GREY, GREY, GREY, GREY];
    const pool = {};
    for (let i = 0; i < 5; i++) {
      if (guess[i] === answer[i]) res[i] = GREEN;
      else pool[answer[i]] = (pool[answer[i]] || 0) + 1;
    }
    for (let i = 0; i < 5; i++) {
      if (res[i] === GREEN) continue;
      const c = guess[i];
      if (pool[c] > 0) { res[i] = YELLOW; pool[c]--; }
    }
    return res;
  }

  function encode(p) { return p[0] + 3 * p[1] + 9 * p[2] + 27 * p[3] + 81 * p[4]; }

  // Map pattern code -> words (in the order given) that produce it against `answer`.
  function buildIndex(answer, words) {
    const index = new Map();
    for (const w of words) {
      const code = encode(score(w, answer));
      let list = index.get(code);
      if (!list) index.set(code, (list = []));
      list.push(w);
    }
    return index;
  }

  // Is this pattern achievable by *any* 5-letter string (ignoring the dictionary)?
  // Greys are always achievable (use a letter not in the answer). Greens are fixed.
  // Yellows each need a distinct leftover answer letter that differs from the answer's
  // letter in that column (otherwise it would be green) - a small bipartite matching.
  function feasibility(pattern, answer) {
    const open = [], yellows = [];
    for (let i = 0; i < 5; i++) {
      if (pattern[i] !== GREEN) open.push(i);
      if (pattern[i] === YELLOW) yellows.push(i);
    }
    // Candidate leftover slots j for yellow column i: letter answer[j] != answer[i].
    const cand = yellows.map(i => open.filter(j => answer[j] !== answer[i]));
    const assign = new Map(); // slot j -> yellow index k
    function augment(k, seen) {
      for (const j of cand[k]) {
        if (seen.has(j)) continue;
        seen.add(j);
        if (!assign.has(j) || augment(assign.get(j), seen)) { assign.set(j, k); return true; }
      }
      return false;
    }
    let ok = true;
    for (let k = 0; k < yellows.length; k++) if (!augment(k, new Set())) { ok = false; break; }

    const leftover = [...new Set(open.map(j => answer[j].toUpperCase()))];
    if (ok) {
      // Build an example string (usually not a real word) to show it is legal.
      const absent = 'qxzjvkwfyhbgmpucdlotinsrae'.split('').filter(c => !answer.includes(c));
      const ex = answer.split('');
      let a = 0;
      for (let i = 0; i < 5; i++) if (pattern[i] === GREY) ex[i] = absent[a++ % absent.length];
      for (const [j, k] of assign) ex[yellows[k]] = answer[j];
      return { ok: true, example: ex.join('') };
    }

    // Find the smallest set of yellow columns that cannot all be satisfied (Hall violation).
    let best = null;
    for (let mask = 1; mask < 1 << yellows.length; mask++) {
      const ks = yellows.map((_, k) => k).filter(k => mask & (1 << k));
      const nb = new Set(ks.flatMap(k => cand[k]));
      if (nb.size < ks.length && (!best || ks.length < best.length)) best = ks;
    }
    const cols = best.map(k => yellows[k]);
    const colNames = cols.map(c => c + 1);
    let reason;
    if (cols.length === 1) {
      const c = cols[0];
      reason = open.length === 1
        ? `Column ${c + 1} is the only non-green tile, so its letter has to be ${answer[c].toUpperCase()}, and that makes it green, not yellow.`
        : `The yellow in column ${c + 1} needs a letter that's in the answer but not in that spot. The only letters left over (${leftover.join(', ')}) all belong in column ${c + 1}, so the tile would turn green.`;
    } else {
      reason = `Columns ${colNames.join(' & ')} need ${cols.length} different misplaced letters, but there aren't enough leftover letters (${leftover.join(', ')}) that avoid turning green.`;
    }
    return { ok: false, reason, cols };
  }

  // patterns: 1-6 arrays of 5 colours; the last one is the answer row. Returns one entry per row.
  // opts: { index, fallbackIndex, unique, offsets }
  function solve(patterns, answer, opts) {
    const used = new Set([answer]);
    return patterns.map((p, r) => {
      const code = encode(p);
      if (r === patterns.length - 1) return { status: 'answer', word: answer, count: 1, idx: 0 };
      if (code === ALL_GREEN) {
        return { status: 'impossible', kind: 'early', cols: [0, 1, 2, 3, 4],
          reason: 'An all-green row means you guessed the answer, so the game would end here, before your final row.' };
      }
      const list = opts.index.get(code) || [];
      if (!list.length) {
        const f = feasibility(p, answer);
        if (!f.ok) return { status: 'impossible', kind: 'rules', cols: f.cols, reason: f.reason };
        const inFallback = opts.fallbackIndex && (opts.fallbackIndex.get(code) || []).length;
        return { status: 'impossible', kind: 'dictionary', cols: [], example: f.example,
          canWiden: !!inFallback,
          reason: `This pattern is legal by Wordle's rules (e.g. ${f.example.toUpperCase()}), but no word in the list makes it.` };
      }
      let pool = opts.unique ? list.filter(w => !used.has(w)) : list;
      const repeated = !pool.length;
      if (repeated) pool = list;
      const idx = ((opts.offsets[r] || 0) % pool.length + pool.length) % pool.length;
      const word = pool[idx];
      used.add(word);
      return { status: 'ok', word, count: pool.length, idx, repeated };
    });
  }

  // Words packed as letter indices (0-25) in one flat array, for allocation-free scoring.
  function pack(words) {
    const out = new Uint8Array(words.length * 5);
    for (let i = 0; i < words.length; i++) for (let j = 0; j < 5; j++) out[i * 5 + j] = words[i].charCodeAt(j) - 97;
    return out;
  }

  // Fast yes/no: can every row be drawn for this answer? Exits as soon as all rows are covered.
  // Same rules as score(), inlined over packed words.
  function works(patterns, answer, packed, unique) {
    const need = new Int8Array(243);
    let remaining = 0;
    for (let r = 0; r < patterns.length - 1; r++) {
      const code = encode(patterns[r]);
      if (code === ALL_GREEN) return false;
      if (unique || need[code] === 0) { need[code]++; remaining++; }
    }
    if (remaining === 0) return true;
    const a = [0, 1, 2, 3, 4].map(i => answer.charCodeAt(i) - 97);
    const pool = new Int8Array(26);
    const mul = [1, 3, 9, 27, 81];
    for (let o = 0; o < packed.length; o += 5) {
      pool.fill(0);
      let code = 0;
      for (let i = 0; i < 5; i++) {
        if (packed[o + i] === a[i]) code += 2 * mul[i];
        else pool[a[i]]++;
      }
      for (let i = 0; i < 5; i++) {
        const c = packed[o + i];
        if (c !== a[i] && pool[c] > 0) { pool[c]--; code += mul[i]; }
      }
      if (need[code] > 0) { need[code]--; if (--remaining === 0) return true; }
    }
    return false;
  }

  const api = { GREY, YELLOW, GREEN, ALL_GREEN, score, encode, buildIndex, feasibility, solve, pack, works };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Wordle = api;
})(this);
