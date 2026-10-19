"""Fetch recent and upcoming Wordle answers into daily.json for the "Use today's Wordle" button.

The NYT endpoint doesn't allow cross-origin requests, so a scheduled GitHub Action runs this and
commits the result next to the page. Words are lightly obfuscated (ROT13 + base64) so nobody gets
spoiled by glancing at the file or a diff. Covers yesterday through a week ahead, so every
timezone's "today" is present even if a run is missed.
"""
import base64
import codecs
import datetime as dt
import json
import pathlib
import urllib.request

OUT = pathlib.Path(__file__).resolve().parent.parent / "daily.json"
URL = "https://www.nytimes.com/svc/wordle/v2/{}.json"


def fetch(day):
    req = urllib.request.Request(URL.format(day), headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def main():
    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    today = dt.datetime.now(dt.timezone.utc).date()
    days = [(today + dt.timedelta(days=d)).isoformat() for d in range(-1, 8)]
    out = {}
    for day in days:
        try:
            data = fetch(day)
            word = data["solution"].lower()
            assert len(word) == 5 and word.isalpha()
            out[day] = {"id": data["days_since_launch"], "w": base64.b64encode(codecs.encode(word, "rot13").encode()).decode()}
        except Exception as e:  # keep whatever we had for that day
            print(f"{day}: {e}")
            if day in old:
                out[day] = old[day]
    OUT.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    print(f"wrote {len(out)} days")


if __name__ == "__main__":
    main()
