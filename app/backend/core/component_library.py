"""The built-in components (read-only presets): heat exchangers, a storage tank, district-heating heat pumps and the
data center as one unit. "Import" on the Components page copies one into the user's components to edit.

Heat pumps use a Carnot model on the fluid temperatures, as Heat distribution's built-in formula (web lib/matching.ts):
COP = η_C · T_supply[K] / max(T_supply − T_source, lift_min), clipped to 1..COP_max. η_C per size is the published COP
divided by the Carnot COP at the published operating point (sources in each preset); across the surveyed units
η_C ≈ 0.52–0.68 (David et al. 2017 report a practical COP of 3–4 for 149 large European units).
"""

DAVID_2017 = (
    "David, A., Mathiesen, B. V., Averfalk, H., Werner, S., Lund, H. (2017): Heat Roadmap Europe: Large-Scale Electric "
    "Heat Pumps in District Heating Systems. Energies 10(4), 578. https://doi.org/10.3390/en10040578"
)


def _p(name: str, value: float, unit: str = "", note: str = "", fixed: bool = True) -> dict:
    return {"name": name, "value": value, "fixed": fixed, "unit": unit, "note": note}


def _heat_pump(
    cid: str,
    name: str,
    capacity_kw: float,
    eta: float,
    t_max: float,
    lift_max: float,
    notes: str,
    source: str,
    t_supply: float = 75.0,
) -> dict:
    """A Carnot heat pump of one size; η_C is learnable, the limits are the unit's data (`t_supply`: the default
    supply input, within its limit)."""
    return {
        "id": cid,
        "name": name,
        "kind": "heat_pump",
        "inputs": [
            {"name": "T_source", "unit": "°C", "default": 30.0},
            {"name": "T_supply", "unit": "°C", "default": t_supply},
            {"name": "load", "unit": "0..1", "default": 1.0},
        ],
        "nodes": [
            {"name": "lift", "unit": "K", "equation": "T_supply[t] - T_source[t]"},
            {
                "name": "COP",
                "unit": "",
                "equation": "clip(eta_C * (T_supply[t] + 273.15) / maximum(lift[t], lift_min), 1, COP_max)",
            },
            # the limits as a 1 K ramp (the equation language has no if): full capacity up to each limit (a data
            # sheet's operating point sits on it), none 1 K above
            {
                "name": "Q_max",
                "unit": "kW",
                "equation": "capacity * clip(T_supply_max + 1 - T_supply[t], 0, 1) * clip(lift_max + 1 - lift[t], 0, 1)",
            },
            {"name": "Q_set", "unit": "kW", "equation": "Q_max[t] * clip(load[t], 0, 1)"},
            # the output follows the set point with a first-order lag (compressor start, condenser water warming up)
            {
                "name": "Q_heat",
                "unit": "kW",
                "equation": "Q_heat[t-1] + (Q_set[t] - Q_heat[t-1]) * (1 - exp(-dt_h / maximum(tau_h, 0.001)))",
                "init": 0.0,
            },
            {"name": "P_el", "unit": "kW", "equation": "Q_heat[t] / COP[t]"},
            {"name": "Q_source", "unit": "kW", "equation": "Q_heat[t] - P_el[t]"},
        ],
        "outputs": ["COP", "Q_max", "Q_heat", "P_el", "Q_source"],
        "params": [
            _p("eta_C", eta, "", "share of the Carnot COP reached (learnable)", fixed=False),
            _p("capacity", capacity_kw, "kW", "thermal capacity"),
            _p("T_supply_max", t_max, "°C", "highest supply temperature"),
            _p("lift_min", 5.0, "K", "smaller lifts count as this (caps the COP)"),
            _p("lift_max", lift_max, "K", "largest lift"),
            _p("COP_max", 8.0, "", "upper bound of the COP"),
            _p("tau_h", 0.5, "h", "time constant of the output after a change of load (tens of minutes)"),
            _p("dt_h", 1.0, "h", "step length of the data"),
        ],
        "notes": notes,
        "source": source,
    }


