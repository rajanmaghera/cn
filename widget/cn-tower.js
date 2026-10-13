// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: broadcast-tower;

// CN Tower tonight — a Scriptable widget showing what colour the CN Tower is lit
// tonight and why. Data comes from the same schedule the website uses, which is
// refreshed from cntower.ca every few hours.
//
// Works as a small, medium or large Home Screen widget, and as a rectangular or
// inline Lock Screen widget. Tap it to open tonight on the website.

const SITE = "https://rajanmaghera.github.io/cn/";
const DATA_URL = `${SITE}data/schedule.json`;
const TZ = "America/Toronto";
// Before this hour in Toronto, "tonight" still means the evening that just started yesterday.
const NIGHT_ENDS_AT_HOUR = 6;

// Keep in sync with COLOURS in app.js.
const COLOURS = {
  red: "#e0202c", crimson: "#c8102e", maroon: "#7a1022", burgundy: "#800020",
  pink: "#ff5fa2", magenta: "#e0249a", fuchsia: "#e0249a", orange: "#ff7a1a",
  amber: "#ffb000", gold: "#f5c400", yellow: "#ffe11a", lime: "#9be22d",
  green: "#1fbf4c", emerald: "#10a36a", teal: "#14b3a6", turquoise: "#2fd4c8",
  aqua: "#33e0e6", cyan: "#33e0e6", "light blue": "#5cc8ff", "sky blue": "#5cc8ff",
  blue: "#2563ff", navy: "#1b2f8f", "royal blue": "#2848d8", indigo: "#4b2fd6",
  violet: "#8f4dff", purple: "#8a2be2", lavender: "#b38cff", lilac: "#c39bff",
  periwinkle: "#8f9cff", silver: "#c9d1dc", white: "#f4f6fb", grey: "#8a8f9c", gray: "#8a8f9c",
  black: "#26262e", brown: "#8a5a2b",
};
const RAINBOW = ["#ff2a2a", "#ff9a1a", "#ffe11a", "#1fbf4c", "#2563ff", "#8a2be2"];
const UNLIT = "#2a2f4a";

const TEXT = new Color("#eef1ff");
const MUTED = new Color("#9aa3c7");

// --- dates (YYYY-MM-DD strings in Toronto time) ------------------------------

function torontoParts(date = new Date()) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(date)) parts[p.type] = p.value;
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function tonight() {
  const { iso, hour } = torontoParts();
  return hour < NIGHT_ENDS_AT_HOUR ? addDays(iso, -1) : iso;
}

function shortDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

// --- data ----------------------------------------------------------------------

async function loadSchedule() {
  const fm = FileManager.local();
  const cache = fm.joinPath(fm.cacheDirectory(), "cn-tower-schedule.json");
  try {
    const req = new Request(DATA_URL);
    req.timeoutInterval = 15;
    const data = await req.loadJSON();
    if (!Array.isArray(data.entries)) throw new Error("unexpected response");
    fm.writeString(cache, JSON.stringify(data));
    return data;
  } catch (err) {
    // Offline or the site is down: fall back to the last copy we saw.
    if (fm.fileExists(cache)) return JSON.parse(fm.readString(cache));
    throw err;
  }
}

function entriesFor(entries, iso) {
  return entries.filter((e) => e.start <= iso && iso <= e.end);
}

function paletteOf(entry) {
  const colours = entry ? entry.colours || [] : [];
  if (colours.includes("rainbow")) return RAINBOW;
  const hexes = colours.map((c) => COLOURS[c]).filter(Boolean);
  return hexes.length ? hexes : ["#ffffff"];
}

function colourLabel(entry) {
  if (entry.colour_name) return entry.colour_name;
  const c = entry.colours || [];
  if (c.length <= 1) return c[0] || "Special lighting";
  return `${c.slice(0, -1).join(", ")} and ${c[c.length - 1]}`;
}

// --- drawing the tower(s) ---------------------------------------------------------

