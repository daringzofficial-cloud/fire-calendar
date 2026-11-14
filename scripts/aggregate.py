#!/usr/bin/env python3
"""Сводит CSV из NASA FIRMS (MODIS и VIIRS) в месячную сетку 0.25 градуса.

Запуск из корня проекта:
    python scripts/aggregate.py
    python scripts/aggregate.py --raw data/raw --out data/processed/grid.json

Читает все *.csv в --raw (и в подпапках). Нужен только pandas.

Что делает:
1. Определяет датчик по колонкам instrument и satellite
   (modis_terra, modis_aqua, viirs_snpp, viirs_noaa20, ...).
2. Фильтрует:
   - низкую достоверность (MODIS < --min-conf, VIIRS 'l');
   - не-растительные источники по полю type (2 = статичный источник на суше,
     например газовый факел);
   - "статичные ячейки": участки 0.05 градуса, где в архиве много
     статичных источников. Эта маска применяется ко всем строкам, в том числе
     к NRT-файлам, где поля type нет.
3. Считает по ячейке 0.25 градуса, месяцу и датчику: число очагов и сумму FRP.
4. Пишет компактный JSON (колонки массивов) для веб-приложения.
"""
import argparse
import glob
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

GRID = 0.25            # размер ячейки итоговой сетки, градусы
STATIC_GRID = 0.05     # размер ячейки для маски статичных источников
USECOLS = {"latitude", "longitude", "acq_date", "satellite", "instrument",
           "confidence", "frp", "type", "version"}

VIIRS_SAT = {"N": "snpp", "SNPP": "snpp", "NPP": "snpp",
             "1": "noaa20", "N20": "noaa20", "J1": "noaa20",
             "N21": "noaa21", "J2": "noaa21"}


def sensor_key(instrument: pd.Series, satellite: pd.Series) -> pd.Series:
    inst = instrument.astype(str).str.upper()
    sat = satellite.astype(str).str.strip()
    out = pd.Series("unknown", index=instrument.index, dtype=object)
    is_modis = inst.str.contains("MODIS")
    out[is_modis] = "modis_" + sat[is_modis].str.lower()
    # В архиве S-NPP поле instrument равно "SNPP", а не "VIIRS",
    # поэтому VIIRS определяем и по названию спутника.
    is_viirs = inst.str.contains("VIIRS") | sat.str.upper().isin(VIIRS_SAT.keys())
    is_viirs &= ~is_modis
    mapped = sat[is_viirs].str.upper().map(VIIRS_SAT)
    mapped = mapped.fillna(sat[is_viirs].str.lower())
    out[is_viirs] = "viirs_" + mapped
    return out


def keep_by_confidence(conf: pd.Series, min_conf: int) -> pd.Series:
    text = conf.astype(str).str.strip().str.lower()
    num = pd.to_numeric(text, errors="coerce")
    ok_num = num >= min_conf
    ok_txt = text.isin(["n", "nominal", "h", "high"])
    return ok_num.fillna(False) | ok_txt


