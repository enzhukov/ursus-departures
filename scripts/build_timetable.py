"""
Build docs/timetable.json with center-bound departures from
Warszawa Ursus (WU) and Warszawa Ursus Polnocny (UP).

Data source: https://mkuran.pl/gtfs/polish_trains.zip
(schedules by PKP PLK, mirrored by Mikolaj Kuranowski - mkuran.pl)

Designed to run inside GitHub Actions once per day.
Memory-friendly: streams stop_times.txt twice instead of loading it whole.
"""

import csv
import io
import json
import shutil
import sys
import urllib.request
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

GTFS_URL = "https://mkuran.pl/gtfs/polish_trains.zip"
GTFS_FILE = Path("gtfs.zip")
OUTPUT = Path("docs/timetable.json")

TZ = ZoneInfo("Europe/Warsaw")

# Station name -> short code shown on the board
STATIONS = {
    "Warszawa Ursus": "WU",
    "Warszawa Ursus Północny": "UP",
}

# A train counts as "center-bound" if, AFTER our station,
# it stops at any of these stations.
CENTER_STATIONS = {
    "Warszawa Włochy",
    "Warszawa Zachodnia",
    "Warszawa Śródmieście",
    "Warszawa Centralna",
    "Warszawa Wschodnia",
}

DAYS_AHEAD = 3  # today + 2 following days


def read_csv(z: zipfile.ZipFile, name: str):
    """Yield rows of a CSV file inside the zip as dicts (streaming)."""
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"))


def parse_gtfs_time(hms: str, service_day: datetime) -> datetime:
    """GTFS times may exceed 24:00 (e.g. 25:15 = 01:15 next day)."""
    h, m, s = (int(x) for x in hms.split(":"))
    return service_day + timedelta(hours=h, minutes=m, seconds=s)


def main() -> None:
     print(f"Downloading {GTFS_URL} ...")
    req = urllib.request.Request(
        GTFS_URL,
        headers={
            "User-Agent": "Mozilla/5.0 (ursus-departures; personal train board; "
                          "https://github.com/enzhukov/ursus-departures)",
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(req) as resp, open(GTFS_FILE, "wb") as f:
        shutil.copyfileobj(resp, f)
    print(f"Downloaded {GTFS_FILE.stat().st_size / 1e6:.1f} MB")

    z = zipfile.ZipFile(GTFS_FILE)
    names = set(z.namelist())
    print("Files in feed:", sorted(names))

    # ---- 1. Stops: find our stations and the "center" stations -------------
    origin_ids: dict[str, str] = {}   # stop_id -> WU / UP
    center_ids: set[str] = set()
    for s in read_csv(z, "stops.txt"):
        name = s["stop_name"].strip()
        if name in STATIONS:
            origin_ids[s["stop_id"]] = STATIONS[name]
        if name in CENTER_STATIONS:
            center_ids.add(s["stop_id"])

    print(f"Origin stop_ids found: {origin_ids}")
    print(f"Center stop_ids found: {len(center_ids)}")
    if not origin_ids:
        sys.exit("ERROR: station names not found in stops.txt - "
                 "open stops.txt and check exact spelling.")

    # ---- 2. First pass over stop_times: which trips touch our stations? ----
    wanted_trips: set[str] = set()
    for st in read_csv(z, "stop_times.txt"):
        if st["stop_id"] in origin_ids:
            wanted_trips.add(st["trip_id"])
    print(f"Trips touching our stations: {len(wanted_trips)}")

    # ---- 3. Second pass: collect full stop sequences for those trips -------
    trip_stops: dict[str, list] = {t: [] for t in wanted_trips}
    for st in read_csv(z, "stop_times.txt"):
        if st["trip_id"] in trip_stops:
            trip_stops[st["trip_id"]].append(
                (int(st["stop_sequence"]), st["stop_id"], st["departure_time"])
            )

    # ---- 4. Trips and routes ------------------------------------------------
    trips = {}
    for t in read_csv(z, "trips.txt"):
        if t["trip_id"] in wanted_trips:
            trips[t["trip_id"]] = t

    routes = {r["route_id"]: r for r in read_csv(z, "routes.txt")}

    # ---- 5. Which service_ids run on the next few days? --------------------
    today = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    wanted_days = {
        (today + timedelta(days=d)).strftime("%Y%m%d"): today + timedelta(days=d)
        for d in range(DAYS_AHEAD)
    }

    service_days: dict[str, set[str]] = {}

    weekday_cols = ["monday", "tuesday", "wednesday", "thursday",
                    "friday", "saturday", "sunday"]
    if "calendar.txt" in names:
        for c in read_csv(z, "calendar.txt"):
            for ymd in wanted_days:
                if c["start_date"] <= ymd <= c["end_date"]:
                    wd = wanted_days[ymd].weekday()
                    if c.get(weekday_cols[wd], "0") == "1":
                        service_days.setdefault(c["service_id"], set()).add(ymd)

    if "calendar_dates.txt" in names:
        for cd in read_csv(z, "calendar_dates.txt"):
            if cd["date"] in wanted_days:
                if cd["exception_type"] == "1":
                    service_days.setdefault(cd["service_id"], set()).add(cd["date"])
                elif cd["exception_type"] == "2":
                    service_days.get(cd["service_id"], set()).discard(cd["date"])

    print(f"Active services in window: {len(service_days)}")

    # ---- 6. Build departures ------------------------------------------------
    departures = []
    lines_seen = set()
    for trip_id, stop_list in trip_stops.items():
        trip = trips.get(trip_id)
        if not trip:
            continue
        days = service_days.get(trip["service_id"])
        if not days:
            continue

        stop_list.sort(key=lambda x: x[0])
        stop_ids_in_order = [x[1] for x in stop_list]

        route = routes.get(trip["route_id"], {})
        line = (route.get("route_short_name")
                or route.get("route_long_name")
                or "?").strip()
        lines_seen.add(line)

        for i, (_, stop_id, dep_time) in enumerate(stop_list):
            if stop_id not in origin_ids:
                continue
            # center-bound check: any center station later in the trip?
            if not (set(stop_ids_in_order[i + 1:]) & center_ids):
                continue
            for ymd in days:
                dt = parse_gtfs_time(dep_time, wanted_days[ymd])
                departures.append({
                    "station": origin_ids[stop_id],
                    "time": dt.isoformat(),
                    "line": line,
                    "headsign": trip.get("trip_headsign", "").strip(),
                    "trip_id": trip_id,
                })

    departures.sort(key=lambda d: d["time"])
    print(f"Center-bound departures written: {len(departures)}")
    print(f"Lines seen at these stations: {sorted(lines_seen)}")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(
            {"generated": datetime.now(TZ).isoformat(), "departures": departures},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
