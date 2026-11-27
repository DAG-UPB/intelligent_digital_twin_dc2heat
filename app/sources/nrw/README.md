# NRW: Kommunale Wärmeplanung (LANUK)

`fetch.py` imports the open heat demand of North Rhine-Westphalia's municipalities for the Site map.

```bash
cd app
bash scripts/guard.sh .venv/bin/python sources/nrw/fetch.py Bonn          # one municipality (name, ä → ae, or AGS)
bash scripts/guard.sh .venv/bin/python sources/nrw/fetch.py Köln 05334002 # more: each is added to the others
bash scripts/guard.sh .venv/bin/python sources/nrw/fetch.py --rebuild     # the file again from every zip fetched
```

- **Where from:** https://www.opengeodata.nrw.de/produkte/umwelt_klima/energie/kwp/ (`KWP-NRW_<AGS>_<name>_EPSG25832_Shape.zip`,
  one per municipality; Bonn 134 MB, Köln 336 MB). The model description is in each zip
  (`Kurzdokumentation_Raumwaermebedarfsmodell.pdf`).
- **Where to:** `app/data/_external/nrw/`: the zips (git-ignored), read where they are, and one
  `buildings_<AGS>_<name>.sqlite` per municipality (committed: Bonn, Münster, Paderborn and Altenbeken).
- **What:** every heated building (outline, ALKIS use, EFH/RH/MFH/GMH or the non-residential use, age class, useful floor
  area, space heating and hot water kWh/a, space heating 2030 and 2045 with moderate renovation) and every street
  segment with heat (heat line density, the buildings' heat including commerce's process heat).
- **Licence:** Datenlizenz Deutschland – Zero – 2.0 (the dataset's metadata; the Energieatlas service page names
  dl-de/by-2.0, so the app credits "© LANUK NRW" either way).
- **Accuracy:** modelled useful heat, not consumption; LANUK warns that a single building can differ greatly from its
  real consumption, so compare sums. Its non-residential buildings come with BBSR benchmark values.
- **Cost:** Bonn: 117,383 buildings and 7,160 street segments in about 10 s, 65 MB RSS, a 44 MB file; Münster 42 MB,
  Paderborn 27 MB.