def calibrate(grp: pd.DataFrame, nrt_from: dict) -> dict:
    """Коэффициенты согласования MODIS и VIIRS по общему периоду.

    Опорная шкала это MODIS (Terra + Aqua). Итоговый согласованный ряд:
      - месяцы до запуска Aqua (до 2002-07): Terra * terra_only_to_modis
      - 2002-08 ... 2012-01: MODIS (Terra + Aqua) как есть
      - с 2012-02: VIIRS S-NPP * viirs_snpp_to_modis
    Коэффициент VIIRS считается как отношение сумм очагов за месяцы,
    где у обоих датчиков есть стандартные (не NRT) данные.
    """
    tab = grp.pivot_table(index="month", columns="sensor", values="n",
                          aggfunc="sum", fill_value=0)
    for col in ("modis_terra", "modis_aqua", "viirs_snpp", "viirs_noaa20"):
        if col not in tab.columns:
            tab[col] = 0
    tab["modis_all"] = tab["modis_terra"] + tab["modis_aqua"]

    start = "2012-02"   # первый полный месяц S-NPP (архив с 2012-01-20)
    end = min(nrt_from.values()) if nrt_from else "9999-99"  # исключая
    ov = tab[(tab.index >= start) & (tab.index < end)]
    ov = ov[ov["viirs_snpp"] > 0]
    k = float(ov["modis_all"].sum() / ov["viirs_snpp"].sum())
    corr = float(np.corrcoef(ov["modis_all"], ov["viirs_snpp"])[0, 1])

    both = tab[(tab.index >= "2003-01") & (tab.index <= "2011-12")]
    t_scale = float(both["modis_all"].sum() / both["modis_terra"].sum())

    ov = ov.copy()
    ov["year"] = ov.index.str[:4]
    by_year = (ov.groupby("year")[["modis_all", "viirs_snpp"]].sum())
    by_year = (by_year["modis_all"] / by_year["viirs_snpp"]).round(3).to_dict()

    # NOAA-20 продолжает ряд после окончания S-NPP. Общий период с MODIS:
    # с первого полного месяца NOAA-20 (2018-05) до начала NRT.
    n20 = tab[(tab.index >= "2018-05") & (tab.index < end)]
    n20 = n20[n20["viirs_noaa20"] > 0]
    k_n20 = (float(n20["modis_all"].sum() / n20["viirs_noaa20"].sum())
             if len(n20) else None)

    return {
        "reference": "modis_all (Terra + Aqua)",
        "viirs_snpp_to_modis": round(k, 4),
        "viirs_noaa20_to_modis": round(k_n20, 4) if k_n20 else None,
        "terra_only_through": "2002-07",
        "modis_through": "2012-01",
        "terra_only_to_modis": round(t_scale, 4),
        "overlap_months": [ov.index.min(), ov.index.max(), int(len(ov))],
        "monthly_correlation": round(corr, 3),
        "ratio_by_year": by_year,
        "aqua_starts": "2002-07",
        "viirs_snpp_starts": "2012-01",
        "note": ("Согласованный ряд: Terra*terra_only_to_modis до 2002-07; "
                 "MODIS Terra+Aqua 2002-08..2012-01; "
                 "VIIRS S-NPP*viirs_snpp_to_modis с 2012-02, пока есть "
                 "полные месяцы S-NPP; дальше VIIRS NOAA-20*"
                 "viirs_noaa20_to_modis."),
    }