HEX_APPROACH = {
    "id": "hex_approach",
    "name": "Direct heat exchanger (approach)",
    "kind": "heat_exchanger",
    "inputs": [
        {"name": "T_hot_in", "unit": "°C", "default": 35.0},
        {"name": "Q_hot", "unit": "kW", "default": 1000.0},
        {"name": "T_cold_in", "unit": "°C", "default": 30.0},
    ],
    "nodes": [
        {"name": "T_cold_out", "unit": "°C", "equation": "T_hot_in[t] - approach"},
        {"name": "Q", "unit": "kW", "equation": "eff * Q_hot[t]"},
    ],
    "outputs": ["Q", "T_cold_out"],
    "params": [
        _p("approach", 5.0, "K", "cold outlet below the hot inlet (counterflow)"),
        _p("eff", 0.9, "", "share of the offered heat passed", fixed=False),
    ],
    "notes": "Heat distribution's built-in direct heat exchanger as a component: "
    "with the same approach and efficiency it gives the same numbers.",
    "source": "Built-in formula of the app (docs concepts/heat-distribution).",
}

HEX_NTU = {
    "id": "hex_entu",
    "name": "Plate heat exchanger (ε-NTU, counterflow)",
    "kind": "heat_exchanger",
    "inputs": [
        {"name": "T_hot_in", "unit": "°C", "default": 45.0},
        {"name": "Q_hot", "unit": "kW", "default": 1000.0},
        {"name": "T_cold_in", "unit": "°C", "default": 30.0},
    ],
    "nodes": [
        {"name": "C_hot", "unit": "kW/K", "equation": "maximum(Q_hot[t] / dT_hot, 1e-6)"},
        {"name": "C_min", "unit": "kW/K", "equation": "minimum(C_hot[t], m_cold * cp)"},
        {"name": "Cr", "unit": "", "equation": "minimum(C_min[t] / maximum(C_hot[t], m_cold * cp), 0.999)"},
        {"name": "NTU", "unit": "", "equation": "UA / C_min[t]"},
        {"name": "eps", "unit": "", "equation": "(1 - exp(-NTU[t] * (1 - Cr[t]))) / (1 - Cr[t] * exp(-NTU[t] * (1 - Cr[t])))"},
        # at most the heat offered: ε-NTU would pass more by cooling the hot side further than its dT_hot
        {"name": "Q", "unit": "kW", "equation": "minimum(eps[t] * C_min[t] * maximum(T_hot_in[t] - T_cold_in[t], 0), Q_hot[t])"},
        {"name": "T_cold_out", "unit": "°C", "equation": "T_cold_in[t] + Q[t] / (m_cold * cp)"},
        {"name": "T_hot_out", "unit": "°C", "equation": "T_hot_in[t] - Q[t] / C_hot[t]"},
    ],
    "outputs": ["Q", "T_cold_out", "T_hot_out", "eps"],
    "params": [
        _p("UA", 300.0, "kW/K", "heat transfer coefficient × area", fixed=False),
        _p("dT_hot", 10.0, "K", "hot-side temperature drop at the offered heat (sets the hot flow)"),
        _p("m_cold", 20.0, "kg/s", "network-side mass flow"),
        _p("cp", 4.186, "kJ/(kg·K)", "water"),
    ],
    "notes": "Counterflow ε-NTU: ε = (1 − e^(−NTU(1−Cr))) / (1 − Cr·e^(−NTU(1−Cr))), Q = ε·C_min·(T_hot_in − T_cold_in), "
    "at most the heat offered Q_hot. Cr is capped at 0.999 (the formula is 0/0 at Cr = 1).",
    "source": "Incropera, DeWitt et al.: Fundamentals of Heat and Mass Transfer, ch. 11 (effectiveness-NTU method).",
}

