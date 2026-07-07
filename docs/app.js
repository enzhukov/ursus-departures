/* Ursus -> Centrum departure board */

const HORIZON_MIN = 120;   // show departures up to 2 h ahead
const MAX_ROWS = 12;
const DELAYS_URL = "https://mkuran.pl/gtfs/polish_trains/updates.json";

let timetable = [];        // from timetable.json
let delays = {};           // trip_id -> delay in seconds
let delaysTimestamp = null;
let delaysAvailable = false;
let generated = null;

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

    // NOTE: adapt this mapping to the real schema of updates.json.
    // Expected shape (verify once in the browser console):
    //   an array/object of trip updates, each with a trip_id and a delay.
    const next = {};
    const list = Array.isArray(data) ? data : (data.updates || data.trips || []);
    for (const u of list) {
      const id = u.trip_id || (u.trip && u.trip.trip_id);
      const delay = u.delay ?? (u.arrival && u.arrival.delay) ?? null;
      if (id != null && delay != null) next[id] = Number(delay);
    }
    delays = next;
    delaysTimestamp = new Date();
    delaysAvailable = true;
  } catch (e) {
    // CORS block or feed down -> board still works, just without delays
    delaysAvailable = false;
    console.warn("delays unavailable", e);
  }
}

function fmtDate(now) {
  return now.toLocaleDateString("pl-PL",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function render() {
  const now = new Date();
  document.getElementById("date").textContent = fmtDate(now);
  document.getElementById("clock").textContent =
    now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });

  const board = document.getElementById("board");

  if (!timetable.length) {
    board.innerHTML =
      '<div class="empty">Brak danych rozkładu.<br>' +
      'Uruchom akcję „Rebuild timetable” w GitHub Actions.</div>';
    return;
  }

  const rows = timetable
    .map(d => {
      const delaySec = delays[d.trip_id] ?? 0;
      const dep = new Date(new Date(d.time).getTime() + delaySec * 1000);
      return { ...d, dep, delayMin: Math.round(delaySec / 60) };
    })
    .filter(d => d.dep >= now && (d.dep - now) / 60000 <= HORIZON_MIN)
    .sort((a, b) => a.dep - b.dep)
    .slice(0, MAX_ROWS);

  if (!rows.length) {
    board.innerHTML =
      '<div class="empty">Brak odjazdów w najbliższych ' +
      HORIZON_MIN + ' minutach.</div>';
  } else {
    board.innerHTML = rows.map(d => {
      const mins = Math.floor((d.dep - now) / 60000);
      const hm = d.dep.toLocaleTimeString("pl-PL",
        { hour: "2-digit", minute: "2-digit" });
      const soon = mins <= 5 ? " soon" : "";
      const leaving = mins <= 1 ? " leaving" : "";
      const delay = d.delayMin > 0
        ? `<span class="delay">+${d.delayMin}'</span>`
        : "<span></span>";
      return `<div class="row${leaving}">
        <span class="st">${d.station}</span>
        <span class="mins${soon}">${mins}'</span>
        <span class="hm">(${hm})</span>
        <span class="line">${d.line}</span>
        ${delay}
      </div>`;
    }).join("");
  }

  const parts = [];
  if (generated) {
    parts.push("rozkład: " +
      new Date(generated).toLocaleDateString("pl-PL",
        { day: "numeric", month: "numeric" }));
  }
  if (delaysAvailable && delaysTimestamp) {
    parts.push("opóźnienia: " + delaysTimestamp.toLocaleTimeString("pl-PL",
      { hour: "2-digit", minute: "2-digit" }));
  } else {
    parts.push('<span class="warn">opóźnienia niedostępne</span>');
  }
  document.getElementById("status").innerHTML = parts.join(" · ");
}

(async () => {
  await loadTimetable();
  render();
  loadDelays().then(render);

  setInterval(render, 1000);                 // tick clock + countdowns
  setInterval(() => loadDelays().then(render), 60 * 1000);
  setInterval(() => loadTimetable().then(render), 30 * 60 * 1000);

  // recompute immediately when the phone wakes up / tab becomes visible
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { render(); loadDelays().then(render); }
  });
})();
