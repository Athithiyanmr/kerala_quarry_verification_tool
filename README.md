# Kerala Quarry Verification Tool

Interactive GitHub Pages + Google Apps Script tool for human verification of Kerala quarry candidates.

CURRENT SOURCE: OSM quarry dataset only.

USER WORKFLOW:
1. Select a quarry.
2. Inspect satellite imagery.
3. Answer Is this a quarry?
4. Answer Does it contain water?
5. If it is a quarry, optionally record activity, water type, quarry type and confidence.
6. Add a note.
7. Save & Next.

LATER SOURCES: DMG/KOMPAS, existing quarry polygons, UNet, AlphaEarth and Sentinel-2 can be added later without changing the verification model.

GITHUB PAGES: Settings -> Pages -> Deploy from main/root.

APPS SCRIPT: Create Google Sheet -> Extensions -> Apps Script -> paste apps_script/Code.gs -> run setup() -> Deploy as Web app -> put the /exec URL in config.js.

DATA: put data/quarries.geojson and data/districts.geojson in the repository.