STORAGE = {
    "id": "storage_tank",
    "name": "Thermal storage tank (water)",
    "kind": "storage",
    "inputs": [
        {"name": "Q_in", "unit": "kW", "default": 500.0},
        {"name": "Q_out", "unit": "kW", "default": 400.0},
        {"name": "T_supply", "unit": "°C", "default": 70.0},
        {"name": "T_return", "unit": "°C", "default": 40.0},
        {"name": "T_amb", "unit": "°C", "default": 10.0},
    ],
    "nodes": [
        {"name": "E_max", "unit": "kWh", "equation": "V * rho * cp * maximum(T_supply[t] - T_return[t], 0) / 3600"},
        {"name": "P_loss", "unit": "kW", "equation": "UA_loss * ((T_supply[t] + T_return[t]) / 2 - T_amb[t])"},
        {"name": "loss_pct", "unit": "%/h", "equation": "100 * P_loss[t] / maximum(E_max[t], 1e-6)"},
        {
            "name": "E",
            "unit": "kWh",
            "equation": "clip(E[t-1] + (Q_in[t] - Q_out[t] - P_loss[t]) * dt_h, 0, E_max[t])",
            "init": 0.0,
        },
        {"name": "SOC", "unit": "0..1", "equation": "E[t] / maximum(E_max[t], 1e-6)"},
    ],
    "outputs": ["E", "SOC", "E_max", "loss_pct"],
    "params": [
        _p("V", 100.0, "m³", "water volume"),
        _p("rho", 1000.0, "kg/m³", "water"),
        _p("cp", 4.186, "kJ/(kg·K)", "water"),
        _p("UA_loss", 0.05, "kW/K", "heat loss coefficient × surface", fixed=False),
        _p("dt_h", 1.0, "h", "length of one step"),
    ],
    "notes": "Energy balance of a stratified water tank between the network's supply and return temperature: "
    "E[t] = E[t−1] + (Q_in − Q_out − P_loss)·Δt, held between 0 and E_max.",
    "source": "Energy balance; standing loss at the tank's mean temperature.",
}

DATA_CENTER = {
    "id": "dc_unit",
    "name": "Data center as one unit",
    "kind": "data_center",
    "inputs": [
        {"name": "IT_load", "unit": "kW", "default": 1000.0},
        {"name": "T_out", "unit": "°C", "default": 10.0},
    ],
    "nodes": [
        {"name": "P_cool", "unit": "kW", "equation": "IT_load[t] * (PUE_base - 1 + k_pue * maximum(T_out[t] - T_free, 0))"},
        {"name": "PUE", "unit": "", "equation": "(IT_load[t] + P_cool[t]) / maximum(IT_load[t], 1e-6)"},
        {"name": "Q_heat", "unit": "kW", "equation": "recovery * (IT_load[t] + P_cool[t])"},
        {"name": "T_supply", "unit": "°C", "equation": "clip(T_out[t] + tower_approach, T_min, T_max) - approach"},
    ],
    "outputs": ["Q_heat", "T_supply", "PUE"],
    "params": [
        _p("PUE_base", 1.2, "", "PUE in free cooling", fixed=False),
        _p("k_pue", 0.005, "1/K", "PUE rise per K above T_free", fixed=False),
        _p("T_free", 15.0, "°C", "outdoor temperature up to which free cooling suffices"),
        _p("recovery", 0.8, "", "share of the heat the extraction recovers"),
        _p("tower_approach", 8.0, "K", "cooling water above outdoor air"),
        _p("T_min", 15.0, "°C", "cooling water at least"),
        _p("T_max", 40.0, "°C", "cooling water at most"),
        _p("approach", 3.0, "K", "extraction heat exchanger"),
    ],
    "notes": "The whole data center as one block, from IT load and weather to the heat it offers and its temperature "
    "(as Heat distribution's physics condenser source).",
    "source": "Simple PUE model; temperatures as the app's physics source (web lib/matching.ts physicsSource).",
}

