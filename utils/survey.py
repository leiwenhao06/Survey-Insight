# -*- coding: utf-8 -*-
"""问卷数据画像、概览与单题分析。"""
from __future__ import annotations

import math
import re

import numpy as np
import pandas as pd


MULTI_SEP_RE = re.compile(r"[;；、,，|]+")
ID_RE = re.compile(r"(问卷|样本|受访者|用户)?(编号|id)$|^id$|手机|邮箱|身份证|openid|uuid", re.I)
TIME_RE = re.compile(r"(提交|填写|创建|回收|发生)?(时间|日期)|date|time|timestamp", re.I)
TEXT_NAME_RE = re.compile(r"建议|意见|反馈|请说明|请注明|原因|备注|其他请补充")
MULTI_NAME_RE = re.compile(r"多选|可多选|复选|multiple|checkbox", re.I)
SCALE_NAME_RE = re.compile(r"满意度|评分|打分|程度|同意|认可|评价|兴趣|意愿|频率|信心|可能性|重要|likert|score|rating", re.I)

TYPE_LABELS = {
    "single": "单选题",
    "multi": "多选题",
    "scale": "量表题",
    "numeric": "数值题",
    "text": "文本题",
    "datetime": "时间列",
    "id": "标识列",
    "empty": "空列",
}

STOPWORDS = set(
    """的 了 和 与 及 或 是 在 我 有 也 都 就 不 很 还 会 要 可以 希望 建议 一些 一个 这个 那个 我们 你们 他们
    比较 非常 觉得 认为 能够 应该 需要 没有 还是 但是 因为 所以 如果 已经 目前 现在 以及 方面 问题 服务 平台 功能
    什么 怎么 这样 那样 一下 有点 更 再 又 很 太 更 挺 让 对 为 于 上 下 中 里 来 去 说 做 用 看 能 多 少
    the and for with that this from have not are was were will can""".split()
)


class Question:
    __slots__ = ("name", "type", "series", "n_valid", "missing", "unique", "options", "meta")

    def __init__(self, name: str, qtype: str, series: pd.Series):
        self.name = name
        self.type = qtype
        self.series = series
        self.n_valid = int(series.notna().sum())
        self.missing = int(len(series) - self.n_valid)
        self.unique = int(series.nunique(dropna=True))
        self.options: list[str] = []
        self.meta = {
            "name": name,
            "type": qtype,
            "type_label": TYPE_LABELS.get(qtype, qtype),
            "n_valid": self.n_valid,
            "missing": self.missing,
            "missing_rate": round(self.missing / max(len(series), 1) * 100, 2),
            "unique": self.unique,
            "options": self.options,
        }

    @property
    def type_label(self) -> str:
        return TYPE_LABELS.get(self.type, self.type)

    @property
    def is_analyzable(self) -> bool:
        return self.type in ("single", "multi", "scale", "numeric", "text")

    @property
    def is_categorical(self) -> bool:
        return self.type in ("single", "scale")

    @property
    def is_continuous(self) -> bool:
        return self.type in ("numeric", "scale")

    def numeric_values(self) -> pd.Series:
        if self.type in ("numeric", "scale"):
            return pd.to_numeric(self.series, errors="coerce").dropna()
        return pd.Series(dtype=float)

    def categories(self) -> pd.Series:
        s = self.series.dropna()
        if self.type in ("numeric", "scale"):
            s = pd.to_numeric(s, errors="coerce").dropna()
            return s.map(_fmt_num)
        return s.astype(str)

    def multi_tokens(self) -> list[list[str]]:
        rows = []
        for value in self.series.dropna().astype(str):
            tokens = [t.strip() for t in MULTI_SEP_RE.split(value) if t.strip()]
            if tokens:
                rows.append(tokens)
        return rows


def _fmt_num(v) -> str:
    try:
        f = float(v)
        return str(int(f)) if f.is_integer() else f"{f:g}"
    except (TypeError, ValueError):
        return str(v)