// The site's tower outline, in its SVG units (x 30–170, y 0–620).
const VIEW = { x: 30, w: 140, h: 620, cx: 100 };
const TOWER = [
  [[98.6, 8], [101.4, 8], [101.4, 100], [98.6, 100]], // antenna
  [[93, 96], [107, 96], [109, 99], [109, 103], [107, 106], [93, 106], [91, 103], [91, 99]], // SkyPod
  [[96.5, 106], [103.5, 106], [105, 160], [95, 160]], // upper shaft
  [[80, 160], [120, 160], [127, 162], [130, 168], [130, 178], [127, 188], [118, 192],
    [82, 192], [73, 188], [70, 178], [70, 168], [73, 162]], // main pod
  [[93, 192], [107, 192], [118, 612], [82, 612]], // main shaft and legs
  [[88, 250], [93, 250], [76, 612], [66, 612]],
  [[107, 250], [112, 250], [134, 612], [124, 612]],
];
const WINDOWS = [[74, 172, 52, 3], [93, 100, 14, 2]];
const TOP = 8;
const BOTTOM = 612;

// Clip a polygon to the horizontal slab y0 <= y <= y1 (Sutherland–Hodgman).
function clipSlab(poly, y0, y1) {
  const clip = (pts, inside, cross) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (inside(a)) {
        out.push(a);
        if (!inside(b)) out.push(cross(a, b));
      } else if (inside(b)) {
        out.push(cross(a, b));
      }
    }
    return out;
  };
  const at = (y) => (a, b) => [a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), y];
  let pts = clip(poly, (p) => p[1] >= y0, at(y0));
  pts = clip(pts, (p) => p[1] <= y1, at(y1));
  return pts;
}

function fillPoly(ctx, pts, map) {
  if (pts.length < 3) return;
  const path = new Path();
  path.move(map(pts[0]));
  for (const p of pts.slice(1)) path.addLine(map(p));
  path.closeSubpath();
  ctx.addPath(path);
  ctx.fillPath();
}

// Draw one tower per palette, side by side, coloured in bands from the base up
// like the website. A couple of wider, faint passes stand in for the glow.
function drawTowers(palettes, width, height, { unlit = false } = {}) {
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const n = palettes.length;
  const scale = Math.min(height / VIEW.h, width / n / VIEW.w);
  const towerW = VIEW.w * scale;
  const total = towerW * n;
  const top = height - VIEW.h * scale;

  palettes.forEach((palette, i) => {
    const ox = (width - total) / 2 + i * towerW;
    const map = (spread) => ([x, y]) =>
      new Point(ox + (VIEW.cx + (x - VIEW.cx) * spread - VIEW.x) * scale, top + y * scale);
    const bandH = (BOTTOM - TOP) / palette.length;
    const passes = unlit ? [[1, 1]] : [[1.9, 0.08], [1.4, 0.16], [1, 1]];
    for (const [spread, alpha] of passes) {
      palette.forEach((hex, b) => {
        // Band 0 is at the base.
        const y1 = BOTTOM - b * bandH;
        const y0 = y1 - bandH;
        ctx.setFillColor(new Color(unlit ? UNLIT : hex, alpha));
        for (const poly of TOWER) fillPoly(ctx, clipSlab(poly, y0, y1), map(spread));
      });
    }
    ctx.setFillColor(new Color("#ffffff", unlit ? 0.35 : 0.55));
    for (const [x, y, w, h] of WINDOWS) {
      fillPoly(ctx, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], map(1));
    }
  });
  return ctx.getImage();
}

// Width that fits n towers at full height, capped at maxWidth.
function towersWidth(n, height, maxWidth) {
  return Math.min(maxWidth, Math.round((n * VIEW.w * height) / VIEW.h));
}

function dots(stack, entry, size) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.spacing = Math.round(size / 3);
  const colours = (entry.colours || []).slice(0, 4);
  for (const c of colours) {
    const dot = row.addStack();
    dot.size = new Size(size, size);
    dot.cornerRadius = size / 2;
    dot.backgroundColor = new Color(c === "rainbow" ? RAINBOW[0] : COLOURS[c] || "#ffffff");
    if (c === "rainbow") {
      const g = new LinearGradient();
      g.colors = RAINBOW.map((h) => new Color(h));
      g.locations = RAINBOW.map((_, i) => i / (RAINBOW.length - 1));
      dot.backgroundGradient = g;
    }
  }
  return row;
}

