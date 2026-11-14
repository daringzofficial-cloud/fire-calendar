# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static site with no backend. The app runs entirely in the browser and reads pre-built JSON aggregates. Preprocessing is a separate offline Python script. The frontend framework and build tooling are not decided yet.

## Users

- **Early-warning and emergency-response services:** check how unusual current fire activity is in a region compared with what is normal for that time of year.
- **Scientists:** study the seasonality and long-term trends of fire activity, and export the data for their own analysis.
- **Land managers:** assess fire regimes over specific territories they are responsible for.

## Product Purpose

A fire-activity calendar built on MODIS and VIIRS active-fire detections from NASA FIRMS, covering Kazakhstan. The user selects a region on a map and a date range. The app then shows:

- a year × month heatmap of fire activity;
- anomalies against the multi-year norm;
- a CSV export of the selected data.

Success means a user can answer "is this month in this place unusual, and by how much?" without doing their own GIS work.

## Positioning

The app offers one harmonized long record (2000 to now) instead of two incompatible sensor archives. VIIRS counts are converted into MODIS equivalents and persistent industrial heat sources are filtered out. That makes 20+ years of data comparable month by month, and anomalies can be read directly against a norm built from that record.

## Operating Context

- Data comes from FIRMS archive downloads for Kazakhstan: MODIS from 2000, VIIRS from 2012. They are downloaded in advance, then aggregated by a Python script into a 0.25° grid by month and written to static JSON.
- **Sensor harmonization:** a VIIRS→MODIS-equivalent conversion factor is fitted on the overlap period (2012 onward). A filter removes persistent industrial sources (static thermal anomalies).
- **Anomaly norm:** for each calendar month, the mean over all complete years before the current one.
- Users work by drawing or selecting a region on a map and choosing a date range. Results are read as a year/month calendar heatmap.

## Capabilities and Constraints

- Region selection on a map; date-range selection.
- A year × month heatmap; an anomaly view against the multi-year norm; CSV export.
- No server: every computation at view time runs in the browser over the pre-aggregated 0.25° monthly grid. The spatial and temporal resolution is limited to that grid.
- Coverage: Kazakhstan only, as currently aggregated.
- The UI is bilingual, Russian and English, with a language switcher.
- **Terminology:** "active fire detections" (активные очаги), "MODIS-equivalent", "norm" (многолетняя норма), "anomaly".
- **Open / optional:** live FIRMS API integration (for near-real-time data) is a possible addition if time allows. The exact conversion factor value and the industrial-source filter method still need to be documented once computed.

## Evidence on Hand

- No data files, aggregates, or screenshots are in the repository yet.
- No testimonials, users, partner organizations, or validation results exist. Future work must not fabricate any of them.
- Data attribution: NASA FIRMS (MODIS, VIIRS) must be credited as the source.

## Product Principles

1. **Comparability first:** every number shown is in harmonized MODIS-equivalent units, and the user can always tell how it was derived.
2. **Anomaly is the headline:** raw counts give context, but the departure from the norm is what users came to see.
3. **Honest about the method:** the grid resolution, the sensor conversion, the industrial filter and the norm period are stated plainly, not hidden.
4. **Data leaves cleanly:** whatever the user sees, they can export as CSV with matching parameters.
5. **Works offline-static:** no feature may assume a server.

## Accessibility & Inclusion

The UI is bilingual (RU/EN). The heatmap and anomaly views must not rely on color alone to convey values. No other formal standard has been specified.
