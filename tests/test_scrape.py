import datetime as dt
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import scrape  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"
TODAY = dt.date(2026, 10, 13)


def parse(name, today=TODAY):
    return scrape.parse_schedule((FIXTURES / name).read_text(), today)


class ParseScheduleTest(unittest.TestCase):
    def test_card_layout_with_time_tags(self):
        entries = parse("cards.html")
        self.assertEqual(
            [(e["start"], e["end"]) for e in entries],
            [("2026-10-13", "2026-10-13"), ("2026-10-14", "2026-10-14"), ("2026-10-16", "2026-10-18")],
        )
        self.assertIn("Breast Cancer Awareness", entries[0]["description"])
        self.assertEqual(entries[0]["colours"], ["pink", "white"])
        self.assertEqual(entries[1]["colours"], ["purple"])
        self.assertEqual(entries[2]["colours"], ["blue", "yellow"])
        # Nav, footer and the "since October 2019" sentence must not leak in.
        blob = json.dumps(entries)
        self.assertNotIn("Buy Tickets", blob)
        self.assertNotIn("Canada Lands", blob)
        self.assertNotIn("Learn more", blob)

    def test_table_layout_spanning_new_year(self):
        entries = parse("table.html", dt.date(2026, 12, 20))
        self.assertEqual(
            [(e["start"], e["end"]) for e in entries],
            [("2026-12-31", "2026-12-31"), ("2027-01-01", "2027-01-01"), ("2027-01-26", "2027-02-01")],
        )
        self.assertEqual(entries[0]["colours"], ["rainbow"])
        self.assertEqual(entries[0]["colour_name"], "Rainbow")
        self.assertEqual(entries[2]["description"], "Lunar New Year celebrations")

    def test_inline_date_and_reason(self):
        entries = parse("inline.html")
        self.assertEqual(entries[0]["start"], "2026-10-13")
        self.assertEqual(entries[0]["description"], "Orange for Thanksgiving")
        self.assertEqual(entries[1]["colours"], ["teal"])

    def test_current_cntower_layout(self):
        entries = parse("cntower_2026.html")
        self.assertEqual(
            [(e["start"], e["colour_name"], e["description"]) for e in entries],
            [
                ("2026-10-12", "Teal", "DCD Awareness Week"),
                ("2026-10-13", "Green, Pink and Teal", "Metastatic Breast Cancer Awareness Day"),
                ("2026-10-13", "Red and Blue", "World Thrombosis Day"),
                ("2026-10-21", "Red and Black", "Toronto Raptor’s first home game. Let’s Go Raptors!"),
                ("2026-11-30", "Periwinkle", "Stomach Cancer Awareness Day"),
            ],
        )
        self.assertEqual(entries[1]["colours"], ["green", "pink", "teal"])
        self.assertEqual(entries[3]["colours"], ["red", "black"])

    def test_no_dates_returns_nothing(self):
        self.assertEqual(scrape.parse_schedule("<p>Nothing here</p>", TODAY), [])

    def test_multiword_colours(self):
        self.assertEqual(scrape.find_colours("Light blue and Royal Blue, then blue"), ["light blue", "royal blue", "blue"])


class MainTest(unittest.TestCase):
    def test_keeps_history_and_refreshes_future(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "schedule.json"
            old = {"start": "2026-10-01", "end": "2026-10-01", "description": "Old night", "colours": []}
            stale = {"start": "2026-10-20", "end": "2026-10-20", "description": "Cancelled", "colours": []}
            out.write_text(json.dumps({"entries": [old, stale]}))
            rc = scrape.main(["--html", str(FIXTURES / "cards.html"), "--out", str(out), "--today", "2026-10-13"])
            self.assertEqual(rc, 0)
            data = json.loads(out.read_text())
            descs = [e["description"] for e in data["entries"]]
            self.assertEqual(descs[0], "Old night")
            self.assertNotIn("Cancelled", descs)
            self.assertEqual(len(descs), 4)

    def test_empty_scrape_leaves_file_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "schedule.json"
            out.write_text('{"entries": []}')
            empty = Path(tmp) / "empty.html"
            empty.write_text("<p>Site is down</p>")
            self.assertEqual(scrape.main(["--html", str(empty), "--out", str(out)]), 1)
            self.assertEqual(out.read_text(), '{"entries": []}')


if __name__ == "__main__":
    unittest.main()
