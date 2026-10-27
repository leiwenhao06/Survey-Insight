# -*- coding: utf-8 -*-
"""大数据统计结果的解析、匹配与问卷对比。"""
from __future__ import annotations

import math
import re

import numpy as np
import pandas as pd
from scipy import stats

from .dataio import DataError
from .survey import Question, SurveyDataset, _fmt_num

Q_CANDS = ["题目", "问题", "题项", "题号", "question", "question_name", "qname", "q"]
OPT_CANDS = ["选项", "答案", "类别", "取值", "option", "answer", "category", "choice", "label"]
PCT_CANDS = ["比例(%)", "比例", "占比", "百分比", "份额", "proportion", "percent", "percentage", "pct", "ratio", "share"]
CNT_CANDS = ["频数", "人数", "样本数", "样本量", "count", "n", "frequency", "num", "freq"]


def _find_col(df: pd.DataFrame, cands: list[str]) -> str | None:
    lowered = {str(c).strip().lower(): c for c in df.columns}
    for cand in cands:
        if cand.lower() in lowered:
            return lowered[cand.lower()]
    for col in df.columns:
        name = str(col).strip().lower()
        for cand in cands:
            if len(cand) <= 2:
                continue  # 短列名只做精确匹配，避免误命中
            if cand.lower() in name:
                return col
    return None


def _norm_option(v) -> str:
    s = str(v).strip()
    try:
        f = float(s)
        if f.is_integer():
            return str(int(f))
        return f"{f:g}"
    except (TypeError, ValueError):
        pass
    s = re.sub(r"\s+", "", s)
    return s.lower()


def _norm_question(name: str) -> str:
    s = str(name).strip()
    s = re.sub(r"^[Qq]\d+[\.、:：\)]?\s*", "", s)
    s = re.sub(r"[（(]\s*(多选|单选|可多选)\s*[)）]", "", s)
    s = re.sub(r"\s+", "", s)
    return s.lower()


def _to_number(series: pd.Series) -> pd.Series:
    cleaned = (series.astype(str)
               .str.replace("%", "", regex=False)
               .str.replace("％", "", regex=False)
               .str.replace(",", "", regex=False)
               .str.strip())
    return pd.to_numeric(cleaned, errors="coerce")


def _is_number(v) -> bool:
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


