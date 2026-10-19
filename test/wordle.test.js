// Run with: node test/wordle.test.js
const assert = require('assert');
const W = require('../wordle.js');
global.window = {};
require('../words.js');
const ANS = window.WORDS_ANSWERS.split(' ');
const ALL = ANS.concat(window.WORDS_EXTRA.split(' '));

const fmt = p => p.map(x => '-YG'[x]).join('');
const cases = [
  ['geese', 'those', '---GG'], // the only E is claimed by the green E
  ['bobby', 'abbey', 'Y-G-G'], // one spare B: first B yellow, third B grey
  ['erase', 'speed', 'Y--YY'],
  ['speed', 'abide', '--Y-Y'], // one E in answer: first E yellow, second grey
  ['allee', 'eagle', 'YY-YG'], // one spare L
  ['lever', 'eerie', '-G-YY'],
];
for (const [g, a, want] of cases) assert.strictEqual(fmt(W.score(g, a)), want, `${g} vs ${a}`);

// Exhaustive check of feasibility(): any letter not in the answer behaves identically,
// so brute force over (answer letters + one absent letter)^5.
let checked = 0;
for (const answer of ALL.filter((_, i) => i % 7 === 0)) {
  const alpha = [...new Set(answer)];
  alpha.push('abcdefghijklmnopqrstuvwxyz'.split('').find(c => !answer.includes(c)));
  const reachable = new Set();
  const rec = (s) => {
    if (s.length === 5) return reachable.add(W.encode(W.score(s, answer)));
    for (const c of alpha) rec(s + c);
  };
  rec('');
  for (let code = 0; code < 243; code++) {
    const p = [0, 1, 2, 3, 4].map(i => Math.floor(code / 3 ** i) % 3);
    const f = W.feasibility(p, answer);
    assert.strictEqual(f.ok, reachable.has(code), `${answer} ${fmt(p)}`);
    if (f.ok) assert.strictEqual(W.encode(W.score(f.example, answer)), code, `example ${answer} ${fmt(p)}`);
    else assert.ok(f.cols.length && f.reason);
    checked++;
  }
}
console.log(`ok - ${cases.length} scoring cases, ${checked} feasibility checks`);

// works() must agree with solve() reporting no impossible rows.
const pics = [
  ['01010', '11111', '11111', '01110', '00100'],
  ['00000', '01010', '00000', '10001', '01110'],
  ['20000', '22000', '22200', '22220', '00000'],
  ['22221', '00000', '11111', '12121', '00100'],
].map(rows => rows.map(s => s.split('').map(Number)).concat([[2, 2, 2, 2, 2]]));
const PACKED = W.pack(ALL);
let agree = 0;
for (const pic of pics) for (const answer of ANS.filter((_, i) => i % 5 === 0)) for (const unique of [true, false]) {
  const rows = W.solve(pic, answer, { index: W.buildIndex(answer, ALL), unique, offsets: [0, 0, 0, 0, 0, 0] });
  const ok = rows.every(x => x.status !== 'impossible' && !x.repeated);
  assert.strictEqual(W.works(pic, answer, PACKED, unique), ok, `works ${answer} ${unique}`);
  agree++;
}
console.log(`ok - ${agree} works() checks`);

// Shorter games: the last pattern passed in is the answer row.
const G = [2, 2, 2, 2, 2];
for (const answer of ['heart', 'crane', 'abbey']) {
  const one = W.solve([G], answer, { index: W.buildIndex(answer, ALL), unique: true, offsets: [0] });
  assert.deepStrictEqual(one.map(x => x.status), ['answer']);
  assert.strictEqual(W.works([G], answer, PACKED, true), true);
  const three = W.solve([[0, 1, 0, 0, 0], [0, 0, 2, 0, 0], G], answer, { index: W.buildIndex(answer, ALL), unique: true, offsets: [0, 0, 0] });
  assert.deepStrictEqual(three.map(x => x.status), ['ok', 'ok', 'answer']);
  assert.strictEqual(three[2].word, answer);
  const early = W.solve([G, G], answer, { index: W.buildIndex(answer, ALL), unique: true, offsets: [0, 0] });
  assert.strictEqual(early[0].kind, 'early');
  assert.strictEqual(W.works([G, G], answer, PACKED, true), false);
}
console.log('ok - short games');

