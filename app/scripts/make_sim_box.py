"""Create the air-cooled and the water-cooled examples in the new form: the data center as a box to draw in (as the
blank example, make_sim_blank.py), what goes in and out on its margins (the weather and the IT load in, the electricity
and the heat rejected out, the heat to recover at the connection point on its right), and the example's own P&ID inside
the box (dataset.json "frame"; datacenter/structure/PidPage). The margins' variables are the example's own columns
where it has them (bindSetup renameFor: Out_Temp is T_outdoor, ITE_Ener is IT_power, ...), so nothing is duplicated:

  sim_box_air    from sim_1_air (A1, air-cooled, free cooling)
  sim_box_water  from sim_1_water (W1, water-cooled)

Data, graph, equations, models and site are copied as they are (the sources' site.json has no layout: the drawing's own
spots and the margins' are where everything starts); a graph, site.json or models already there are kept.

Run from app/:  .venv/bin/python scripts/make_sim_box.py [data dir]   (needs sim_1_air/ and sim_1_water/ there)
"""

import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_sim_1_modified import DATA  # noqa: E402

CASES = {
    "sim_box_air": ("sim_1_air", "Box · air cooled, free cooling"),
    "sim_box_water": ("sim_1_water", "Box · water cooled"),
}


def main(data: Path = DATA) -> None:
    """Write each case of CASES from its source example."""
    for dst_id, (src_id, name) in CASES.items():
        src, dst = data / src_id, data / dst_id
        dst.mkdir(exist_ok=True)
        shutil.copyfile(src / f"df_{src_id}.parquet", dst / f"df_{dst_id}.parquet")
        config = json.loads((src / "dataset.json").read_text())
        config |= {"name": name, "frame": True}
        (dst / "dataset.json").write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n")
        for f in ("causal_graph.json", "equations.json", "site.json"):
            if (src / f).exists() and not (dst / f).exists():  # one saved there is kept
                shutil.copyfile(src / f, dst / f)
        if (src / "models").is_dir() and not (dst / "models").exists():  # trained on the same data, under its new name
            (dst / "models").mkdir()
            for m in (src / "models").glob("*.json"):
                model = json.loads(m.read_text())
                if model.get("file") == f"df_{src_id}":
                    model["file"] = f"df_{dst_id}"
                (dst / "models" / m.name).write_text(json.dumps(model, indent=2, ensure_ascii=False) + "\n")
        print(f"{dst}: from {src_id}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else DATA)
