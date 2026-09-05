#!/usr/bin/env python3
"""Serve Margin and its local ECDICT endpoint with Python's standard library."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
POS_NAMES = {
    "n": "noun",
    "v": "verb",
    "vt": "transitive verb",
    "vi": "intransitive verb",
    "a": "adjective",
    "adj": "adjective",
    "r": "adverb",
    "ad": "adverb",
    "adv": "adverb",
    "prep": "preposition",
    "conj": "conjunction",
    "pron": "pronoun",
    "num": "number",
    "int": "interjection",
}
IRREGULAR = {
    "caught": "catch",
    "went": "go",
    "gone": "go",
    "been": "be",
    "was": "be",
    "were": "be",
    "did": "do",
    "done": "do",
    "had": "have",
    "made": "make",
    "told": "tell",
    "said": "say",
    "thought": "think",
    "bought": "buy",
    "brought": "bring",
    "found": "find",
    "left": "leave",
    "felt": "feel",
    "kept": "keep",
    "knew": "know",
    "known": "know",
    "saw": "see",
    "seen": "see",
    "took": "take",
    "taken": "take",
    "wrote": "write",
    "written": "write",
}


def clean_term(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip(" \t\r\n\"'“”‘’()[]{}.,!?;:"))[:128]


def candidates(term: str) -> list[str]:
    lower = term.lower()
    result = [lower]
    if lower in IRREGULAR:
        result.append(IRREGULAR[lower])
    if lower.endswith("ies") and len(lower) > 4:
        result.append(lower[:-3] + "y")
    if lower.endswith("ing") and len(lower) > 5:
        stem = lower[:-3]
        result.extend((stem, stem + "e"))
        if len(stem) > 2 and stem[-1] == stem[-2]:
            result.append(stem[:-1])
    if lower.endswith("ied") and len(lower) > 4:
        result.append(lower[:-3] + "y")
    elif lower.endswith("ed") and len(lower) > 4:
        stem = lower[:-2]
        result.extend((stem, stem + "e"))
        if len(stem) > 2 and stem[-1] == stem[-2]:
            result.append(stem[:-1])
    if lower.endswith("es") and len(lower) > 4:
        result.extend((lower[:-2], lower[:-1]))
    elif lower.endswith("s") and len(lower) > 3:
        result.append(lower[:-1])
    return list(dict.fromkeys(result))


def normalize_pos(value: str) -> str:
    code = value.strip().lower().rstrip(".")
    return POS_NAMES.get(code, value.strip())


def exchange_lemma(value: str) -> str:
    match = re.search(r"(?:^|/)0:([^/]+)", value or "")
    return match.group(1).strip() if match else ""


def senses(row: sqlite3.Row) -> list[dict]:
    translation = (row["translation"] or "").replace("\\n", "\n")
    definition = (row["definition"] or "").replace("\\n", "\n")
    lines = [line.strip() for line in translation.splitlines() if line.strip()]
    if not lines and definition:
        lines = [line.strip() for line in definition.splitlines() if line.strip()]
    grouped: list[dict] = []
    default_pos = normalize_pos(row["pos"] or "")
    for line in lines[:10]:
        match = re.match(r"^([A-Za-z]+(?:\.[A-Za-z]+)*\.)\s*(.+)$", line)
        part = normalize_pos(match.group(1)) if match else default_pos
        text = match.group(2).strip() if match else line
        target = next((item for item in grouped if item["partOfSpeech"] == part), None)
        if target is None:
            target = {"partOfSpeech": part, "definitions": [], "synonyms": [], "antonyms": []}
            grouped.append(target)
        target["definitions"].append({"definition": text, "example": "", "synonyms": [], "antonyms": []})
    return grouped


class DictionaryDatabase:
    def __init__(self, path: Path):
        self.path = path

    def lookup(self, requested: str) -> dict | None:
        if not self.path.exists():
            raise FileNotFoundError(self.path)
        connection = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        try:
            row = None
            matched = requested
            for candidate in candidates(requested):
                row = connection.execute("SELECT * FROM entries WHERE word = ? COLLATE NOCASE", (candidate,)).fetchone()
                if row:
                    matched = candidate
                    break
            if not row:
                return None
            lemma = exchange_lemma(row["exchange"] or "")
            if not lemma and matched.lower() != requested.lower():
                lemma = row["word"]
            normalized_senses = senses(row)
            inflection_note = row["translation"] or ""
            inferred_inflection_pos = "verb" if re.search(r"过去式|过去分词|现在分词|第三人称单数", inflection_note) else "noun" if "复数" in inflection_note else ""
            if inferred_inflection_pos:
                for item in normalized_senses:
                    if not item["partOfSpeech"]:
                        item["partOfSpeech"] = inferred_inflection_pos
            if lemma and any(not item["partOfSpeech"] for item in normalized_senses):
                base = connection.execute("SELECT * FROM entries WHERE word = ? COLLATE NOCASE", (lemma,)).fetchone()
                base_pos = normalize_pos(base["pos"] or "") if base else ""
                if not base_pos and base:
                    base_pos = next((item["partOfSpeech"] for item in senses(base) if item["partOfSpeech"]), "")
                if base_pos:
                    for item in normalized_senses:
                        if not item["partOfSpeech"]:
                            item["partOfSpeech"] = base_pos
            return {
                "term": requested,
                "headword": row["word"],
                "lemma": lemma if lemma.lower() != requested.lower() else "",
                "phonetic": row["phonetic"] or "",
                "audio": row["audio"] or "",
                "audioRegion": "",
                "meanings": normalized_senses,
                "synonyms": [],
                "antonyms": [],
                "source": {
                    "id": "ecdict-local",
                    "label": "ECDICT 本地词典",
                    "url": "https://github.com/skywind3000/ECDICT",
                },
            }
        finally:
            connection.close()


class MarginHandler(SimpleHTTPRequestHandler):
    database: DictionaryDatabase

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/dictionary/status":
            return self.send_json({"ready": self.database.path.exists()})
        if parsed.path == "/api/dictionary":
            term = clean_term(parse_qs(parsed.query).get("term", [""])[0])
            if not term:
                return self.send_json({"error": "missing-term"}, HTTPStatus.BAD_REQUEST)
            try:
                result = self.database.lookup(term)
            except FileNotFoundError:
                return self.send_json({"error": "dictionary-not-installed"}, HTTPStatus.SERVICE_UNAVAILABLE)
            if not result:
                return self.send_json({"error": "not-found"}, HTTPStatus.NOT_FOUND)
            return self.send_json({"data": result})
        super().do_GET()

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--db", type=Path, default=ROOT / "data" / "ecdict.sqlite3")
    args = parser.parse_args()
    MarginHandler.database = DictionaryDatabase(args.db.resolve())
    server = ThreadingHTTPServer(("127.0.0.1", args.port), MarginHandler)
    print(f"Margin: http://127.0.0.1:{args.port}/index.html", flush=True)
    print(f"Dictionary: {args.db.resolve()}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
