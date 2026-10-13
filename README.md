# Why is the CN Tower that colour?

A small website that tells you what colour the CN Tower is lit tonight (or any other night) and **why**.

It draws a glowing CN Tower in that night's colours and shows the reason from the
[official CN Tower lighting schedule](https://www.cntower.ca/lighting-schedule). You can step
through nights with the arrows (or ←/→), pick any date, and share a link to a specific night
(`…/#2026-10-31`).

## iPhone widget

`widget/cn-tower.js` is a [Scriptable](https://scriptable.app) widget that shows small CN Tower(s)
in tonight's colours, one per cause, with the reasons next to them.

1. Install Scriptable from the App Store.
2. Open https://rajanmaghera.github.io/cn/widget/cn-tower.js, copy all of it, and paste it into a
   new script in Scriptable (name it something like "CN Tower").
3. Add a Scriptable widget to your Home Screen (small, medium or large) or Lock Screen
   (rectangular or inline), long-press it → Edit Widget, and pick the script.

Tapping the widget opens tonight on the website. To preview a different night, set the widget's
Parameter to a date such as `2026-10-31`. The widget reads the same `data/schedule.json` as the
site, and keeps the last copy so it still shows something when you're offline.

## How it works

- `scripts/scrape.py` fetches cntower.ca's lighting schedule and writes `data/schedule.json`
  (date range, description and the colour words found in it). It uses only the Python standard
  library and parses the page as text instead of relying on CSS selectors, so small redesigns
  of cntower.ca shouldn't break it. Nights already recorded stay in the file, so you can look
  back at past nights too.
- `.github/workflows/site.yml` runs the tests, scrapes every 6 hours, commits any schedule
  changes and deploys the site to GitHub Pages.
- `index.html`, `style.css` and `app.js` are a static page that reads `data/schedule.json`.
  "Tonight" uses Toronto time, and until 6 a.m. it still means the previous evening.

## Setup

1. In the repo settings, go to **Pages** and set **Source** to **GitHub Actions**.
2. Run the **Update schedule and deploy** workflow once (Actions tab → Run workflow), or wait for
   the next scheduled run.

## Run it locally

```sh
python3 scripts/scrape.py           # refresh data/schedule.json
python3 -m http.server              # then open http://localhost:8000
python3 -m unittest discover -s tests -t tests
```

If cntower.ca changes its layout so much that nothing can be parsed, the scraper exits with an
error and leaves the existing data alone, and the workflow run goes red.
