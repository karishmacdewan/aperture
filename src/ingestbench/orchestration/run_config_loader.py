"""Load run_config.yaml with a small fallback parser for lean runtimes."""

from __future__ import annotations

from pathlib import Path
from typing import Any


def load_run_config(path: Path | str = Path("configs/run_config.yaml")) -> dict[str, Any]:
    path = Path(path)
    text = path.read_text()
    try:
        import yaml

        return yaml.safe_load(text)
    except Exception:
        return _parse_project_yaml(text)


def _parse_project_yaml(text: str) -> dict[str, Any]:
    root: dict[str, Any] = {}
    stack: list[tuple[int, dict[str, Any]]] = [(-1, root)]

    for raw_line in text.splitlines():
        line = raw_line.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip(" "))
        key, value = [part.strip() for part in line.strip().split(":", 1)]

        while stack and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]

        if value == "":
            child: dict[str, Any] = {}
            parent[key] = child
            stack.append((indent, child))
        else:
            parent[key] = _parse_value(value)

    return root


def _parse_value(value: str) -> Any:
    value = value.strip().strip('"').strip("'")
    if value in {"true", "false"}:
        return value == "true"
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        return [] if not inner else [_parse_value(part.strip()) for part in inner.split(",")]
    if value.startswith("{") and value.endswith("}"):
        inner = value[1:-1].strip()
        if not inner:
            return {}
        out = {}
        for part in inner.split(","):
            k, v = [piece.strip() for piece in part.split(":", 1)]
            out[k] = _parse_value(v)
        return out
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        return value
