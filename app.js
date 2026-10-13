// Why is the CN Tower that colour? Reads data/schedule.json (kept fresh by
// scripts/scrape.py on a schedule) and explains the lighting for a given night.

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
const TZ = "America/Toronto";
// Before this hour in Toronto, "tonight" still means the evening that just started yesterday.
const NIGHT_ENDS_AT_HOUR = 6;

const $ = (id) => document.getElementById(id);
let entries = [];
let current;

// --- dates (all handled as YYYY-MM-DD strings in Toronto time) -------------

function torontoParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
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

function fmt(iso, opts) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", ...opts });
}

function relativeLabel(iso) {
  const diff = Math.round((new Date(`${iso}T12:00:00Z`) - new Date(`${tonight()}T12:00:00Z`)) / 864e5);
  if (diff === 0) return "Tonight";
  if (diff === -1) return "Last night";
  if (diff === 1) return "Tomorrow night";
  return fmt(iso, { weekday: "short", month: "short", day: "numeric", year: diff < -300 || diff > 300 ? "numeric" : undefined });
}

// --- data -----------------------------------------------------------------

function entriesFor(iso) {
  return entries.filter((e) => e.start <= iso && iso <= e.end);
}

function coloursOf(list) {
  const out = [];
  for (const e of list) for (const c of e.colours || []) if (!out.includes(c)) out.push(c);
  return out;
}

