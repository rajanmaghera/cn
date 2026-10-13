#!/usr/bin/env python3
"""Scrape the official CN Tower lighting schedule into data/schedule.json.

Standard library only, so it runs on a bare GitHub Actions runner.

The cntower.ca markup has changed several times over the years, so rather
than depending on CSS selectors this flattens the page to lines of text and
looks for date lines; the text that follows a date (up to the next date) is
that night's lighting description.
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

SOURCE_URL = "https://www.cntower.ca/lighting-schedule"
DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "schedule.json"

MONTHS = {
    m: i
    for i, names in enumerate(
        [
            ("january", "jan"),
            ("february", "feb"),
            ("march", "mar"),
            ("april", "apr"),
            ("may",),
            ("june", "jun"),
            ("july", "jul"),
            ("august", "aug"),
            ("september", "sep", "sept"),
            ("october", "oct"),
            ("november", "nov"),
            ("december", "dec"),
        ],
        start=1,
    )
    for m in names
}
MONTH_RE = "|".join(sorted(MONTHS, key=len, reverse=True))
WEEKDAY_RE = r"(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday)?"

# "Monday, October 13, 2026", "Oct 13", "October 13 - 19", "October 13 to November 2, 2026"
DATE_RE = re.compile(
    rf"""
    (?:\b{WEEKDAY_RE}\.?,?\s+)?
    \b(?P<m1>{MONTH_RE})\.?\s+(?P<d1>\d{{1,2}})(?:st|nd|rd|th)?
    (?:,?\s+(?P<y1>\d{{4}}))?
    (?:\s*(?:-|–|—|to|through|until)\s*
        (?:{WEEKDAY_RE}\.?,?\s+)?
        (?:(?P<m2>{MONTH_RE})\.?\s+)?(?P<d2>\d{{1,2}})(?:st|nd|rd|th)?
        (?:,?\s+(?P<y2>\d{{4}}))?
    )?
    """,
    re.IGNORECASE | re.VERBOSE,
)
# Numeric dates such as 2026-10-13.
ISO_RE = re.compile(r"\b(?P<y>20\d\d)-(?P<m>\d\d)-(?P<d>\d\d)\b")

# Colour words the site knows how to draw (see COLOURS in app.js); multi-word names first.
COLOURS = [
    "light blue", "sky blue", "royal blue",
    "red", "crimson", "maroon", "burgundy", "pink", "magenta", "fuchsia", "orange", "amber",
    "gold", "yellow", "lime", "green", "emerald", "teal", "turquoise", "aqua", "cyan", "blue",
    "navy", "indigo", "violet", "purple", "lavender", "lilac", "silver", "white", "rainbow",
]
COLOUR_RE = re.compile(
    r"\b(" + "|".join(sorted((re.escape(c) for c in COLOURS), key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)

BLOCK_TAGS = {
    "address", "article", "aside", "blockquote", "br", "dd", "details", "div", "dl",
    "dt", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6",
    "header", "hr", "li", "main", "nav", "ol", "p", "section", "summary", "table",
    "tbody", "td", "th", "thead", "time", "tr", "ul",
}
SKIP_TAGS = {"script", "style", "noscript", "svg", "template", "head", "iframe"}
# Page chrome that isn't part of the schedule.
NOISE_RE = re.compile(
    r"^(buy tickets?|book now|learn more|read more|share|menu|search|close|"
    r"lighting schedule|lighting requests?|lighting information|"
    r"subscribe|sign up|privacy|terms|cookies?|©.*|copyright.*|"
    r"(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)$",
    re.IGNORECASE,
)


class _TextLines(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[str] = []
        self._buf: list[str] = []
        self._skip = 0

    def _flush(self) -> None:
        text = re.sub(r"\s+", " ", "".join(self._buf)).strip()
        if text:
            self.lines.append(text)
        self._buf = []

    def handle_starttag(self, tag, attrs):
        if tag in SKIP_TAGS:
            self._skip += 1
        elif tag in BLOCK_TAGS:
            self._flush()
        if tag == "time" and not self._skip:
            # <time datetime="2026-10-13"> is the most reliable date we can get.
            for k, v in attrs:
                if k == "datetime" and v and ISO_RE.search(v):
                    self._flush()
                    self.lines.append(ISO_RE.search(v).group(0))

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
        elif tag in BLOCK_TAGS:
            self._flush()

    def handle_data(self, data):
        if not self._skip:
            self._buf.append(data)

    def close(self):
        super().close()
        self._flush()


def html_to_lines(page: str) -> list[str]:
    parser = _TextLines()
    parser.feed(page)
    parser.close()
    return parser.lines


def _year_for(month: int, day: int, today: dt.date) -> int:
    """Pick the year that puts month/day closest to today (schedules span New Year)."""
    best = None
    for y in (today.year - 1, today.year, today.year + 1):
        try:
            cand = dt.date(y, month, day)
        except ValueError:
            continue
        if best is None or abs((cand - today).days) < abs((best - today).days):
            best = cand
    return best.year if best else today.year


def parse_date_line(line: str, today: dt.date):
    """Return (start, end, leftover_text) if the line starts with a date, else None."""
    iso = ISO_RE.match(line.strip())
    if iso:
        d = dt.date(int(iso["y"]), int(iso["m"]), int(iso["d"]))
        return d, d, line[iso.end():].strip(" :-–—|")

    m = DATE_RE.search(line)
    if not m:
        return None
    # The date has to lead the line (allowing a short label before it) so that
    # sentences like "...since October 2019" aren't mistaken for headings.
    if len(line[: m.start()].strip()) > 12:
        return None
    try:
        m1 = MONTHS[m["m1"].lower()]
        d1 = int(m["d1"])
        y1 = int(m["y1"] or m["y2"] or 0) or _year_for(m1, d1, today)
        start = dt.date(y1, m1, d1)
        end = start
        if m["d2"]:
            m2 = MONTHS[m["m2"].lower()] if m["m2"] else m1
            d2 = int(m["d2"])
            y2 = int(m["y2"]) if m["y2"] else (y1 + 1 if m2 < m1 else y1)
            end = dt.date(y2, m2, d2)
            if end < start or (end - start).days > 92:
                end = start
    except ValueError:
        return None
    return start, end, line[m.end():].strip(" :-–—|,")


def find_colours(text: str) -> list[str]:
    found: list[str] = []
    for m in COLOUR_RE.finditer(text):
        word = m.group(1).lower()
        if word not in found:
            found.append(word)
    return found


def _clean_reason(lines: list[str]) -> str:
    # Separate table cells / fragments ("Rainbow", "New Year's Eve") but let sentences flow.
    text = ""
    for line in lines:
        if text:
            text += " " if text[-1] in ".!?:;," else " · "
        text += line
    text = re.sub(r"\s+", " ", html.unescape(text)).strip(" -–—:|")
    return text


def parse_schedule(page: str, today: dt.date | None = None) -> list[dict]:
    today = today or dt.date.today()
    lines = [l for l in html_to_lines(page) if not NOISE_RE.match(l)]

    entries: list[dict] = []
    current = None
    for line in lines:
        parsed = parse_date_line(line, today)
        if parsed:
            start, end, rest = parsed
            # A bare repeated date (e.g. <time> followed by its visible text) is the same heading.
            if current and not current["lines"] and current["start"] == start and not rest:
                if end != start:
                    current["end"] = end
                continue
            if current:
                entries.append(current)
            current = {"start": start, "end": end, "lines": [rest] if rest else []}
        elif current is not None and len(current["lines"]) < 6:
            current["lines"].append(line)
    if current:
        entries.append(current)

    out = []
    seen = set()
    for e in entries:
        reason = _clean_reason(e["lines"])
        if not reason or len(reason) < 3:
            continue
        # Keep things tidy if a page footer slipped through.
        reason = reason[:600]
        key = (e["start"].isoformat(), reason.lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "start": e["start"].isoformat(),
                "end": e["end"].isoformat(),
                "description": reason,
                "colours": find_colours(reason),
            }
        )
    out.sort(key=lambda x: (x["start"], x["end"]))
    return out


def merge(existing: list[dict], fresh: list[dict], today: dt.date) -> list[dict]:
    """Keep past nights we've already recorded; let the fresh scrape win for today onward."""
    cutoff = today.isoformat()
    merged = [e for e in existing if e["end"] < cutoff] + fresh
    uniq, seen = [], set()
    for e in sorted(merged, key=lambda x: (x["start"], x["end"], x["description"])):
        key = (e["start"], e["end"], e["description"])
        if key not in seen:
            seen.add(key)
            uniq.append(e)
    return uniq


def fetch(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; cn-tower-colour-bot/1.0; +https://github.com/rajanmaghera/cn)",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-CA,en;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--url", default=SOURCE_URL)
    ap.add_argument("--html", help="parse a saved HTML file instead of fetching")
    ap.add_argument("--out", default=str(DATA_PATH))
    ap.add_argument("--today", help="override today's date (YYYY-MM-DD), for testing")
    args = ap.parse_args(argv)

    today = dt.date.fromisoformat(args.today) if args.today else dt.date.today()
    page = Path(args.html).read_text(encoding="utf-8") if args.html else fetch(args.url)
    fresh = parse_schedule(page, today)
    if not fresh:
        print("No schedule entries found; the page layout may have changed. Leaving data untouched.", file=sys.stderr)
        return 1

    out = Path(args.out)
    existing = []
    if out.exists():
        existing = json.loads(out.read_text(encoding="utf-8")).get("entries", [])
    entries = merge(existing, fresh, today)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "source": args.url,
                "updated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                "entries": entries,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(entries)} entries ({len(fresh)} from this scrape) to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