// --- widget layouts -------------------------------------------------------------

function background(widget) {
  const g = new LinearGradient();
  g.colors = [new Color("#05060f"), new Color("#141a3a")];
  g.locations = [0, 1];
  widget.backgroundGradient = g;
}

function label(stack, text, size = 10) {
  const t = stack.addText(text.toUpperCase());
  t.font = Font.semiboldSystemFont(size);
  t.textColor = MUTED;
  t.lineLimit = 1;
  return t;
}

function headerText(iso) {
  return iso === tonight() ? "Tonight" : shortDate(iso);
}

// One cause: colour dots + colour name, then the reason.
function causeBlock(stack, entry, { nameSize, reasonSize, reasonLines }) {
  const block = stack.addStack();
  block.layoutVertically();
  block.spacing = 2;
  const top = block.addStack();
  top.layoutHorizontally();
  top.centerAlignContent();
  top.spacing = 5;
  dots(top, entry, Math.round(nameSize * 0.75));
  const name = top.addText(colourLabel(entry));
  name.font = Font.semiboldSystemFont(nameSize);
  name.textColor = MUTED;
  name.lineLimit = 1;
  name.minimumScaleFactor = 0.7;
  const reason = block.addText(entry.description);
  reason.font = Font.semiboldSystemFont(reasonSize);
  reason.textColor = TEXT;
  reason.lineLimit = reasonLines;
  reason.minimumScaleFactor = 0.8;
  return block;
}

function noLightingText(state) {
  if (state === "unknown") return "Not announced yet";
  if (state === "empty") return "Schedule not loaded yet";
  return "Regular nightly lights";
}

function buildHomeWidget(family, iso, found, state, upcoming) {
  const w = new ListWidget();
  background(w);
  const palettes = found.length ? found.map(paletteOf) : [state === "unknown" ? [UNLIT] : RAINBOW];
  const unlit = !found.length && state === "unknown";

  if (family === "small") {
    w.setPadding(12, 12, 12, 12);
    const row = w.addStack();
    row.layoutHorizontally();
    row.topAlignContent();
    row.spacing = 8;
    const towerW = towersWidth(palettes.length, 130, 64);
    const img = row.addImage(drawTowers(palettes, towerW, 130, { unlit }));
    img.imageSize = new Size(towerW, 130);
    const col = row.addStack();
    col.layoutVertically();
    col.spacing = 6;
    label(col, headerText(iso));
    if (found.length) {
      const lines = found.length > 1 ? 2 : 5;
      for (const e of found.slice(0, 2)) causeBlock(col, e, { nameSize: 9, reasonSize: 12, reasonLines: lines });
      if (found.length > 2) label(col, `+${found.length - 2} more`, 9);
    } else {
      const t = col.addText(noLightingText(state));
      t.font = Font.semiboldSystemFont(13);
      t.textColor = TEXT;
    }
    col.addSpacer();
    return w;
  }

  // medium and large
  w.setPadding(14, 16, 14, 16);
  const row = w.addStack();
  row.layoutHorizontally();
  row.topAlignContent();
  row.spacing = 14;
  const towerH = family === "large" ? 190 : 128;
  const towerW = towersWidth(palettes.length, towerH, family === "large" ? 130 : 100);
  const img = row.addImage(drawTowers(palettes, towerW, towerH, { unlit }));
  img.imageSize = new Size(towerW, towerH);
  const col = row.addStack();
  col.layoutVertically();
  col.spacing = 7;
  const head = found.length > 1 ? `${headerText(iso)} · ${found.length} causes` : headerText(iso);
  label(col, head, 11);
  if (found.length) {
    const max = family === "large" ? 4 : 3;
    const lines = family === "large" ? (found.length > 2 ? 2 : 3) : found.length > 1 ? 1 : 3;
    for (const e of found.slice(0, max)) causeBlock(col, e, { nameSize: 10, reasonSize: found.length > 1 ? 13 : 15, reasonLines: lines });
    if (found.length > max) label(col, `+${found.length - max} more`, 10);
  } else {
    const t = col.addText(noLightingText(state));
    t.font = Font.semiboldSystemFont(15);
    t.textColor = TEXT;
  }
  col.addSpacer();

  if (family === "large" && upcoming.length) {
    w.addSpacer(12);
    label(w, "Coming up", 11);
    w.addSpacer(6);
    for (const [day, list] of upcoming.slice(0, 6)) {
      const r = w.addStack();
      r.layoutHorizontally();
      r.centerAlignContent();
      r.spacing = 8;
      const dayCol = r.addStack();
      dayCol.size = new Size(84, 0);
      const d = dayCol.addText(shortDate(day));
      d.font = Font.semiboldSystemFont(12);
      d.textColor = TEXT;
      d.lineLimit = 1;
      dayCol.addSpacer();
      const dotCol = r.addStack();
      dotCol.size = new Size(44, 0);
      dots(dotCol, { colours: [...new Set(list.flatMap((e) => e.colours || []))] }, 8);
      dotCol.addSpacer();
      const t = r.addText(list.map((e) => e.description).join(" / "));
      t.font = Font.systemFont(12);
      t.textColor = MUTED;
      t.lineLimit = 1;
      w.addSpacer(5);
    }
  }
  w.addSpacer();
  return w;
}