def load(raw_dir: str) -> pd.DataFrame:
    files = sorted(glob.glob(os.path.join(raw_dir, "**", "*.csv"), recursive=True))
    if not files:
        sys.exit(f"Нет CSV в {raw_dir}")
    frames = []
    for path in files:
        df = pd.read_csv(path, usecols=lambda c: c in USECOLS,
                         dtype={"confidence": str, "type": "float64"})
        df["source_file"] = os.path.basename(path)
        # NRT-файлы: версия оканчивается на NRT
        if "version" in df.columns:
            df["is_nrt"] = df["version"].astype(str).str.upper().str.contains("NRT")
        else:
            df["is_nrt"] = "nrt" in os.path.basename(path).lower()
        print(f"  {os.path.basename(path)}: {len(df):,} строк")
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="data/raw")
    ap.add_argument("--out", default="data/processed/grid.json")
    ap.add_argument("--min-conf", type=int, default=30,
                    help="минимальная достоверность MODIS (0-100)")
    ap.add_argument("--static-min", type=int, default=20,
                    help="сколько статичных (type=2) очагов в ячейке 0.05 "
                         "градуса делают её статичной")
    args = ap.parse_args()

    print("Чтение:")
    df = load(args.raw)
    df = df.dropna(subset=["latitude", "longitude", "acq_date"])
    df["sensor"] = sensor_key(df["instrument"], df["satellite"])
    df["month"] = df["acq_date"].astype(str).str[:7]
    df["frp"] = pd.to_numeric(df.get("frp"), errors="coerce").fillna(0.0)

    # Убираем дубликаты, которые появляются при пересечении архива и NRT.
    # Приоритет у архива (стандартные данные заменяют NRT).
    df = df.sort_values("is_nrt")
    df["lat_r"] = df["latitude"].round(4)
    df["lon_r"] = df["longitude"].round(4)
    before = len(df)
    df = df.drop_duplicates(["lat_r", "lon_r", "acq_date", "sensor"])
    print(f"Дубликаты убраны: {before - len(df):,}")

    stats = {s: {"in": int(n)} for s, n in df["sensor"].value_counts().items()}

    # 1. достоверность
    is_modis = df["sensor"].str.startswith("modis")
    ok = pd.Series(True, index=df.index)
    ok[is_modis] = keep_by_confidence(df.loc[is_modis, "confidence"], args.min_conf)
    ok[~is_modis] = keep_by_confidence(df.loc[~is_modis, "confidence"], 0)
    df = df[ok]

    # 2. статичные источники
    has_type = "type" in df.columns
    static_cells = set()
    if has_type:
        t2 = df[df["type"] == 2]
        key2 = (np.floor(t2["latitude"] / STATIC_GRID).astype(int).astype(str)
                + "_" + np.floor(t2["longitude"] / STATIC_GRID).astype(int).astype(str))
        counts = key2.value_counts()
        static_cells = set(counts[counts >= args.static_min].index)
    key_all = (np.floor(df["latitude"] / STATIC_GRID).astype(int).astype(str)
               + "_" + np.floor(df["longitude"] / STATIC_GRID).astype(int).astype(str))
    drop = key_all.isin(static_cells)
    if has_type:
        # type: 0 = растительный пожар, 1 = вулкан, 2 = статичный источник
        # на суше (газовые факелы, заводы), 3 = море (платформы).
        # Оставляем только 0; пустое значение (NRT) оставляем.
        drop |= df["type"].notna() & (df["type"] != 0)
    print(f"Статичных ячеек: {len(static_cells):,}; удалено очагов: {int(drop.sum()):,}")
    df = df[~drop]

    # 3. агрегация
    df["ci"] = np.floor(df["latitude"] / GRID).astype(int)
    df["cj"] = np.floor(df["longitude"] / GRID).astype(int)
    grp = (df.groupby(["ci", "cj", "month", "sensor"], sort=True)
             .agg(n=("frp", "size"), frp=("frp", "sum")).reset_index())

    months = sorted(grp["month"].unique())
    sensors = sorted(grp["sensor"].unique())
    cells = (grp[["ci", "cj"]].drop_duplicates().sort_values(["ci", "cj"])
             .reset_index(drop=True))
    cells["cid"] = cells.index
    grp = grp.merge(cells, on=["ci", "cj"])

    m_idx = {m: i for i, m in enumerate(months)}
    s_idx = {s: i for i, s in enumerate(sensors)}
    grp["mi"] = grp["month"].map(m_idx)
    grp["si"] = grp["sensor"].map(s_idx)
    grp = grp.sort_values(["cid", "mi", "si"])

    for s in sensors:
        stats.setdefault(s, {})["out"] = int(grp.loc[grp["sensor"] == s, "n"].sum())

    nrt_months = sorted(df.loc[df["is_nrt"], "month"].unique())
    # NRT у каждого датчика начинается в свой день: сохраняем границу по датчикам
    nrt_from = {s: g["month"].min()
                for s, g in df[df["is_nrt"]].groupby("sensor")}
    first_date = df.groupby("sensor")["acq_date"].min().to_dict()
    last_date = df.groupby("sensor")["acq_date"].max().to_dict()
    calibration = calibrate(grp, nrt_from)

    out = {
        "meta": {
            "calibration": calibration,
            "grid_deg": GRID,
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "months": months,
            "sensors": sensors,
            "nrt_months": nrt_months,
            "nrt_from_by_sensor": nrt_from,
            "first_date": first_date,
            "last_date": last_date,
            "static_cells": len(static_cells),
            "dropped_static": int(drop.sum()),
            "filters": {"min_conf_modis": args.min_conf, "viirs": "без low",
                        "drop_type_2": has_type, "static_cell_deg": STATIC_GRID,
                        "static_min": args.static_min},
            "counts": stats,
            "note": ("cells: [lat_south, lon_west] углов ячеек. "
                     "rows: c=индекс ячейки, m=индекс месяца, s=индекс датчика, "
                     "n=число очагов, f=сумма FRP (МВт)."),
        },
        "cells": [[round(a * GRID, 4), round(b * GRID, 4)]
                  for a, b in zip(cells["ci"], cells["cj"])],
        "rows": {
            "c": grp["cid"].astype(int).tolist(),
            "m": grp["mi"].astype(int).tolist(),
            "s": grp["si"].astype(int).tolist(),
            "n": grp["n"].astype(int).tolist(),
            "f": [round(float(x), 1) for x in grp["frp"]],
        },
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"), ensure_ascii=False)
    # Копия в виде скрипта: приложение открывается двойным щелчком по
    # index.html, без локального сервера (fetch не работает с file://).
    js_path = os.path.splitext(args.out)[0] + ".js"
    with open(js_path, "w", encoding="utf-8") as fh:
        fh.write("window.FIRE_GRID=")
        json.dump(out, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write(";")
    size = os.path.getsize(args.out) / 1e6
    print(f"Ячеек: {len(cells):,}; строк: {len(grp):,}; месяцев: {len(months)}")
    print(f"Датчики: {sensors}")
    print(f"Записано {args.out} ({size:.1f} МБ)")
    print("Статистика по датчикам:", json.dumps(stats, ensure_ascii=False))


if __name__ == "__main__":
    main()