HEAT_PUMPS = [
    _heat_pump(
        "hp_0_5mw",
        "Heat pump 0.5 MW (NH3, two-stage piston)",
        460.0,
        0.56,
        90.0,
        75.0,
        "Like a Sabroe DualPAC 24-W/704-W: COP 4.8 at source 30/20 °C → sink 50/70 °C, COP_C = 343.15/40 = 8.58 → η_C ≈ 0.56; "
        "COP 3.1 at 15/5 → 70/90 °C gives 0.64. Shaft COPs: the electric COP is ~3–5 % lower.",
        "Johnson Controls Sabroe DualPAC data sheet, https://www.johnsoncontrols.de/-/media/project/jci-global/johnson-controls/"
        "ce-region/germany-johnson-controls/events-pdfs/jci-dualpac_datenblatt-ly-1.pdf; " + DAVID_2017,
    ),
    _heat_pump(
        "hp_2mw",
        "Heat pump 2 MW (NH3, screw)",
        1690.0,
        0.59,
        72.0,
        55.0,
        "Like a Sabroe HicaHP 193 S (1.69 MW): COP 3.9 at source 20/12 °C → sink 50/72 °C, COP_C = 345.15/52 = 6.64 "
        "→ η_C ≈ 0.59. Max supply 72 °C (40 bar design); the two-stage HeatPAC units reach 90 °C.",
        "Johnson Controls Sabroe HeatPAC / HicaHP catalogue; " + DAVID_2017,
        t_supply=70.0,
    ),
    _heat_pump(
        "hp_5mw",
        "Heat pump 5 MW (R134a, turbo)",
        5000.0,
        0.60,
        88.0,
        75.0,
        "Like a Friotherm Unitop 34FY (Zürich Walche, 2 × ~5 MW): COP 3.08 from a river at 3.5 °C to 50/70 °C, "
        "COP_C = 343.15/66.5 = 5.16 → η_C ≈ 0.60. 88 °C supply as the Unitop units at Katri Vala, Helsinki.",
        "Wojtan, L. (2012): Friotherm large heat pumps (Walche, Sandvika, Rolfsbukta, Katri Vala), "
        "https://unige.ch/sysener/download_file/view/1/310; " + DAVID_2017,
    ),
    _heat_pump(
        "hp_14mw",
        "Heat pump 14 MW (NH3, screw, Drammen)",
        14000.0,
        0.68,
        90.0,
        85.0,
        "Drammen (Norway), Star Refrigeration Neatpump, 3 units: fjord water at 8 °C to 65/90 °C at an average COP 3.0, "
        "COP_C = 363.15/82 = 4.43 → η_C ≈ 0.68.",
        "Drammen Heat Pump, https://en.wikipedia.org/wiki/Drammen_Heat_Pump; " + DAVID_2017,
    ),
    _heat_pump(
        "hp_20mw",
        "Heat pump 20 MW (NH3, screw)",
        19300.0,
        0.52,
        95.0,
        65.0,
        "Like a Sabroe HicaHP 407 L (19.3 MW): COP 3.5 at source 40/30 °C → sink 65/95 °C, COP_C = 368.15/55 = 6.69 → η_C ≈ 0.52 "
        "(0.62 on the source outlet). Comparable: MVV Mannheim, Siemens Energy, 20 MW from the Rhine.",
        "Johnson Controls Sabroe HeatPAC / HicaHP catalogue; " + DAVID_2017,
    ),
    _heat_pump(
        "hp_90mw",
        "Heat pump plant 90 MW (R134a, turbo, Katri Vala)",
        90600.0,
        0.56,
        88.0,
        85.0,
        "Katri Vala, Helsinki: 5 × Friotherm Unitop 50FY, 90.6 MW. Summer: sewage 20/4 °C → 45/88 °C at COP 3.0, "
        "COP_C = 361.15/68 = 5.31 → η_C ≈ 0.56. Stockholm Värtan (seawater 3 °C → 80 °C, COP ~3) gives ≈ 0.65.",
        "Wojtan (2012), https://unige.ch/sysener/download_file/view/1/310; " + DAVID_2017,
    ),
]

PRESETS: list[dict] = [HEX_APPROACH, HEX_NTU, STORAGE, *HEAT_PUMPS, DATA_CENTER]
PRESET_IDS = {p["id"] for p in PRESETS}