class SurveyDataset:
    """对问卷明细数据做类型识别和统计分析。"""

    def __init__(self, df: pd.DataFrame, name: str):
        self.df = df
        self.name = name
        self.questions: list[Question] = [self._profile(col) for col in df.columns]
        self.qmap = {q.name: q for q in self.questions}
        self.analysis_questions = [q for q in self.questions if q.is_analyzable]
        self._prepare_options()

    # ---------------------------------------------------------------- 类型识别
    def _profile(self, col: str) -> Question:
        s = self.df[col]
        name = str(col)
        nonnull = s.dropna()
        n = len(s)
        if nonnull.empty:
            return Question(name, "empty", s)

        # 时间列
        if pd.api.types.is_datetime64_any_dtype(s):
            return Question(name, "datetime", s)
        if TIME_RE.search(name) and not pd.api.types.is_numeric_dtype(s):
            try:
                parsed = pd.to_datetime(nonnull.astype(str), errors="coerce")
                if parsed.notna().mean() > 0.8:
                    return Question(name, "datetime", parsed.reindex(s.index))
            except Exception:  # noqa: BLE001
                pass

        # 标识列
        if ID_RE.search(name) and nonnull.nunique() / max(len(nonnull), 1) > 0.8:
            return Question(name, "id", s)

        # 数值型（含“数字被读成文本”的情况）
        numeric = None
        if pd.api.types.is_numeric_dtype(s) and not pd.api.types.is_bool_dtype(s):
            numeric = pd.to_numeric(s, errors="coerce")
        elif nonnull.map(lambda v: isinstance(v, str)).mean() > 0.8:
            conv = pd.to_numeric(nonnull, errors="coerce")
            if conv.notna().mean() >= 0.95:
                numeric = pd.to_numeric(s, errors="coerce")

        if numeric is not None:
            nv = numeric.dropna()
            uniq = nv.nunique()
            ints = bool(np.allclose(nv, np.round(nv)))
            if uniq <= 2:
                return Question(name, "single", numeric)
            if 2 < uniq <= 11 and ints and float(nv.min()) >= 0 and float(nv.max()) <= 10:
                if SCALE_NAME_RE.search(name) or (uniq <= 7 and float(nv.min()) >= 1):
                    return Question(name, "scale", numeric)
            return Question(name, "numeric", numeric)

        if pd.api.types.is_bool_dtype(s):
            return Question(name, "single", s.astype(str))

        text = nonnull.astype(str)
        if TEXT_NAME_RE.search(name) and text.nunique() > 2:
            return Question(name, "text", text)
        if MULTI_NAME_RE.search(name) and text.nunique() > 2:
            return Question(name, "multi", text)
        sep_share = text.map(lambda v: bool(MULTI_SEP_RE.search(v))).mean()
        token_lens: list[int] = []
        for v in text:
            parts = [p for p in MULTI_SEP_RE.split(v) if p.strip()]
            token_lens.extend(len(p) for p in parts)
        median_token_len = float(np.median(token_lens)) if token_lens else 99
        unique_ratio = text.nunique() / max(len(text), 1)
        median_len = float(text.map(len).median())
        # 多选题：有分隔符、片段短且反复出现
        if sep_share >= 0.08 and median_token_len <= 8 and text.nunique() <= max(25, n * 0.5):
            return Question(name, "multi", text)
        if median_len > 18 or (unique_ratio > 0.85 and median_len > 9):
            return Question(name, "text", text)
        if text.nunique() > max(35, n * 0.6):
            return Question(name, "text", text)
        return Question(name, "single", text)

    def _prepare_options(self):
        for q in self.analysis_questions:
            if q.type == "single":
                counts = q.categories().value_counts()
                q.options = [str(x) for x in counts.index[:40]]
            elif q.type == "multi":
                counter: dict[str, int] = {}
                for tokens in q.multi_tokens():
                    for t in tokens:
                        counter[t] = counter.get(t, 0) + 1
                q.options = [k for k, _ in sorted(counter.items(), key=lambda kv: -kv[1])[:40]]
            elif q.type == "scale":
                vals = sorted({_fmt_num(v) for v in q.numeric_values().unique()}, key=float)
                q.options = vals
            q.meta["options"] = q.options
            q.meta["is_categorical"] = q.is_categorical
            q.meta["is_continuous"] = q.is_continuous

    # ------------------------------------------------------------------ 查询
    def get(self, name: str) -> Question:
        q = self.qmap.get(name)
        if q is None:
            raise KeyError(f"题目「{name}」不存在")
        if not q.is_analyzable:
            raise ValueError(f"「{name}」是{TYPE_LABELS.get(q.type, q.type)}，不参与分析")
        return q

    def questions_meta(self) -> list[dict]:
        return [q.meta for q in self.analysis_questions]

    def question_names(self, types: tuple[str, ...] | None = None) -> list[str]:
        return [q.name for q in self.analysis_questions if not types or q.type in types]

    # ------------------------------------------------------------------ 概览
    def overview(self) -> dict:
        n = len(self.df)
        aqs = self.analysis_questions
        total_cells = n * len(aqs)
        missing_cells = sum(q.missing for q in aqs)
        completion = (1 - missing_cells / total_cells) * 100 if total_cells else 0

        key_cols = [q.name for q in aqs]
        dup = int(self.df.duplicated(subset=key_cols).sum()) if key_cols else 0

        scale_qs = [q for q in aqs if q.type == "scale"]
        straight = 0
        if len(scale_qs) >= 2:
            mat = pd.DataFrame({q.name: pd.to_numeric(q.series, errors="coerce") for q in scale_qs})
            filled = mat.notna().sum(axis=1)
            nunique = mat.nunique(axis=1)
            straight = int(((filled >= 2) & (nunique == 1)).sum())

        type_counts: dict[str, int] = {}
        for q in aqs:
            type_counts[q.type_label] = type_counts.get(q.type_label, 0) + 1

        date_range = None
        for q in self.questions:
            if q.type == "datetime":
                vals = pd.to_datetime(q.series, errors="coerce").dropna()
                if not vals.empty:
                    date_range = {
                        "column": q.name,
                        "start": vals.min().strftime("%Y-%m-%d"),
                        "end": vals.max().strftime("%Y-%m-%d"),
                        "days": int((vals.max() - vals.min()).days) + 1,
                    }
                    break

        low_completion = [q.meta for q in aqs if q.meta["missing_rate"] >= 20]
        quality = self._quality_score(completion, dup / max(n, 1) * 100, straight / max(n, 1) * 100, len(low_completion))

        completion_by_question = sorted(
            [{"name": q.name, "type": q.type, "completion": round(100 - q.meta["missing_rate"], 2)} for q in aqs],
            key=lambda x: x["completion"],
        )

        return {
            "dataset": {
                "id": getattr(self, "dataset_id", None),
                "name": self.name,
                "rows": n,
                "columns": len(self.df.columns),
                "analysis_questions": len(aqs),
            },
            "kpi": {
                "rows": n,
                "questions": len(aqs),
                "completion": round(completion, 2),
                "duplicates": dup,
                "straight_liners": straight,
                "quality_score": quality,
                "missing_cells": missing_cells,
            },
            "type_counts": [{"name": k, "value": v} for k, v in sorted(type_counts.items(), key=lambda kv: -kv[1])],
            "completion_by_question": completion_by_question,
            "low_completion": low_completion,
            "date_range": date_range,
            "scale_question_count": len(scale_qs),
            "insights": self.basic_insights(completion, dup, straight, scale_qs),
            "dataset_id": getattr(self, "dataset_id", None),
        }

    @staticmethod
    def _quality_score(completion: float, dup_rate: float, straight_rate: float, low_completion_n: int) -> int:
        score = 100.0
        score -= min(30.0, (100 - completion) * 2.0)
        score -= min(20.0, dup_rate * 2.0)
        score -= min(20.0, straight_rate * 4.0)
        score -= min(10.0, low_completion_n * 2.0)
        return int(round(max(0, min(100, score))))

    def basic_insights(self, completion: float, dup: int, straight: int, scale_qs: list[Question]) -> list[dict]:
        n = len(self.df)
        out: list[dict] = []
        if n < 100:
            out.append({"level": "warn", "tag": "样本量", "title": f"样本量偏小（N={n}）",
                        "text": "置信区间会较宽，建议补充样本或谨慎解读比例差异。"})
        else:
            out.append({"level": "good", "tag": "样本量", "title": f"样本量 {n} 份",
                        "text": "样本量满足常规问卷分析需要，百分比结果的误差范围可控。"})

        if completion >= 95:
            out.append({"level": "good", "tag": "完成度", "title": f"整体完成率 {completion:.1f}%",
                        "text": "缺失数据很少，各题统计结果具有较好的可比性。"})
        elif completion < 85:
            out.append({"level": "warn", "tag": "完成度", "title": f"整体完成率仅 {completion:.1f}%",
                        "text": "缺失较多，建议检查问卷长度与必填设置，并在报告中说明缺失处理方式。"})

        low = [q for q in self.analysis_questions if q.meta["missing_rate"] >= 20]
        if low:
            names = "、".join(q.name for q in low[:3]) + ("等" if len(low) > 3 else "")
            out.append({"level": "warn", "tag": "缺失", "title": f"{len(low)} 道题缺失率超过 20%",
                        "text": f"{names} 的有效回答偏少，相关结论需谨慎。"})

        if dup > 0:
            out.append({"level": "warn", "tag": "质量", "title": f"检测到 {dup} 份重复答卷",
                        "text": "存在答案完全相同的记录，建议结合提交时间/IP 判断是否剔除。"})
        if straight > 0:
            out.append({"level": "warn", "tag": "质量", "title": f"发现 {straight} 份直线作答",
                        "text": "这些答卷在所有量表题上选择同一分值，可能影响信度，建议标注或剔除。"})

        # 代表性单选题结论
        singles = [q for q in self.analysis_questions if q.type == "single" and q.n_valid >= max(10, n * 0.3)]
        ranked = []
        for q in singles:
            counts = q.categories().value_counts()
            if len(counts) >= 2:
                ranked.append((counts.iloc[0] / counts.sum(), q, counts))
        for share, q, counts in sorted(ranked, reverse=True, key=lambda x: x[0])[:2]:
            top = str(counts.index[0])
            out.append({"level": "info", "tag": "分布", "title": f"{q.name}：{top}占 {share * 100:.1f}%",
                        "text": f"在该题 {int(counts.sum())} 份有效回答中，选择「{top}」的受访者最多。"})

        multis = [q for q in self.analysis_questions if q.type == "multi"]
        for q in multis[:1]:
            tokens = [t for row in q.multi_tokens() for t in row]
            if tokens:
                vc = pd.Series(tokens).value_counts()
                out.append({"level": "info", "tag": "多选", "title": f"{q.name}：{vc.index[0]}最常被选择",
                            "text": f"{int(vc.iloc[0])} 人次选择「{vc.index[0]}」，占有效受访者的 "
                                    f"{vc.iloc[0] / max(q.n_valid, 1) * 100:.1f}%。"})

        if len(scale_qs) >= 2:
            means = []
            for q in scale_qs:
                vals = q.numeric_values()
                if len(vals):
                    means.append((float(vals.mean()), q.name))
            if means:
                hi = max(means)
                lo = min(means)
                out.append({"level": "info", "tag": "量表", "title": f"最高均值：{hi[1]}（{hi[0]:.2f} 分）",
                            "text": f"各量表题中「{hi[1]}」评分最高，「{lo[1]}」相对最低"
                                    + ("，两者均值差较小。" if hi[0] - lo[0] < 0.15 else f"，相差 {hi[0] - lo[0]:.2f} 分。")})

        if len(out) > 8:
            out = out[:8]
        order = {"warn": 0, "good": 1, "info": 2}
        return sorted(out, key=lambda x: order.get(x["level"], 3))

    # ---------------------------------------------------------------- 单题分析
    def frequency(self, name: str) -> dict:
        q = self.get(name)
        base = {
            "question": q.meta,
            "n_total": len(self.df),
            "n_valid": q.n_valid,
            "missing": q.missing,
            "missing_rate": round(q.missing / max(len(self.df), 1) * 100, 2),
        }
        if q.type == "single":
            base.update(self._single_freq(q))
        elif q.type == "multi":
            base.update(self._multi_freq(q))
        elif q.type == "scale":
            base.update(self._scale_freq(q))
        elif q.type == "numeric":
            base.update(self._numeric_freq(q))
        else:
            base.update(self._text_freq(q))
        return base

    def _single_freq(self, q: Question) -> dict:
        cats = q.categories()
        counts = cats.value_counts()
        total = int(counts.sum())
        items = []
        cum = 0.0
        for label, count in counts.items():
            pct = count / total * 100 if total else 0
            cum += pct
            items.append({
                "label": str(label), "count": int(count), "pct": round(pct, 2),
                "cum_pct": round(cum, 2),
            })
        show_other = len(items) > 20
        if show_other:
            head = items[:19]
            rest = items[19:]
            head.append({
                "label": "其他（合并）", "count": int(sum(i["count"] for i in rest)),
                "pct": round(sum(i["pct"] for i in rest), 2),
                "cum_pct": round(sum(i["cum_pct"] for i in rest), 2), "aggregated": True,
            })
            items = head
        top = items[0] if items else None
        return {
            "kind": "categorical",
            "items": items,
            "top_option": top["label"] if top else None,
            "top_share": top["pct"] if top else 0,
            "category_count": int(q.unique),
            "concentration": round(sum((i["count"] / total) ** 2 for i in items) * 100, 2) if total else 0,
        }

    def _multi_freq(self, q: Question) -> dict:
        rows = q.multi_tokens()
        n_resp = len(rows)
        counter: dict[str, int] = {}
        for tokens in rows:
            for t in tokens:
                counter[t] = counter.get(t, 0) + 1
        total_mentions = sum(counter.values())
        items = [
            {
                "label": k, "count": int(v),
                "pct": round(v / max(n_resp, 1) * 100, 2),
                "pct_mentions": round(v / max(total_mentions, 1) * 100, 2),
            }
            for k, v in sorted(counter.items(), key=lambda kv: -kv[1])
        ]
        top = items[0] if items else None
        return {
            "kind": "multi",
            "items": items[:30],
            "n_respondents": n_resp,
            "total_mentions": total_mentions,
            "avg_selected": round(total_mentions / max(n_resp, 1), 2),
            "top_option": top["label"] if top else None,
            "top_share": top["pct"] if top else 0,
        }

    def _scale_freq(self, q: Question) -> dict:
        s = q.numeric_values()
        counts = s.value_counts().sort_index()
        total = int(counts.sum())
        items = [
            {"label": _fmt_num(v), "count": int(c), "pct": round(c / total * 100, 2) if total else 0}
            for v, c in counts.items()
        ]
        stats = _numeric_stats(s)
        values = list(counts.index)
        if len(values) >= 4:
            top_levels, bottom_levels = values[-2:], values[:2]
        elif len(values) >= 2:
            top_levels, bottom_levels = values[-1:], values[:1]
        else:
            top_levels = bottom_levels = values[:1]
        top_set = set(top_levels)
        bottom_set = set(bottom_levels)
        top2 = sum(c for v, c in counts.items() if v in top_set)
        bottom2 = sum(c for v, c in counts.items() if v in bottom_set)
        neutral = max(0, total - top2 - bottom2)
        top_threshold = float(top_levels[0]) if top_levels else None
        bottom_threshold = float(bottom_levels[-1]) if bottom_levels else None
        return {
            "kind": "scale",
            "items": items,
            "stats": stats,
            "scale_max": float(s.max()) if len(s) else None,
            "scale_min": float(s.min()) if len(s) else None,
            "top2_pct": round(top2 / total * 100, 2) if total else 0,
            "bottom2_pct": round(bottom2 / total * 100, 2) if total else 0,
            "neutral_pct": round(neutral / total * 100, 2) if total else 0,
            "top2_threshold": top_threshold,
            "bottom2_threshold": bottom_threshold,
        }

    def _numeric_freq(self, q: Question) -> dict:
        s = q.numeric_values()
        stats = _numeric_stats(s)
        dist = []
        if len(s):
            edges = np.histogram_bin_edges(s.to_numpy(), bins="auto")
            if len(edges) > 9:
                edges = np.linspace(float(s.min()), float(s.max()), 9)
            counts, edges = np.histogram(s.to_numpy(), bins=edges)
            for i, c in enumerate(counts):
                lo, hi = float(edges[i]), float(edges[i + 1])
                if abs(hi - lo) >= 10:
                    label = f"{lo:.0f}–{hi:.0f}"
                else:
                    label = f"{lo:.1f}–{hi:.1f}"
                dist.append({
                    "label": label,
                    "count": int(c), "pct": round(c / len(s) * 100, 2),
                })
        return {"kind": "numeric", "stats": stats, "distribution": dist}

    def _text_freq(self, q: Question) -> dict:
        s = q.series.dropna().astype(str)
        s = s[s.str.strip() != ""]
        vc = s.value_counts()
        top_answers = [{"label": str(k), "count": int(v)} for k, v in vc.head(15).items()]
        words = _word_frequency(s)
        samples = [str(x) for x in vc.index[:12]]
        return {
            "kind": "text",
            "n_answers": int(len(s)),
            "unique_answers": int(s.nunique()),
            "avg_length": round(float(s.map(len).mean()), 1) if len(s) else 0,
            "top_answers": top_answers,
            "words": words,
            "samples": samples,
        }