// ---- Hard mode ----
// hardOk mirrors the NYT check (previous guess only, duplicate-aware counts).
assert.strictEqual(W.hardOk('lobby', 'bobby', [1, 0, 2, 0, 2]), true);
assert.strictEqual(W.hardOk('xxbxy', 'bobby', [1, 0, 2, 0, 2]), false); // needs two B's
assert.strictEqual(W.hardOk('bobyx', 'bobby', [1, 0, 2, 0, 2]), false); // green Y moved
assert.strictEqual(W.hardOk('crane', 'tread', [0, 1, 1, 2, 0]), false); // green A must stay in spot 4
assert.strictEqual(W.hardOk('rexas', 'tread', [0, 1, 1, 0, 0]), true);  // yellows may move; greys may repeat
assert.strictEqual(W.hardOk('treed', 'tread', [0, 1, 1, 0, 0]), true);  // yellows may stay put

// Brute-force reference: pairwise hardOk over the full candidate lists.
function bruteHard(patterns, answer, index) {
  const last = patterns.length - 1;
  let valid = index.get(W.encode(patterns[last - 1])) || [];
  if (!valid.length) return false;
  for (let r = last - 2; r >= 0; r--) {
    const list = index.get(W.encode(patterns[r])) || [];
    const p = patterns[r];
    valid = list.filter(w => valid.some(v => W.hardOk(v, w, p)));
    if (!valid.length) return false;
  }
  return true;
}
let seed = 7;
const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
let hardCases = 0, hardOkCount = 0;
for (let t = 0; t < 400; t++) {
  const answer = ANS[rand(ANS.length)];
  const index = W.buildIndex(answer, ALL);
  const n = 2 + rand(5);
  // Build pictures from real guesses, sometimes as an actual hard-mode game so both outcomes get tested.
  const pats = [];
  let prev = null, prevP = null;
  for (let r = 0; r < n - 1; r++) {
    let w = ALL[rand(ALL.length)];
    if (prev && rand(2)) for (let k = 0; k < 3000; k++) { const c = ALL[rand(ALL.length)]; if (W.hardOk(c, prev, prevP) && c !== answer) { w = c; break; } }
    const p = W.score(w, answer);
    if (W.encode(p) === W.ALL_GREEN) { r--; continue; }
    pats.push(p); prev = w; prevP = p;
  }
  pats.push([2, 2, 2, 2, 2]);
  const rows = W.solve(pats, answer, { index, unique: false, offsets: pats.map(() => rand(50)), hard: true });
  const ok = rows.every(x => x.status !== 'impossible');
  assert.strictEqual(ok, bruteHard(pats, answer, index), `hard ${answer} ${pats.map(fmt).join(' ')}`);
  if (W.hardPatternIssues(pats).length) assert.ok(!ok, 'pattern issue but solvable');
  if (ok) {
    hardOkCount++;
    for (let r = 0; r + 1 < rows.length; r++) {
      assert.strictEqual(W.encode(W.score(rows[r].word, answer)), W.encode(pats[r]));
      assert.ok(W.hardOk(rows[r + 1].word, rows[r].word, pats[r]), `chain ${rows.map(x => x.word)}`);
    }
  }
  hardCases++;
}
console.log(`ok - ${hardCases} hard-mode cases (${hardOkCount} solvable) match brute force`);

// Pins: a matching pin is used verbatim, a mismatching one is flagged.
{
  const answer = 'heart', index = W.buildIndex(answer, ALL);
  const pats = [W.score('crane', answer), [0, 1, 0, 0, 0], G];
  const rows = W.solve(pats, answer, { index, unique: true, offsets: [0, 0, 0], pins: { 0: 'crane' } });
  assert.strictEqual(rows[0].word, 'crane'); assert.ok(rows[0].pinned);
  const bad = W.solve(pats, answer, { index, unique: true, offsets: [0, 0, 0], pins: { 1: 'crane' } });
  assert.strictEqual(bad[1].kind, 'pin');
  const fake = W.solve(pats, answer, { index, unique: true, offsets: [0, 0, 0], pins: { 0: 'zzzzz' }, isWord: w => ALL.includes(w) });
  assert.strictEqual(fake[0].kind, 'pin');
}
// buildIndexFor agrees with buildIndex.
{
  const a = 'abbey', full = W.buildIndex(a, ALL), part = W.buildIndexFor([0, 5, 100, 242], a, PACKED, ALL);
  for (const c of [0, 5, 100, 242]) assert.deepStrictEqual(part.get(c), full.get(c) || []);
}
// hideLetters keeps the answer's letters out of reasons.
{
  const r = W.solve([[2, 2, 2, 2, 1], G], 'crane', { index: W.buildIndex('crane', ALL), unique: true, offsets: [0, 0], hideLetters: true });
  assert.ok(!/\bE\b/.test(r[0].reason), r[0].reason);
}
console.log('ok - pins, partial index, spoiler-safe reasons');
