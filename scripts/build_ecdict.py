#!/usr/bin/env python3
"""Build the compact local ECDICT SQLite database used by Margin."""

from __future__ import annotations

import argparse
import csv
import os
import sqlite3
import sys
from pathlib import Path


FIELDS = (
    "word",
    "phonetic",
    "definition",
    "translation",
    "pos",
    "collins",
    "oxford",
    "bnc",
    "frq",
    "exchange",
    "audio",
)


def value(row: dict[str, str], name: str) -> str:
    return (row.get(name) or "").strip()


def build(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".building")
    if temporary.exists():
        temporary.unlink()

    connection = sqlite3.connect(temporary)
    connection.executescript(
        """
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;
        CREATE TABLE entries (
            word TEXT PRIMARY KEY COLLATE NOCASE,
            phonetic TEXT,
            definition TEXT,
            translation TEXT,
            pos TEXT,
            collins INTEGER,
            oxford INTEGER,
            bnc INTEGER,
            frq INTEGER,
            exchange TEXT,
            audio TEXT
        ) WITHOUT ROWID;
        """
    )
    insert = "INSERT OR IGNORE INTO entries (" + ",".join(FIELDS) + ") VALUES (" + ",".join("?" for _ in FIELDS) + ")"
    count = 0
    batch: list[tuple[str, ...]] = []

    csv.field_size_limit(sys.maxsize)
    with source.open("r", encoding="utf-8-sig", errors="replace", newline="") as stream:
        reader = csv.DictReader(stream)
        for row in reader:
            word = value(row, "word")
            if not word or len(word) > 128:
                continue
            batch.append(tuple(word if name == "word" else value(row, name) for name in FIELDS))
            if len(batch) >= 5000:
                connection.executemany(insert, batch)
                count += len(batch)
                batch.clear()
                if count % 100000 == 0:
                    print(f"Imported {count:,} rows…", flush=True)
        if batch:
            connection.executemany(insert, batch)
            count += len(batch)

    connection.execute("CREATE INDEX entries_frequency ON entries (frq, bnc)")
    connection.execute("PRAGMA optimize")
    connection.commit()
    actual = connection.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
    connection.close()
    os.replace(temporary, destination)
    print(f"Local dictionary ready: {actual:,} entries → {destination}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="Path to the official ecdict.csv")
    parser.add_argument("destination", type=Path, help="SQLite output path")
    args = parser.parse_args()
    build(args.source.resolve(), args.destination.resolve())


if __name__ == "__main__":
    main()