def _numeric_stats(s: pd.Series) -> dict:
    if s.empty:
        return {"n": 0}
    q1, med, q3 = np.percentile(s, [25, 50, 75])
    iqr = q3 - q1
    lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    outliers = int(((s < lower) | (s > upper)).sum())
    try:
        skew = float(s.skew())
    except Exception:  # noqa: BLE001
        skew = 0.0
    try:
        kurt = float(s.kurt())
    except Exception:  # noqa: BLE001
        kurt = 0.0
    mean = float(s.mean())
    sd = float(s.std(ddof=1)) if len(s) > 1 else 0.0
    se = sd / math.sqrt(len(s)) if len(s) else 0.0
    return {
        "n": int(len(s)),
        "mean": round(mean, 2),
        "median": round(float(med), 2),
        "std": round(sd, 2),
        "se": round(se, 3),
        "ci_low": round(mean - 1.96 * se, 2),
        "ci_high": round(mean + 1.96 * se, 2),
        "min": round(float(s.min()), 2),
        "max": round(float(s.max()), 2),
        "q1": round(float(q1), 2),
        "q3": round(float(q3), 2),
        "iqr": round(float(iqr), 2),
        "outliers": outliers,
        "skew": round(skew, 2),
        "kurtosis": round(kurt, 2),
        "sum": round(float(s.sum()), 2),
    }


def _word_frequency(s: pd.Series) -> list[dict]:
    try:
        import jieba

        jieba.setLogLevel(20)
        counter: dict[str, int] = {}
        for text in s.head(1000):
            for word in jieba.cut(str(text)):
                word = word.strip()
                if len(word) < 2 or word in STOPWORDS:
                    continue
                if not re.match(r"^[一-龥A-Za-z]{2,}$", word):
                    continue
                counter[word] = counter.get(word, 0) + 1
        return [{"label": k, "count": int(v)} for k, v in sorted(counter.items(), key=lambda kv: -kv[1])[:20]]
    except Exception:  # noqa: BLE001
        return []
