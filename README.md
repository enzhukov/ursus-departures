# Ursus → Centrum

A minimal, phone-friendly departure board for trains from **Warszawa Ursus (WU)**
and **Warszawa Ursus Północny (UP)** heading **towards central Warsaw only**.

Live page: `https://enzhukov.github.io/ursus-departures/`

## How it works

1. A GitHub Action runs `scripts/build_timetable.py` every night.
2. The script downloads the national rail GTFS feed
   (`https://mkuran.pl/gtfs/polish_trains.zip`, schedules by PKP PLK,
   mirrored by mkuran.pl), keeps only departures from the two stations
   that later stop at Warszawa Włochy / Zachodnia / Śródmieście /
   Centralna / Wschodnia (= center-bound), and writes a small
   `docs/timetable.json`.
3. GitHub Pages serves the static page in `docs/`.
4. The page computes minutes-to-departure in the browser and tries to
   fetch live delays from `https://mkuran.pl/gtfs/polish_trains/updates.json`
   every 60 s (best-effort: if unavailable, the board still works).

## Manual rebuild

GitHub → **Actions** → *Rebuild timetable* → **Run workflow**.

## Attribution

Timetable data: PKP PLK, via the GTFS mirror at [mkuran.pl](https://mkuran.pl/gtfs/).
Check the usage terms listed on that page.