class BaselineDataset:
    """聚合型大数据统计结果：题目 / 选项 / 比例或频数。"""

    def __init__(self, df: pd.DataFrame, name: str):
        self.df = df
        self.name = name
        self.qcol = _find_col(df, Q_CANDS)
        self.ocol = _find_col(df, OPT_CANDS)
        self.pcol = _find_col(df, PCT_CANDS)
        self.ccol = _find_col(df, CNT_CANDS)
        if not self.qcol or not self.ocol:
            raise DataError(
                "基准数据需要「题目」「选项」两列。请使用聚合长表格式，"
                "列名示例：题目、选项、比例(%)（或频数）。"
            )
        if not self.pcol and not self.ccol:
            raise DataError("基准数据需要「比例」「占比」「百分比」或「频数」列。")
        self.questions: dict[str, dict] = {}
        self.warnings: list[str] = []
        self._parse()

    def _parse(self):
        df = self.df.copy()
        df = df.dropna(subset=[self.qcol, self.ocol])
        df[self.qcol] = df[self.qcol].astype(str).str.strip()
        df = df[df[self.qcol] != ""]
        if df.empty:
            raise DataError("基准数据中没有有效的题目与选项记录。")

        # 比例列：识别 0-1 小数与 0-100 百分数
        self.pct_is_fraction = False
        if self.pcol:
            pcts = _to_number(df[self.pcol])
            df["_pct"] = pcts
            valid = pcts.dropna()
            col_name = str(self.pcol).lower()
            named_percent = "%" in col_name or "百分" in col_name or "占比" in col_name
            if (not named_percent and not valid.empty
                    and valid.max() <= 1.0001 and valid.min() >= 0):
                self.pct_is_fraction = True
                df["_pct"] = pcts * 100
        if self.ccol:
            df["_count"] = _to_number(df[self.ccol])

        if not self.pcol and self.ccol:
            sums = df.groupby(self.qcol)["_count"].transform("sum")
            df["_pct"] = np.where(sums > 0, df["_count"] / sums * 100, np.nan)
        elif self.pcol and self.ccol:
            # 比例缺失时用频数补
            sums = df.groupby(self.qcol)["_count"].transform("sum")
            fill = np.where(sums > 0, df["_count"] / sums * 100, np.nan)
            df["_pct"] = df["_pct"].fillna(pd.Series(fill, index=df.index))

        df = df[df["_pct"].notna()]
        if df.empty:
            raise DataError("基准数据中没有可解析的比例或频数。")

        for qname, sub in df.groupby(self.qcol, sort=False):
            options: dict[str, dict] = {}
            order: list[str] = []
            for _, row in sub.iterrows():
                display = str(row[self.ocol]).strip()
                key = _norm_option(display)
                if key not in options:
                    options[key] = {"label": display, "pct": 0.0, "count": 0.0}
                    order.append(key)
                options[key]["pct"] += float(row["_pct"])
                if "_count" in row and not pd.isna(row["_count"]):
                    options[key]["count"] += float(row["_count"])
            total_pct = float(sum(o["pct"] for o in options.values()))
            total_count = float(sum(o["count"] for o in options.values()))
            if total_pct and abs(total_pct - 100) > 1.5 and total_pct < 101:
                self.warnings.append(f"「{qname}」的占比合计为 {total_pct:.1f}%，与 100% 略有差异。")
            self.questions[str(qname).strip()] = {
                "name": str(qname).strip(),
                "options": options,
                "order": order,
                "sum_pct": round(total_pct, 2),
                "sum_count": total_count,
                "has_count": self.ccol is not None,
                "multi_like": total_pct > 110,
            }
        if not self.questions:
            raise DataError("未能从基准数据中解析出题目。")

    # ------------------------------------------------------------------ 元信息
    def summary(self) -> dict:
        return {
            "name": self.name,
            "questions": len(self.questions),
            "rows": len(self.df),
            "has_count": self.ccol is not None,
            "pct_is_fraction": self.pct_is_fraction,
            "warnings": self.warnings[:8],
        }

    def match_meta(self, survey: SurveyDataset) -> dict:
        survey_cat = [
            {"name": q.name, "type": q.type, "type_label": q.type_label, "options": q.options[:40]}
            for q in survey.analysis_questions if q.type in ("single", "multi", "scale")
        ]
        survey_names = [q["name"] for q in survey_cat]
        norm_survey = {_norm_question(n): n for n in survey_names}
        used: set[str] = set()
        matches = []
        for qname, info in self.questions.items():
            nq = _norm_question(qname)
            suggested = norm_survey.get(nq)
            if suggested in used:
                suggested = None
            auto = bool(suggested)
            if suggested is None:
                # 包含关系匹配
                candidates = [name for norm, name in norm_survey.items()
                              if (nq and (nq in norm or norm in nq))]
                candidates = [c for c in candidates if c not in used]
                if len(candidates) == 1:
                    suggested, auto = candidates[0], True
            if suggested and suggested not in used:
                used.add(suggested)
            matches.append({
                "baseline_question": qname,
                "options_count": len(info["options"]),
                "sum_pct": info["sum_pct"],
                "multi_like": info["multi_like"],
                "suggested": suggested,
                "auto": auto,
            })
        return {
            "baseline": self.summary(),
            "survey_questions": survey_cat,
            "matches": matches,
            "matched_count": sum(1 for m in matches if m["suggested"]),
        }

    # ------------------------------------------------------------------ 对比
    def compare(self, survey: SurveyDataset, baseline_question: str, survey_question: str) -> dict:
        if baseline_question not in self.questions:
            raise ValueError(f"基准数据中不存在题目「{baseline_question}」。")
        sq = survey.get(survey_question)
        if sq.type not in ("single", "multi", "scale"):
            raise ValueError("大数据对比目前支持单选题、多选题与量表题。")

        base = self.questions[baseline_question]
        survey_dist, n_survey, method_note = _survey_distribution(sq)
        base_dist = {key: opt["pct"] for key, opt in base["options"].items()}
        base_total = sum(base_dist.values())

        # 选项排序：量表按数值，其余按问卷占比降序；再补基准独有项
        order = [k for k, _ in sorted(survey_dist.items(), key=lambda kv: -kv[1])]
        if sq.type == "scale":
            order = sorted(survey_dist.keys(), key=_float_key)
        seen = set(order)
        for key in base["order"]:
            if key not in seen:
                order.append(key)
                seen.add(key)

        rows = []
        only_survey = 0
        only_base = 0
        matched_keys = []
        for key in order:
            s_pct = survey_dist.get(key, 0.0)
            b_pct = base_dist.get(key, 0.0)
            display = _label_for(key, sq, base)
            if key in base["options"]:
                display = base["options"][key]["label"]
            if key in survey_dist and key not in base["options"]:
                only_survey += 1
            if key not in survey_dist and key in base["options"]:
                only_base += 1
            diff = s_pct - b_pct
            entry = {
                "option": display,
                "survey_pct": round(float(s_pct), 2),
                "baseline_pct": round(float(b_pct), 2),
                "diff": round(float(diff), 2),
                "status": "both" if key in survey_dist and key in base["options"]
                          else ("survey_only" if key in survey_dist else "baseline_only"),
                "p": None, "p_text": "—", "stars": "",
            }
            if sq.type != "multi" and key in survey_dist and key in base["options"] and base_total > 0:
                p0 = min(max(b_pct / base_total, 1e-4), 1 - 1e-4)
                se = math.sqrt(p0 * (1 - p0) / max(n_survey, 1))
                z = (s_pct / 100 - p0) / se if se > 0 else 0.0
                p = float(2 * stats.norm.sf(abs(z)))
                entry["p"] = p
                entry["p_text"] = "p < 0.001" if p < 0.001 else f"p = {p:.3f}"
                entry["stars"] = "***" if p < 0.001 else "**" if p < 0.01 else "*" if p < 0.05 else "ns"
            rows.append(entry)
            if entry["status"] == "both":
                matched_keys.append(key)

        # 分布整体检验（卡方拟合优度）
        overall = {"test": None, "stat": None, "p": None, "p_text": "—", "valid": False, "warning": None}
        if sq.type != "multi" and base_total > 0 and matched_keys:
            base_props = np.array([base_dist[k] / base_total for k in matched_keys])
            survey_counts = np.array([survey_dist.get(k, 0.0) / 100 * n_survey for k in matched_keys])
            expected = base_props * survey_counts.sum()
            if expected.min() < 5:
                overall["warning"] = "部分选项期望频数小于 5，未执行整体卡方检验，可参考逐项 z 检验。"
            else:
                chi2, p = stats.chisquare(survey_counts, expected)
                overall.update({
                    "test": "卡方拟合优度检验", "stat": round(float(chi2), 3),
                    "dof": int(len(matched_keys) - 1), "p": float(p),
                    "p_text": "p < 0.001" if p < 0.001 else f"p = {p:.3f}",
                    "valid": True,
                })

        # 相似度
        if sq.type == "multi":
            sv = np.array([survey_dist.get(k, 0.0) for k in order], dtype=float)
            bv = np.array([base_dist.get(k, 0.0) for k in order], dtype=float)
            denom = np.linalg.norm(sv) * np.linalg.norm(bv)
            similarity = float(np.dot(sv, bv) / denom * 100) if denom else 0.0
            similarity_name = "余弦相似度"
        elif base_total > 0:
            total_variation = sum(abs(survey_dist.get(k, 0.0) - base_dist.get(k, 0.0)) for k in order)
            similarity = max(0.0, (1 - total_variation / (2 * max(base_total, 1e-9))) * 100)
            similarity_name = "分布重合度"
        else:
            similarity, similarity_name = 0.0, "分布重合度"

        if similarity >= 90:
            level = "高度一致"
        elif similarity >= 80:
            level = "基本一致"
        elif similarity >= 70:
            level = "存在差异"
        else:
            level = "差异明显"

        diffs = [r for r in rows if r["status"] == "both"]
        biggest = max(diffs, key=lambda r: abs(r["diff"])) if diffs else None
        significant = sorted(
            [r for r in diffs if r["p"] is not None and r["p"] < 0.05],
            key=lambda r: -abs(r["diff"]),
        )[:5]

        caveats = []
        if only_survey:
            caveats.append(f"有 {only_survey} 个问卷选项未在基准数据中匹配到，对比时按基准占比 0 处理。")
        if only_base:
            caveats.append(f"有 {only_base} 个基准选项在问卷中不存在，可能为口径或版本差异。")
        if base["multi_like"] and sq.type == "single":
            caveats.append("基准占比合计超过 100%，可能为多选口径，但问卷题为单选，结果仅供参考。")
        if sq.type == "multi":
            caveats.append("多选题各选项不相互独立，相似度采用余弦相似度，逐项显著性检验已略去。")
        caveats.extend(self.warnings[:3])

        return {
            "type": "compare",
            "survey_question": survey_question,
            "baseline_question": baseline_question,
            "question_type": sq.type,
            "question_type_label": sq.type_label,
            "n_survey": int(n_survey),
            "baseline_total": round(float(base_total), 2),
            "baseline_has_count": base["has_count"],
            "rows": rows,
            "overall": overall,
            "similarity": round(similarity, 1),
            "similarity_name": similarity_name,
            "similarity_level": level,
            "biggest": biggest,
            "significant": significant,
            "only_survey": int(only_survey),
            "only_base": int(only_base),
            "caveats": caveats,
            "method_note": method_note,
            "interpretation": (
                f"问卷（N={n_survey}）与大数据基准的{similarity_name}为 {similarity:.1f}%，整体{level}。"
                + (f" 差异最大的选项是「{biggest['option']}」（{biggest['diff']:+.1f} 个百分点）。" if biggest else "")
            ),
        }


def _float_key(key: str) -> float:
    try:
        return float(key)
    except (TypeError, ValueError):
        return 1e9


def _survey_distribution(q: Question) -> tuple[dict[str, float], int, str]:
    if q.type == "multi":
        rows = q.multi_tokens()
        n = len(rows)
        counter: dict[str, int] = {}
        for tokens in rows:
            for t in tokens:
                key = _norm_option(t)
                counter[key] = counter.get(key, 0) + 1
        dist = {k: v / max(n, 1) * 100 for k, v in counter.items()}
        return dist, n, "多选题按选择人数占比（应答率）计算"
    cats = q.categories()
    counts = cats.value_counts()
    n = int(counts.sum())
    dist = {_norm_option(k): v / max(n, 1) * 100 for k, v in counts.items()}
    return dist, n, "按有效回答的比例计算"


def _label_for(key: str, q: Question, base: dict) -> str:
    if key in base["options"]:
        return base["options"][key]["label"]
    if q.type == "scale":
        return _fmt_num(key) if _is_number(key) else key
    for opt in q.options:
        if _norm_option(opt) == key:
            return opt
    return key
