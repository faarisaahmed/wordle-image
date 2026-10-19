// Core Wordle logic: scoring (with correct duplicate-letter handling), hard mode, and the picture solver.
// Works in the browser (window.Wordle) and in Node (module.exports) so it can be tested.
(function (root) {
  const GREY = 0, YELLOW = 1, GREEN = 2;
  const ALL_GREEN = 242; // encode([2,2,2,2,2])
  const MUL = [1, 3, 9, 27, 81];

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

  // Hard mode, exactly as the NYT game checks it (against the previous guess only):
  //  - every green in the previous guess must be repeated in the same spot;
  //  - every green/yellow letter must appear in the new guess at least as many times as it was coloured.
  // Grey letters may be reused, and yellows may sit in the same spot again.
  function hardOk(guess, prev, prevPattern) {
    const need = {};
    for (let i = 0; i < 5; i++) {
      if (prevPattern[i] === GREEN && guess[i] !== prev[i]) return false;
      if (prevPattern[i] !== GREY) need[prev[i]] = (need[prev[i]] || 0) + 1;
    }
    for (let i = 0; i < 5; i++) if (need[guess[i]]) need[guess[i]]--;
    for (const c in need) if (need[c] > 0) return false;
    return true;
  }

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

  // Words packed as letter indices (0-25) in one flat array, for allocation-free scoring.
  function pack(words) {
    const out = new Uint8Array(words.length * 5);
    for (let i = 0; i < words.length; i++) for (let j = 0; j < 5; j++) out[i * 5 + j] = words[i].charCodeAt(j) - 97;
    return out;
  }

  // Same rules as score(), inlined over packed words; calls visit(code, wordIndex) for each word
  // until visit returns true.
  function scanPacked(answer, packed, visit) {
    const a = [0, 1, 2, 3, 4].map(i => answer.charCodeAt(i) - 97);
    const pool = new Int8Array(26);
    for (let o = 0, w = 0; o < packed.length; o += 5, w++) {
      pool.fill(0);
      let code = 0;
      for (let i = 0; i < 5; i++) {
        if (packed[o + i] === a[i]) code += 2 * MUL[i];
        else pool[a[i]]++;
      }
      for (let i = 0; i < 5; i++) {
        const c = packed[o + i];
        if (c !== a[i] && pool[c] > 0) { pool[c]--; code += MUL[i]; }
      }
      if (visit(code, w)) return;
    }
  }

  // Like buildIndex but only for the pattern codes asked for (much faster when scanning many answers).
  function buildIndexFor(codes, answer, packed, words) {
    const index = new Map();
    for (const c of codes) index.set(c, []);
    scanPacked(answer, packed, (code, w) => { const l = index.get(code); if (l) l.push(words[w]); });
    return index;
  }

  // Fast yes/no (normal mode): can every row be drawn for this answer? Exits as soon as all rows are covered.
  function works(patterns, answer, packed, unique) {
    const need = new Int8Array(243);
    let remaining = 0;
    for (let r = 0; r < patterns.length - 1; r++) {
      const code = encode(patterns[r]);
      if (code === ALL_GREEN) return false;
      if (unique || need[code] === 0) { need[code]++; remaining++; }
    }
    if (remaining === 0) return true;
    let ok = false;
    scanPacked(answer, packed, code => {
      if (need[code] > 0) { need[code]--; if (--remaining === 0) return (ok = true); }
      return false;
    });
    return ok;
  }

  // Is this pattern achievable by *any* 5-letter string (ignoring the dictionary)?
  // Greys are always achievable (use a letter not in the answer). Greens are fixed.
  // Yellows each need a distinct leftover answer letter that differs from the answer's
  // letter in that column (otherwise it would be green) - a small bipartite matching.
  // hide: describe problems without naming any of the answer's letters (spoiler-safe).
  function feasibility(pattern, answer, hide) {
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
    const left = hide ? '' : ` (${leftover.join(', ')})`;
    let reason;
    if (cols.length === 1) {
      const c = cols[0];
      reason = open.length === 1
        ? `Column ${c + 1} is the only non-green tile, so its letter has to be ${hide ? "the answer's letter for that spot" : answer[c].toUpperCase()}, and that makes it green, not yellow.`
        : `The yellow in column ${c + 1} needs a letter that's in the answer but not in that spot. The only letters left over${left} all belong in column ${c + 1}, so the tile would turn green.`;
    } else {
      reason = `Columns ${colNames.join(' & ')} need ${cols.length} different misplaced letters, but there aren't enough leftover letters${left} that avoid turning green.`;
    }
    return { ok: false, reason, cols };
  }

  // Hard-mode problems that follow from the colours alone (no words needed).
  // The last pattern is the answer row, which always satisfies hard mode.
  function hardPatternIssues(patterns) {
    const issues = [];
    for (let r = 0; r + 1 < patterns.length - 1; r++) {
      const a = patterns[r], b = patterns[r + 1];
      const dropped = [0, 1, 2, 3, 4].filter(i => a[i] === GREEN && b[i] !== GREEN);
      const ca = a.filter(x => x !== GREY).length, cb = b.filter(x => x !== GREY).length;
      const parts = [];
      if (dropped.length) {
        const cols = dropped.map(i => i + 1).join(' & ');
        parts.push(`column${dropped.length > 1 ? 's' : ''} ${cols} ${dropped.length > 1 ? 'were' : 'was'} green in row ${r + 1}, so ${dropped.length > 1 ? 'they' : 'it'} must stay green here`);
      }
      if (cb < ca) parts.push(`row ${r + 1} reveals ${ca} letters that must all be reused, so this row needs at least ${ca} coloured tiles (it has ${cb})`);
      if (parts.length) issues.push({ row: r + 1, cols: dropped, reason: 'Hard mode: ' + parts.join('; and ') + '.' });
    }
    return issues;
  }

  function letterCounts(s) {
    const c = new Int8Array(26);
    for (let i = 0; i < s.length; i++) c[s.charCodeAt(i) - 97]++;
    return c;
  }

  // Words in `list` (all scoring `pattern`) that have at least one hard-mode-legal successor in `next`.
  // Greens carry over automatically once hardPatternIssues() passes, so only letter counts matter;
  // words with the same coloured letters behave identically, so each group is checked once.
  function filterChain(list, pattern, next) {
    const nextCounts = next.map(letterCounts);
    const memo = new Map();
    return list.filter(w => {
      let key = '';
      for (let i = 0; i < 5; i++) if (pattern[i] !== GREY) key += w[i];
      key = key.split('').sort().join('');
      if (!memo.has(key)) {
        const need = letterCounts(key);
        memo.set(key, nextCounts.some(c => { for (let i = 0; i < 26; i++) if (c[i] < need[i]) return false; return true; }));
      }
      return memo.get(key);
    });
  }

  // patterns: 1-6 arrays of 5 colours; the last one is the answer row. Returns one entry per row.
  // opts: { index, fallbackIndex, unique, offsets, hard, pins: {row: word}, isWord, hideLetters }
  function solve(patterns, answer, opts) {
    const last = patterns.length - 1;
    const pins = opts.pins || {};
    const hide = !!opts.hideLetters;
    const out = [];
    const cands = [];

    for (let r = 0; r <= last; r++) {
      const p = patterns[r], code = encode(p);
      if (r === last) { out[r] = { status: 'answer', word: answer, count: 1, idx: 0 }; continue; }
      if (code === ALL_GREEN) {
        out[r] = { status: 'impossible', kind: 'early', cols: [0, 1, 2, 3, 4],
          reason: 'An all-green row means you guessed the answer, so the game would end here, before your final row.' };
        continue;
      }
      const pin = pins[r];
      if (pin) {
        const P = pin.toUpperCase();
        if (opts.isWord && !opts.isWord(pin)) {
          out[r] = { status: 'impossible', kind: 'pin', pin, cols: [], reason: `${P} isn't in Wordle's word list, so the game won't accept it as a guess.` };
          continue;
        }
        const actual = score(pin, answer);
        if (encode(actual) !== code) {
          out[r] = { status: 'impossible', kind: 'pin', pin, actual, cols: [0, 1, 2, 3, 4].filter(i => actual[i] !== p[i]),
            reason: `Your word ${P} doesn't make the colours painted here (the ringed tiles come out different).` };
          continue;
        }
        cands[r] = [pin];
        continue;
      }
      const list = opts.index.get(code) || [];
      if (!list.length) {
        const f = feasibility(p, answer, hide);
        if (!f.ok) { out[r] = { status: 'impossible', kind: 'rules', cols: f.cols, reason: f.reason }; continue; }
        const inFallback = opts.fallbackIndex && (opts.fallbackIndex.get(code) || []).length;
        out[r] = { status: 'impossible', kind: 'dictionary', cols: [], example: f.example, canWiden: !!inFallback,
          reason: `This pattern is legal by Wordle's rules${hide ? '' : ` (e.g. ${f.example.toUpperCase()})`}, but no word in the list makes it.` };
        continue;
      }
      cands[r] = list;
    }

    // Hard mode: colour-only rules first, then search for a legal chain of words (backwards from the answer).
    let chain = null;
    if (opts.hard && last > 0) {
      for (const issue of hardPatternIssues(patterns)) {
        if (!out[issue.row]) out[issue.row] = { status: 'impossible', kind: 'hard', cols: issue.cols, reason: issue.reason };
      }
      const clean = () => out.every((x, r) => r === last || !x);
      if (clean()) {
        const valid = [];
        valid[last - 1] = cands[last - 1];
        for (let r = last - 2; r >= 0; r--) {
          valid[r] = filterChain(cands[r], patterns[r], valid[r + 1]);
          if (!valid[r].length) {
            out[r] = { status: 'impossible', kind: 'hard-chain', cols: [],
              reason: pins[r]
                ? `Hard mode: row ${r + 2} must reuse every letter your word ${pins[r].toUpperCase()} reveals, and no guess there can.`
                : `Hard mode: row ${r + 2} must reuse every letter revealed here, and none of the ${cands[r].length.toLocaleString()} words that fit this row leave a legal guess for it.` };
            break;
          }
        }
        if (clean()) chain = valid;
      }
    }

    const used = new Set([answer]);
    let prev = null, prevPattern = null;
    for (let r = 0; r < last; r++) {
      if (out[r]) { prev = null; continue; }
      let list = chain ? chain[r] : cands[r];
      if (chain && prev) list = list.filter(w => hardOk(w, prev, prevPattern));
      let pool = opts.unique ? list.filter(w => !used.has(w)) : list;
      const repeated = !pool.length;
      if (repeated) pool = list;
      const idx = ((opts.offsets[r] || 0) % pool.length + pool.length) % pool.length;
      const word = pool[idx];
      used.add(word);
      out[r] = { status: 'ok', word, count: pool.length, idx, repeated, pinned: !!pins[r] };
      prev = word; prevPattern = patterns[r];
    }
    return out;
  }

  const api = { GREY, YELLOW, GREEN, ALL_GREEN, score, encode, hardOk, buildIndex, buildIndexFor, pack, works,
    feasibility, hardPatternIssues, solve };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Wordle = api;
})(this);
