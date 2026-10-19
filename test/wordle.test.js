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
