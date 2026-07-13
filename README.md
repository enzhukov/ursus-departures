# Ursus → Centrum / Back to Ursus

Two minimal, phone-friendly departure boards:

- **Ursus → Centrum** — trains from **Warszawa Ursus (WU)** and
  **Warszawa Ursus Północny (UP)** heading **towards central Warsaw only**.
- **Back to Ursus** — trains from six city stations (Ochota, Zachodnia,
  Śródmieście, Powiśle, Stadion, Wschodnia) that later stop at **WU or UP**,
  with a station picker.

Live pages:

- Departures: `https://enzhukov.github.io/ursus-departures/`
- Back to Ursus: `https://enzhukov.github.io/ursus-departures/arrivals.html`

## How it works

1. A GitHub Action runs `scripts/build_timetable.py` every night.
2. The script downloads the national rail GTFS feed
   (`https://mkuran.pl/gtfs/polish_trains.zip`, schedules by PKP PLK,
   mirrored by mkuran.pl) and writes two files:
   - `docs/timetable.json` — departures from WU/UP that later stop at
     Warszawa Włochy / Zachodnia / Śródmieście / Centralna / Wschodnia
     (= center-bound);
   - `docs/arrivals.json` — departures from the six city stations for
     trains that later stop at WU or UP (= homebound), tagged with the
     Ursus station they reach.
3. GitHub Pages serves the static pages in `docs/`.
4. Each page computes minutes-to-departure in the browser and fetches
   live delays every 60 s via a small Cloudflare Worker proxy in front of
   `https://mkuran.pl/gtfs/polish_trains/updates.json` (best-effort: if
   unavailable or stale, the boards still work on schedule data).
   On the Back to Ursus board, selecting Warszawa Zachodnia also shows
   real-time Peron/Tor information when available.

## Manual rebuild

GitHub → **Actions** → *Rebuild timetable* → **Run workflow**.

## Attribution

Timetable data: PKP PLK, via the GTFS mirror at [mkuran.pl](https://mkuran.pl/gtfs/).
Check the usage terms listed on that page.