function buildAccessoryWidget(family, iso, found, state) {
  const w = new ListWidget();
  const colours = found.map(colourLabel);
  if (family === "accessoryInline") {
    w.addText(found.length ? `CN Tower: ${colours.join(" · ")}` : `CN Tower: ${noLightingText(state)}`);
    return w;
  }
  // Three lines fit: "CN Tower · <colours>" and two lines of reason.
  const head = w.addText(found.length ? `CN Tower · ${colourLabel(found[0])}` : `CN Tower · ${headerText(iso)}`);
  head.font = Font.boldSystemFont(13);
  head.lineLimit = 1;
  head.minimumScaleFactor = 0.7;
  const body = found.length
    ? found.length > 1 ? `${found[0].description} (+${found.length - 1} more)` : found[0].description
    : noLightingText(state);
  const r = w.addText(body);
  r.font = Font.systemFont(13);
  r.lineLimit = 2;
  return w;
}

function errorWidget(message) {
  const w = new ListWidget();
  background(w);
  label(w, "CN Tower");
  w.addSpacer(4);
  const t = w.addText(message);
  t.font = Font.systemFont(12);
  t.textColor = TEXT;
  return w;
}

// --- main -------------------------------------------------------------------------

async function main() {
  // Long-press the widget → Edit Widget → Parameter: a date like 2026-10-31 to preview that night.
  const param = (args.widgetParameter || "").trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : tonight();
  const family = config.widgetFamily || "medium";

  let widget;
  try {
    const data = await loadSchedule();
    const entries = data.entries || [];
    const found = entriesFor(entries, iso);
    const first = entries.reduce((m, e) => (!m || e.start < m ? e.start : m), "");
    const last = entries.reduce((m, e) => (e.end > m ? e.end : m), "");
    const state = !entries.length ? "empty" : iso < first || iso > last ? "unknown" : "regular";
    const upcoming = [];
    for (let d = addDays(iso, 1); upcoming.length < 6 && d <= last; d = addDays(d, 1)) {
      const list = entriesFor(entries, d);
      if (list.length) upcoming.push([d, list]);
    }
    widget = family.startsWith("accessory")
      ? buildAccessoryWidget(family, iso, found, state)
      : buildHomeWidget(family, iso, found, state, upcoming);
  } catch (err) {
    widget = errorWidget("Couldn't load the lighting schedule. It'll try again soon.");
  }

  widget.url = iso === tonight() ? SITE : `${SITE}#${iso}`;
  // Check again in an hour; the schedule itself only changes every few hours.
  widget.refreshAfterDate = new Date(Date.now() + 60 * 60 * 1000);

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else if (family === "small") {
    await widget.presentSmall();
  } else if (family === "large") {
    await widget.presentLarge();
  } else {
    await widget.presentMedium();
  }
  Script.complete();
}

await main();
