# -*- coding: utf-8 -*-
"""文件读取、编码识别与示例数据加载。"""
from __future__ import annotations

import io
import re
from pathlib import Path

import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MAX_UPLOAD_BYTES = 30 * 1024 * 1024
ALLOWED_SUFFIXES = {".csv", ".tsv", ".xlsx", ".xls"}


class DataError(ValueError):
    """可直接展示给用户的数据错误。"""


def _decode_text(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "gb18030", "gbk", "big5"):
        try:
            text = raw.decode(enc)
        except UnicodeDecodeError:
            continue
        # 替换字符过多说明编码识别错误
        if text.count("�") < 5:
            return text
    raise DataError("无法识别文件编码，请将文件另存为 UTF-8 或 GBK 编码的 CSV。")


def _read_csv_bytes(raw: bytes) -> pd.DataFrame:
    text = _decode_text(raw)
    sample = text[:8192]
    sep = ","
    try:
        import csv

        sep = csv.Sniffer().sniff(sample, delimiters=",\t;|").delimiter
    except Exception:
        if sample.count("\t") > sample.count(","):
            sep = "\t"
    return pd.read_csv(io.StringIO(text), sep=sep, engine="python", on_bad_lines="skip")


def read_table(raw: bytes, filename: str) -> pd.DataFrame:
    """读取上传的 CSV / Excel，返回清理过列名的 DataFrame。"""
    if not raw:
        raise DataError("文件内容为空。")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise DataError("文件超过 30MB，请拆分后再上传。")
    suffix = Path(filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise DataError("仅支持 .csv、.tsv、.xlsx、.xls 文件。")
    try:
        if suffix in (".xlsx", ".xls"):
            df = pd.read_excel(io.BytesIO(raw), sheet_name=0)
        else:
            df = _read_csv_bytes(raw)
    except DataError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise DataError(f"文件解析失败：{exc}") from exc

    df = normalize_frame(df)
    if df.empty:
        raise DataError("数据表为空，未读取到任何答卷。")
    if df.shape[1] == 0:
        raise DataError("未识别到有效列。")
    return df


def normalize_frame(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    cleaned = [_clean_col(str(c), i) for i, c in enumerate(df.columns)]
    used: set[str] = set()
    deduped: list[str] = []
    for name in cleaned:
        candidate = name
        suffix = 1
        while candidate in used:
            candidate = f"{name} ({suffix})"
            suffix += 1
        used.add(candidate)
        deduped.append(candidate)
    df.columns = deduped
    # 丢掉完全空白的行与列
    df = df.dropna(axis=0, how="all").dropna(axis=1, how="all")
    # 全空列名兜底
    df.columns = [c if c else f"未命名列{i + 1}" for i, c in enumerate(df.columns)]
    # 去掉字符串首尾空白，空串视为缺失
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].map(lambda v: v.strip() if isinstance(v, str) else v)
            df[col] = df[col].replace({"": None, "nan": None, "NaN": None})
    return df


def _clean_col(name: str, idx: int) -> str:
    name = re.sub(r"\s+", " ", name).strip()
    if name.lower().startswith("unnamed"):
        return ""
    return name[:80] or f"未命名列{idx + 1}"


def read_path(path: Path) -> pd.DataFrame:
    return read_table(path.read_bytes(), path.name)


def load_sample_survey() -> tuple[pd.DataFrame, str]:
    path = DATA_DIR / "sample_survey.csv"
    if not path.exists():
        raise DataError("示例数据尚未生成，请先运行 python tools/make_sample.py。")
    return normalize_frame(pd.read_csv(path, encoding="utf-8-sig")), path.name


def load_sample_baseline() -> tuple[pd.DataFrame, str]:
    path = DATA_DIR / "sample_baseline.csv"
    if not path.exists():
        raise DataError("示例基准数据尚未生成，请先运行 python tools/make_sample.py。")
    return normalize_frame(pd.read_csv(path, encoding="utf-8-sig")), path.name


def to_jsonable(value):
    """把 numpy / pandas 标量转成可 JSON 序列化的值。"""
    if value is None or value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, float):
        return None if pd.isna(value) else round(value, 6)
    try:
        import numpy as np

        if isinstance(value, (np.integer,)):
            return int(value)
        if isinstance(value, (np.floating,)):
            return None if pd.isna(value) else round(float(value), 6)
        if isinstance(value, (np.bool_,)):
            return bool(value)
    except Exception:  # pragma: no cover
        pass
    if isinstance(value, pd.Timestamp):
        return value.strftime("%Y-%m-%d %H:%M")
    return value


def jsonable(obj):
    """递归转换 numpy / pandas 类型，便于 Flask jsonify。"""
    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    return to_jsonable(obj)
