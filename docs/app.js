/* Ursus -> Centrum departure board */

const HORIZON_MIN = 120;   // show departures up to 2 h ahead
const MAX_ROWS = 12;
const DELAYS_URL = "https://ursus-delays.enzhukov.workers.dev";
const DELAYS_MAX_AGE_MIN = 10;  // ignore the feed if its own timestamp is older

const ABOUT_HTML =
  '<div class="about">Ten rozkład odjazdów pokazuje pociągi SKM i KM ' +
  'odjeżdżające z dwóch stacji: WU – Warszawa Ursus, ' +
  'UP – Warszawa Ursus Północny</div>';

let timetable = [];
let predictions = {};      // "trip_id:seq" -> predicted Date
let feedTimestamp = null;  // Date from the feed itself
let delaysOk = false;
let generated = null;
let lastBoardHtml = "";    // avoid DOM rewrites that would restart marquees

async function loadTimetable() {
  try {
    const r = await fetch("timetable.json", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    timetable = data.departures || [];
    generated = data.generated || null;
  } catch (e) {
    console.error("timetable load failed", e);
  }
}

async function loadDelays() {
  try {
    const r = await fetch(DELAYS_URL, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();

    feedTimestamp = data.timestamp ? new Date(data.timestamp) : null;
    const ageMin = feedTimestamp ? (Date.now() - feedTimestamp) / 60000 : Infinity;
    if (ageMin > DELAYS_MAX_AGE_MIN) {
      // upstream feed is stuck - don't trust stale predictions
      delaysOk = false;
      predictions = {};
      return;
    }

    const next = {};
    for (const u of data.trip_updates || []) {
      for (const st of u.stop_times || []) {
        const t = st.departure || st.arrival;
        if (t) next[u.trip_id + ":" + st.stop_sequence] = new Date(t);
      }
    }
    predictions = next;
    delaysOk = true;
  } catch (e) {
    delaysOk = false;
    console.warn("delays unavailable", e);
  }
}

function fmtDate(now) {
  return now.toLocaleDateString("pl-PL",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function setBoardHtml(html) {
  if (html === lastBoardHtml) return;
  document.getElementById("board").innerHTML = html;
  lastBoardHtml = html;
  setupMarquees();
}

function setupMarquees() {
  document.querySelectorAll(".dest").forEach(el => {
    const inner = el.querySelector(".in");
    if (!inner || !inner.textContent) return;
    if (inner.scrollWidth <= el.clientWidth + 2) return; // fits, stay static

    const text = inner.textContent;
    inner.textContent = text + "\u00A0".repeat(6) + text; // loop copy + gap
    const shift = inner.scrollWidth / 2;                  // one copy + gap
    el.style.setProperty("--shift", shift + "px");
    el.style.setProperty("--dur", Math.max(7, shift / 22) + "s");
    el.classList.add("scroll");
  });
}

function render() {
  const now = new Date();
  document.getElementById("date").textContent = fmtDate(now);
  document.getElementById("clock").textContent =
    now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });

  if (!timetable.length) {
    setBoardHtml(
      '<div class="empty">Brak danych rozkładu.<br>' +
      'Uruchom akcję „Rebuild timetable” w GitHub Actions.</div>');
    return;
  }

  const rows = timetable
    .map(d => {
      const scheduled = new Date(d.time);
      let dep = scheduled;
      let delayMin = 0;
      if (delaysOk && d.seq !== undefined) {
        const pred = predictions[d.trip_id + ":" + d.seq];
        // guard: a trip_id repeats on multiple days; only apply a
        // prediction that is close to this row's scheduled time
        if (pred && Math.abs(pred - scheduled) < 6 * 3600 * 1000) {
          dep = pred;
          delayMin = Math.round((pred - scheduled) / 60000);
        }
      }
      return { ...d, dep, delayMin };
    })
    .filter(d => d.dep >= now && (d.dep - now) / 60000 <= HORIZON_MIN)
    .sort((a, b) => a.dep - b.dep)
    .slice(0, MAX_ROWS);

  if (!rows.length) {
    setBoardHtml(
      '<div class="empty">Brak odjazdów w najbliższych ' +
      HORIZON_MIN + ' minutach.</div>');
  } else {
    setBoardHtml(rows.map(d => {
      const mins = Math.floor((d.dep - now) / 60000);
      const hm = d.dep.toLocaleTimeString("pl-PL",
        { hour: "2-digit", minute: "2-digit" });
      const soon = mins <= 5 ? " soon" : "";
      const leaving = mins <= 1 ? " leaving" : "";
      const delay = d.delayMin >= 1
        ? ` <span class="delay">+${d.delayMin}'</span>`
        : "";
      const dest = d.headsign || "";
      return `<div class="row${leaving}">
        <span class="st">${d.station}</span>
        <span class="mins${soon}">${mins}'</span>
        <span class="hm">(${hm})</span>
        <span class="line">${d.line}${delay}</span>
        <span class="dest"><span class="in">${dest}</span></span>
      </div>`;
    }).join(""));
  }

  const parts = [];
  if (generated) {
    parts.push("rozkład: " +
      new Date(generated).toLocaleDateString("pl-PL",
        { day: "numeric", month: "numeric" }));
  }
  if (delaysOk && feedTimestamp) {
    parts.push("opóźnienia zaktualizowano: " +
      feedTimestamp.toLocaleTimeString("pl-PL",
        { hour: "2-digit", minute: "2-digit" }));
  } else if (feedTimestamp) {
    parts.push('<span class="warn">opóźnienia nieaktualne</span>');
  } else {
    parts.push('<span class="warn">opóźnienia niedostępne</span>');
  }
  document.getElementById("status").innerHTML =
    parts.join(" · ") + ABOUT_HTML;
}

(async () => {
  await loadTimetable();
  render();
  loadDelays().then(render);

  setInterval(render, 1000);
  setInterval(() => loadDelays().then(render), 60 * 1000);
  setInterval(() => loadTimetable().then(render), 30 * 60 * 1000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { render(); loadDelays().then(render); }
  });
})();
