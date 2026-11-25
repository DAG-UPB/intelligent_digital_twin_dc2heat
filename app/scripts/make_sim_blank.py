"""Create the blank example data center sim_blank from sim_1_air: no built-in drawing (dataset.json "blank"), only the
data center's inputs and outputs, named as they read (the interface's generic names, web/src/pages/heat/ports.ts), each
with a note (site.json pid_notes), to draw the structure from:

  inputs   IT_load (%), the weather: T_outdoor, humidity (solar_radiation has no column: a variable to make)
  outputs  IT_power, Cooling_power (sim_1_air's plant), at the connection point (the extraction point
           "condenser", as sim_1_air's, whose condenser water it is) the water to the heat distribution
           (Supply_temp, Return_temp, Water_flow; Heat_recovered calculated, dataset.json "derived") and
           Heat_rejected = IT_power + Cooling_power - Heat_recovered (nearly all the electricity becomes heat)

Every name fits the drawing's labels (16 characters: datacenter/structure/shown.ts MAX_LABEL), so none is shortened.

A new one starts with its variables where LAYOUT puts them and a graph file of them, no links yet.

Run from app/:  .venv/bin/python scripts/make_sim_blank.py [data dir]   (needs sim_1_air/ there)
"""

import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_sim_1_modified import CP_WATER, DATA  # noqa: E402

SUPPLY, RETURN, FLOW, HEAT = "Supply_temp", "Return_temp", "Water_flow", "Heat_recovered"
COLUMNS = {
    "Out_Temp": "T_outdoor",
    "Out_Hum": "humidity",
    "ITE_Ener": "IT_power",
    "HVAC_Ener": "Cooling_power",
    "HEX_Cond_T_in": SUPPLY,
    "HEX_Cond_T_out": RETURN,
    "HEX_Cond_m": FLOW,
}

# what each variable is: shown when it is clicked on the drawing
NOTES = {
    "IT_load": ("it_load", "Input. How busy the servers are, in % of their full load: it drives the IT electricity."),
    "T_outdoor": ("weather", "Input. Outdoor temperature, °C: how hard the cooling works, how much it free-cools."),
    "humidity": ("weather", "Input. Outdoor relative humidity, %: the cooling tower's wet bulb."),
    "solar_radiation": ("weather", "Input. Solar radiation, W/m²: no data here, a variable to make."),
    "IT_power": ("meter", "Output. Electricity of the servers, kW: nearly all of it becomes heat."),
    "Cooling_power": ("meter", "Output. Electricity of the cooling plant (chiller, fans, pumps), kW."),
    SUPPLY: ("sensor", "Output. Water to the heat distribution at the connection point, °C (the warm supply)."),
    RETURN: ("sensor", "Input. Water back from the heat distribution, °C: the return, set by the heat distribution."),
    FLOW: ("sensor", "Output. Mass flow of the water to the heat distribution, kg/s."),
    "Heat_rejected": ("calculated", "Output. Heat the cooling rejects outdoors, kW: IT + cooling electricity − Heat_recovered."),
}

# where its variables sit (site.json pid_layout, the user's own layout): the inputs and outputs in one row just above
# the data center's box, the water at the connection point in one column on its right; "surface:" the box's height
LAYOUT = {
    "T_outdoor": (600, 40, "TT"),
    "humidity": (670, 40, "MT"),
    "solar_radiation": (750, 40, "RT"),
    "IT_load": (860, 40, "JT"),
    "Cooling_power": (920, 40, "EQ"),
    "IT_power": (980, 40, "EQ"),
    "Heat_rejected": (1040, 40, "QT"),
    SUPPLY: (1140, 160, "TT"),
    RETURN: (1140, 280, "TT"),
    FLOW: (1140, 340, "FT"),
    "surface:": (0, 640, ""),
}

CONFIG = {
    "name": "Blank · inputs and outputs only",
    "kind": "simulation",
    "blank": True,
    "actuators": ["IT_load"],
    "heat": [SUPPLY, RETURN, FLOW, HEAT, "Heat_rejected"],
    "levers": [],
    "pid_image": None,
    "heat_source": {"condenser": {"q": HEAT, "t": SUPPLY, "t_in": SUPPLY, "t_out": RETURN, "m": FLOW}},
    "derived": {HEAT: {"m": FLOW, "t_in": SUPPLY, "t_out": RETURN, "cp": CP_WATER}},
    "kpi": {
        "it_power": "IT_power",
        "cooling_power": "Cooling_power",
        "reuse": {"condenser": HEAT},
        "power_unit": "kW",
    },
}


def main(data: Path = DATA) -> None:
    """Write data/sim_blank from data/sim_1_air (a site.json and a graph already there are kept, the notes brought up to date)."""
    src, dst = data / "sim_1_air", data / "sim_blank"
    dst.mkdir(exist_ok=True)
    df = pd.read_parquet(src / "df_sim_1_air.parquet")
    out = df[["time", *COLUMNS]].rename(columns=COLUMNS)
    out.insert(1, "IT_load", df["IT_Load"] * 100)
    out[HEAT] = out[FLOW] * CP_WATER * (out[SUPPLY] - out[RETURN])  # stored too, as sim_1_air's HEX Q: the KPIs read it
    out["Heat_rejected"] = (out["IT_power"] + out["Cooling_power"] - out[HEAT]).clip(lower=0)
    out.to_parquet(dst / "df_sim_blank.parquet", index=False)
    (dst / "dataset.json").write_text(json.dumps(CONFIG, indent=2, ensure_ascii=False) + "\n")
    graph = dst / "causal_graph.json"
    if not graph.exists():  # a graph saved there is kept; a new one has every variable drawn, no links yet
        targets = {v: [] for v in sorted(LAYOUT, key=str.lower) if v != "surface:"}
        graph.write_text(json.dumps({"targets": targets, "link_strengths": []}, indent=2) + "\n")
    path = dst / "site.json"
    if path.exists():
        site = json.loads(path.read_text())
    else:
        site = {"building": None, "source": None, "sinks": []}  # blank: nothing placed on the map (it opens on Frankfurt)
        layout = {v: {"x": float(x), "y": float(y), "tag": tag} for v, (x, y, tag) in LAYOUT.items()}
        site |= {"pid_layout": layout, "hex_option": "condenser"}  # blank: no heat distribution chosen, no district
    site["pid_notes"] = {v: {"kind": kind, "note": note} for v, (kind, note) in NOTES.items()}
    path.write_text(json.dumps(site, indent=2, ensure_ascii=False) + "\n")
    print(f"{dst}: {len(out)} rows, {list(out.columns)}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else DATA)