function listWords(words) {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

// --- rendering --------------------------------------------------------------

function paintTower(colours, mode) {
  const svg = $("tower");
  const grad = $("light");
  svg.classList.toggle("rainbow", mode === "rainbow");
  svg.classList.toggle("dark", mode === "dark");

  const stops = mode === "rainbow" ? RAINBOW : colours.map((c) => COLOURS[c]).filter(Boolean);
  const palette = stops.length ? stops : ["#ffffff"];
  // Bands from the base upward, with a soft blend between neighbours.
  grad.innerHTML = palette
    .flatMap((c, i) => {
      const a = (i / palette.length) * 100;
      const b = ((i + 1) / palette.length) * 100;
      return [`<stop offset="${a + (i ? 4 : 0)}%" stop-color="${c}"/>`, `<stop offset="${b - (i < palette.length - 1 ? 4 : 0)}%" stop-color="${c}"/>`];
    })
    .join("");
  document.documentElement.style.setProperty("--lit", mode === "dark" ? "#2a2f4a" : palette[0]);
  document.documentElement.style.setProperty("--accent", palette.find((c) => c !== "#f4f6fb") || "#ff5fa2");
}

function swatch(colour) {
  const dot = document.createElement("i");
  if (colour === "rainbow") dot.style.background = `conic-gradient(${RAINBOW.join(",")},${RAINBOW[0]})`;
  else dot.style.background = COLOURS[colour] || "#fff";
  dot.style.color = COLOURS[colour] || "#fff";
  dot.title = colour;
  return dot;
}

function chip(colour) {
  const el = document.createElement("span");
  el.className = "chip";
  el.append(swatch(colour), colour);
  return el;
}

// label: plain text, or an entry whose colours become the label ("● ● Red and Blue").
function reasonCard(entry, label) {
  const card = document.createElement("article");
  card.className = "reason";
  const l = document.createElement("p");
  l.className = "label";
  if (typeof label === "string") l.textContent = label;
  else l.append(...(label.colours || []).map(swatch), label.colour_name || listWords(label.colours || []) || "Special lighting");
  const p = document.createElement("p");
  p.textContent = entry.description;
  card.append(l, p);
  if (entry.start !== entry.end) {
    const r = document.createElement("p");
    r.className = "range";
    r.textContent = `Lit this way ${fmt(entry.start, { month: "long", day: "numeric" })} – ${fmt(entry.end, { month: "long", day: "numeric" })}`;
    card.append(r);
  }
  return card;
}

function render(iso) {
  current = iso;
  const when = relativeLabel(iso);
  $("when").textContent = when;
  $("date").value = iso;
  if (location.hash.slice(1) !== iso) history.replaceState(null, "", iso === tonight() ? location.pathname : `#${iso}`);

  const found = entriesFor(iso);
  const colours = coloursOf(found);
  const isPast = iso < tonight();
  const verb = isPast ? "was" : iso === tonight() ? "is" : "will be";
  const chips = $("chips");
  const reasons = $("reasons");
  chips.replaceChildren();
  reasons.replaceChildren();

  if (found.length) {
    const onlyRainbow = colours.length > 0 && colours.every((c) => c === "rainbow");
    const one = found.length === 1 ? found[0] : null;
    let headline;
    if (!one) headline = `${when}, the CN Tower ${verb} lit up for ${found.length} causes`;
    else if (onlyRainbow) headline = `${when}, the CN Tower ${verb} lit in rainbow colours`;
    else if (one.colour_name) headline = `${when}, the CN Tower ${verb} lit ${one.colour_name.toLowerCase()}`;
    else if (colours.length) headline = `${when}, the CN Tower ${verb} lit ${listWords(colours)}`;
    else headline = `${when}, the CN Tower ${verb} lit up for something special`;
    $("headline").textContent = headline;
    paintTower(colours, onlyRainbow ? "rainbow" : "colour");
    if (one) {
      colours.forEach((c) => chips.append(chip(c)));
      reasons.append(reasonCard(one, "Why"));
    } else {
      // Several causes share the night; each card says which colours belong to it.
      found.forEach((e) => reasons.append(reasonCard(e, e)));
    }
  } else if (!entries.length) {
    $("headline").textContent = "The lighting schedule hasn't been fetched yet";
    paintTower([], "rainbow");
    reasons.append(reasonCard({ description: "Check back soon. The schedule is refreshed from cntower.ca automatically every few hours." }, "Hang tight"));
  } else if (!isCovered(iso)) {
    $("headline").textContent = `${when}: not on the schedule yet`;
    paintTower([], "dark");
    reasons.append(reasonCard({ description: iso > lastDate()
      ? "The CN Tower only publishes its lighting a few weeks ahead, so nothing has been announced for this night yet."
      : "This night is from before we started keeping track, so we don't know why it was lit." }, "Unknown"));
  } else {
    $("headline").textContent = `${when}, the CN Tower ${isPast ? "had" : iso === tonight() ? "has" : "will have"} its regular nightly lights`;
    paintTower([], "rainbow");
    reasons.append(reasonCard({ description: "No special lighting is scheduled, so the tower runs its standard nightly light show rather than a colour picked for a cause, holiday or event." }, "Why"));
  }

  renderUpcoming(iso);
}

function firstDate() { return entries.length ? entries[0].start : null; }
function lastDate() { return entries.reduce((m, e) => (e.end > m ? e.end : m), ""); }
function isCovered(iso) { return entries.length && iso >= firstDate() && iso <= lastDate(); }

function renderUpcoming(from) {
  const list = $("upcoming");
  list.replaceChildren();
  const days = [];
  for (let d = addDays(from, 1); days.length < 7 && d <= lastDate(); d = addDays(d, 1)) {
    const found = entriesFor(d);
    if (found.length) days.push([d, found]);
  }
  $("upcoming-wrap").hidden = !days.length;
  for (const [d, found] of days) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const day = document.createElement("span");
    day.className = "day";
    day.textContent = relativeLabel(d) === "Tomorrow night" ? "Tomorrow" : fmt(d, { weekday: "short", month: "short", day: "numeric" });
    const dots = document.createElement("span");
    dots.className = "dots";
    for (const c of coloursOf(found).slice(0, 4)) dots.append(swatch(c));
    const desc = document.createElement("span");
    desc.className = "desc";
    desc.textContent = found.map((e) => e.description).join(" / ");
    b.append(day, dots, desc);
    b.addEventListener("click", () => { render(d); window.scrollTo({ top: 0, behavior: "smooth" }); });
    li.append(b);
    list.append(li);
  }
}

// --- boot -------------------------------------------------------------------

$("prev").addEventListener("click", () => render(addDays(current, -1)));
$("next").addEventListener("click", () => render(addDays(current, 1)));
$("date").addEventListener("change", (e) => e.target.value && render(e.target.value));
window.addEventListener("hashchange", () => {
  const h = location.hash.slice(1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(h) && h !== current) render(h);
});
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (e.key === "ArrowLeft") render(addDays(current, -1));
  if (e.key === "ArrowRight") render(addDays(current, 1));
});

(async function boot() {
  const hash = location.hash.slice(1);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(hash) ? hash : tonight();
  try {
    const res = await fetch("data/schedule.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    entries = (data.entries || []).slice().sort((a, b) => a.start.localeCompare(b.start));
    if (data.source) $("source").href = data.source;
    if (data.updated) {
      $("updated").textContent = ` · updated ${new Date(data.updated).toLocaleString("en-CA", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" })}`;
    }
  } catch (err) {
    console.error("Could not load schedule", err);
  }
  render(start);
})();
