# Wordle Painter

Paint a picture on a 5×6 Wordle grid (grey / yellow / green), pick an answer, and get the guesses that draw it.

**Live:** https://faarisaahmed.github.io/wordle-image/

- Click or drag to paint; the last row is always all green (it's the answer).
- Type an answer and each row gets a real word that produces exactly that colour pattern. Use the arrows to cycle alternatives.
- Rows that can't be made are flagged, with the reason and the tiles at fault:
  - **Breaks the rules:** e.g. answer `CRANE` with 🟩🟩🟩🟩🟨. The only leftover letter is E, and E in that spot would be green.
  - **No word exists:** legal by the rules, but no dictionary word fits.
  - **Ends early:** an all-green row before row 6.
- **Find answers that fit my picture** scans all 2,315 common answers and lists the ones that can draw your picture.

## Colour rules (duplicate letters)

1. Letters in the correct spot are green.
2. The unmatched answer letters form a pool. Left to right, each other guess letter is yellow if the pool still has a copy of it (using that copy up), otherwise grey.

So with answer `THOSE`, the guess `GEESE` scores ⬛⬛⬛🟩🟩. The green E uses up the only E.

## Files

- `index.html`: UI
- `wordle.js`: scoring, impossibility detection (bipartite matching over leftover letters), solver
- `words.js`: Wordle's 14,855 valid guesses (the 2,315 original answers listed first)
- `test/wordle.test.js`: `node test/wordle.test.js` checks scoring and exhaustively checks the impossibility logic against brute force
