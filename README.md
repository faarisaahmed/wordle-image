# Wordle Painter

Paint a picture on a Wordle grid (grey / yellow / green), pick an answer, and get the guesses that draw it.

**Live:** https://faarisaahmed.github.io/wordle-image/

## Features

- **Paint** by clicking or dragging. Choose **Solved on guess** (1–6): that row is the all-green answer and later rows go unused. Undo/redo (Ctrl/Cmd+Z), random, clear, and a gallery of presets.
- **Guesses**: each row gets a real word that produces exactly its colours. Arrows cycle alternatives, Shuffle picks new ones.
- **Type your own word** by clicking a guess row; it's pinned so Shuffle keeps it. If it doesn't match the painted colours, you can repaint the row to match.
- **Hard mode** follows NYT's own check (below), searching for a chain of guesses that's legal end to end.
- **Impossible rows** are flagged with the reason and the tiles at fault: breaks the colour rules, no word exists, ends early, your word doesn't fit, or blocked by hard mode. One-click fixes where possible.
- **Find answers that fit my picture** scans all 2,315 common answers.
- **Use today's Wordle**, behind a spoiler warning. The answer and guesses stay hidden (colours only) until you reveal them; the share link stores the date, never the word.
- **Share**: link, emoji grid in the game's own format (`Wordle 1,234 4/6*`), or a PNG with or without letters.

## Rules

**Colours (duplicate letters):** letters in the right spot are green first. The unmatched answer letters form a pool; left to right, each other guess letter is yellow if the pool still has a copy (using it up), otherwise grey. Answer `THOSE`, guess `GEESE` → ⬛⬛⬛🟩🟩.

**Hard mode** (from the NYT game's code, which compares each guess with the previous one only): greens must stay in place, and every green/yellow letter must appear in the next guess at least as many times as it was coloured. Grey letters may be reused.

## Files

- `index.html`, `app.js`: UI
- `wordle.js`: scoring, impossibility detection, hard-mode chain search, solver
- `words.js`: Wordle's 14,855 valid guesses (the 2,315 original answers listed first)
- `daily.json`: recent/upcoming answers, obfuscated (ROT13 + base64), refreshed by `.github/workflows/daily.yml` running `scripts/fetch_daily.py`. The NYT endpoint blocks cross-site requests, so the page can't fetch it directly.
- `test/wordle.test.js`: `node test/wordle.test.js`. Checks scoring, checks the impossibility logic exhaustively against brute force, and checks hard mode against a brute-force chain search.
