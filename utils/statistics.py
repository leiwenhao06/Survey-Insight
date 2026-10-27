# -*- coding: utf-8 -*-
"""交叉分析、相关分析、信度与分组比较。"""
from __future__ import annotations

import math
import re

import numpy as np
import pandas as pd
from scipy import stats

from .survey import Question, SurveyDataset, _fmt_num


def _p_text(p: float) -> str:
    if p is None or (isinstance(p, float) and math.isnan(p)):
        return "—"
    if p < 0.001:
        return "p < 0.001"
    return f"p = {p:.3f}"


def _stars(p: float) -> str:
    if p < 0.001:
        return "***"
    if p < 0.01:
        return "**"
    if p < 0.05:
        return "*"
    return "ns"


def _cramers_v(chi2: float, n: int, r: int, c: int) -> float:
    denom = n * max(min(r - 1, c - 1), 1)
    return math.sqrt(max(chi2, 0) / denom) if denom else 0.0


def _v_label(v: float) -> str:
    if v < 0.1:
        return "几乎无关联"
    if v < 0.3:
        return "弱关联"
    if v < 0.5:
        return "中等关联"
    return "强关联"


def _eta_label(e: float) -> str:
    if e < 0.01:
        return "几乎无差异"
    if e < 0.06:
        return "小效应"
    if e < 0.14:
        return "中等效应"
    return "大效应"


def _limit_categories(s: pd.Series, limit: int = 12) -> pd.Series:
    counts = s.value_counts()
    if len(counts) <= limit:
        return s
    keep = counts.index[: limit - 1]
    return s.where(s.isin(keep), "其他")


def _prep_categories(q: Question) -> pd.Series:
    s = q.categories()
    return _limit_categories(s)


def _ordinal_key(label) -> float | None:
    """识别「18-24岁」「5000元以下」等有序类别，按数值排序。"""
    s = str(label).strip()
    match = re.match(r"^(\d+(?:\.\d+)?)", s)
    if not match:
        return None
    value = float(match.group(1))
    if "以下" in s or "以内" in s:
        value -= 0.5
    if "以上" in s:
        value += 0.5
    return value


def _ordered_labels(series: pd.Series) -> list[str]:
    labels = [str(x) for x in series.drop_duplicates().tolist()]
    keys = [_ordinal_key(x) for x in labels]
    if labels and all(k is not None for k in keys) and len(set(keys)) == len(keys):
        return [x for _, x in sorted(zip(keys, labels))]
    return series.value_counts().index.tolist()


def crosstab(ds: SurveyDataset, q1_name: str, q2_name: str) -> dict:
    if q1_name == q2_name:
        raise ValueError("请选择两个不同的题目。")
    q1 = ds.get(q1_name)
    q2 = ds.get(q2_name)

    if q1.type == "single" and q2.type == "single":
        return _cross_categorical(q1, q2)
    if q1.is_continuous and q2.is_continuous:
        return _cross_numeric(q1, q2)
    if q1.is_categorical and q2.is_continuous:
        return _cross_group_numeric(q1, q2, ds)
    if q2.is_categorical and q1.is_continuous:
        return _cross_group_numeric(q2, q1, ds, swapped=True)
    if q1.is_categorical and q2.is_categorical:
        return _cross_categorical(q1, q2)
    raise ValueError("文本题和多选题暂不支持交叉分析，请选择单选题、量表题或数值题。")


def _cross_categorical(q1: Question, q2: Question) -> dict:
    df = pd.DataFrame({"a": _prep_categories(q1), "b": _prep_categories(q2)}).dropna()
    if len(df) < 10:
        raise ValueError("两题同时有效的样本不足 10 份，无法进行交叉分析。")
    if df["a"].nunique() < 2 or df["b"].nunique() < 2:
        raise ValueError("所选题目至少有一题只有单一取值，无法比较。")

    order_a = _ordered_labels(df["a"])
    order_b = _ordered_labels(df["b"])
    df["a"] = pd.Categorical(df["a"], categories=order_a, ordered=True)
    df["b"] = pd.Categorical(df["b"], categories=order_b, ordered=True)
    ct = pd.crosstab(df["a"], df["b"])
    observed = ct.to_numpy()
    n = int(observed.sum())
    row_pct = (ct.div(ct.sum(axis=1), axis=0) * 100).round(2)
    col_pct = (ct.div(ct.sum(axis=0), axis=1) * 100).round(2)

    chi2, p, dof, expected = stats.chi2_contingency(observed, correction=False)
    v = _cramers_v(chi2, n, observed.shape[0], observed.shape[1])
    min_expected = float(np.min(expected))
    warnings = []
    if min_expected < 5:
        counts = observed.flatten()
        small_share = counts[counts < 5].sum() / n
        warnings.append(f"最小期望频数为 {min_expected:.1f}（<5），"
                        f"约 {small_share * 100:.0f}% 的样本落在频数过低的单元格，卡方结果仅供参考。")

    # 依赖关系最强的单元格（观察值 / 期望值）
    ratio = observed / np.where(expected == 0, np.nan, expected)
    idx = np.unravel_index(np.nanargmax(ratio), ratio.shape)
    highlight = {
        "row": str(ct.index[idx[0]]), "col": str(ct.columns[idx[1]]),
        "count": int(observed[idx]), "expected": round(float(expected[idx]), 2),
        "ratio": round(float(ratio[idx]), 2),
    }

    return {
        "type": "categorical",
        "q1": q1.name, "q2": q2.name,
        "q1_type": q1.type_label, "q2_type": q2.type_label,
        "n": n,
        "rows": [str(x) for x in ct.index],
        "cols": [str(x) for x in ct.columns],
        "counts": observed.astype(int).tolist(),
        "row_pct": row_pct.to_numpy().tolist(),
        "col_pct": col_pct.to_numpy().tolist(),
        "row_totals": ct.sum(axis=1).astype(int).tolist(),
        "col_totals": ct.sum(axis=0).astype(int).tolist(),
        "chi2": round(float(chi2), 3),
        "dof": int(dof),
        "p": float(p),
        "p_text": _p_text(float(p)),
        "stars": _stars(float(p)),
        "cramers_v": round(float(v), 3),
        "association": _v_label(float(v)),
        "min_expected": round(min_expected, 2),
        "warnings": warnings,
        "highlight": highlight,
        "interpretation": (
            f"两题之间存在{_v_label(float(v))}（Cramér's V = {v:.3f}，{_p_text(float(p))}）。"
            + ("差异具有统计显著性。" if p < 0.05 else "差异未达到统计显著水平，不能排除随机波动。")
        ),
    }


def _cross_group_numeric(group_q: Question, num_q: Question, ds: SurveyDataset, swapped: bool = False) -> dict:
    groups = _prep_categories(group_q)
    nums = pd.to_numeric(num_q.series, errors="coerce")
    df = pd.DataFrame({"g": groups, "v": nums}).dropna()
    if len(df) < 10:
        raise ValueError("有效样本不足 10 份，无法比较。")
    order = df["g"].value_counts().index.tolist()
    stats_rows = []
    arrays = []
    for g in order:
        vals = df.loc[df["g"] == g, "v"]
        arrays.append(vals.to_numpy())
        stats_rows.append({
            "group": str(g), "n": int(len(vals)),
            "mean": round(float(vals.mean()), 2),
            "median": round(float(vals.median()), 2),
            "std": round(float(vals.std(ddof=1)), 2) if len(vals) > 1 else 0.0,
            "se": round(float(vals.std(ddof=1) / math.sqrt(len(vals))), 3) if len(vals) > 1 else 0.0,
        })
    if len(arrays) < 2:
        raise ValueError("分组变量只有一个有效类别，无法比较。")

    if len(arrays) == 2:
        t_stat, p = stats.ttest_ind(arrays[0], arrays[1], equal_var=False, nan_policy="omit")
        test_name = "Welch t 检验"
        test_stat = float(t_stat)
        dof = None
        dfree = None
    else:
        f_stat, p = stats.f_oneway(*arrays)
        test_name = "单因素方差分析 (ANOVA)"
        test_stat = float(f_stat)
        dfree = len(arrays) - 1
        dof = int(len(df) - len(arrays))

    grand = df["v"].mean()
    ss_between = sum(len(a) * (a.mean() - grand) ** 2 for a in arrays)
    ss_total = float(((df["v"] - grand) ** 2).sum())
    eta2 = float(ss_between / ss_total) if ss_total > 0 else 0.0

    stats_rows.sort(key=lambda r: -r["mean"])
    return {
        "type": "group",
        "q1": group_q.name if not swapped else num_q.name,
        "q2": num_q.name if not swapped else group_q.name,
        "group_question": group_q.name,
        "numeric_question": num_q.name,
        "n": int(len(df)),
        "groups": stats_rows,
        "test": {
            "name": test_name, "stat": round(test_stat, 3),
            "dof1": dfree, "dof2": dof,
            "p": float(p), "p_text": _p_text(float(p)), "stars": _stars(float(p)),
        },
        "eta_squared": round(eta2, 4),
        "effect": _eta_label(eta2),
        "interpretation": (
            f"按「{group_q.name}」分组后，「{num_q.name}」的组均值差异"
            + ("具有统计显著性" if p < 0.05 else "未达到统计显著")
            + f"（{test_name}，{_p_text(float(p))}，η² = {eta2:.3f}，{_eta_label(eta2)}）。"
        ),
    }


def _cross_numeric(q1: Question, q2: Question) -> dict:
    x = pd.to_numeric(q1.series, errors="coerce")
    y = pd.to_numeric(q2.series, errors="coerce")
    df = pd.DataFrame({"x": x, "y": y}).dropna()
    if len(df) < 10:
        raise ValueError("两题同时有效的样本不足 10 份。")
    if df["x"].nunique() < 2 or df["y"].nunique() < 2:
        raise ValueError("数值题需要至少两个不同取值才能计算相关。")
    pearson_r, pearson_p = stats.pearsonr(df["x"], df["y"])
    spearman_r, spearman_p = stats.spearmanr(df["x"], df["y"])
    slope, intercept = np.polyfit(df["x"], df["y"], 1)
    sample = df.sample(min(350, len(df)), random_state=42) if len(df) > 350 else df
    return {
        "type": "numeric",
        "q1": q1.name, "q2": q2.name,
        "n": int(len(df)),
        "pearson_r": round(float(pearson_r), 3),
        "pearson_p": float(pearson_p),
        "spearman_r": round(float(spearman_r), 3),
        "spearman_p": float(spearman_p),
        "stars": _stars(float(pearson_p)),
        "p_text": _p_text(float(pearson_p)),
        "slope": round(float(slope), 4),
        "intercept": round(float(intercept), 3),
        "scatter": {
            "x": [round(float(v), 3) for v in sample["x"]],
            "y": [round(float(v), 3) for v in sample["y"]],
        },
        "interpretation": (
            f"Pearson r = {pearson_r:.3f}（{_p_text(float(pearson_p))}），"
            f"Spearman ρ = {spearman_r:.3f}，"
            + ("存在显著线性相关。" if pearson_p < 0.05 else "未发现显著线性相关。")
        ),
    }


def correlation_analysis(ds: SurveyDataset) -> dict:
    items = [q for q in ds.analysis_questions if q.is_continuous and q.n_valid >= 20]
    if len(items) < 2:
        return {
            "available": False,
            "message": "数值题 / 量表题不足 2 道，无法计算相关矩阵。",
            "reliability": None,
            "pairs": [],
        }

    data = pd.DataFrame({q.name: pd.to_numeric(q.series, errors="coerce") for q in items})
    names = list(data.columns)
    k = len(names)
    rho = np.full((k, k), np.nan)
    pmat = np.full((k, k), np.nan)
    ns = np.zeros((k, k), dtype=int)
    pairs = []
    for i in range(k):
        for j in range(i, k):
            if i == j:
                rho[i, j] = 1.0
                pmat[i, j] = 0.0
                ns[i, j] = int(data.iloc[:, i].notna().sum())
                continue
            sub = data.iloc[:, [i, j]].dropna()
            ns[i, j] = ns[j, i] = int(len(sub))
            if len(sub) < 10 or sub.iloc[:, 0].nunique() < 2 or sub.iloc[:, 1].nunique() < 2:
                continue
            r, p = stats.spearmanr(sub.iloc[:, 0], sub.iloc[:, 1])
            rho[i, j] = rho[j, i] = r
            pmat[i, j] = pmat[j, i] = p
            if i < j and not math.isnan(r):
                pairs.append({
                    "q1": names[i], "q2": names[j], "r": round(float(r), 3),
                    "p": float(p), "p_text": _p_text(float(p)), "stars": _stars(float(p)),
                    "n": int(len(sub)), "abs": abs(float(r)),
                })

    pairs.sort(key=lambda x: -x["abs"])
    strong = [p for p in pairs if p["abs"] >= 0.5 and p["p"] < 0.05]
    moderate = [p for p in pairs if 0.3 <= p["abs"] < 0.5 and p["p"] < 0.05]

    scale_items = [q for q in ds.analysis_questions if q.type == "scale"]
    reliability = _reliability(scale_items)

    return {
        "available": True,
        "names": names,
        "types": [ds.qmap[n].type_label for n in names],
        "matrix": [[None if math.isnan(v) else round(float(v), 3) for v in row] for row in rho],
        "p_matrix": [[None if math.isnan(v) else float(v) for v in row] for row in pmat],
        "n_matrix": ns.tolist(),
        "pairs": pairs[:30],
        "strong_count": len(strong),
        "moderate_count": len(moderate),
        "summary": (
            f"共 {k} 道数值/量表题，发现 {len(strong)} 对强相关（|ρ|≥0.5）、"
            f"{len(moderate)} 对中等相关（0.3≤|ρ|<0.5）。"
        ),
        "method": "Spearman 秩相关（成对完整数据）",
        "reliability": reliability,
    }


def _reliability(items: list[Question]) -> dict | None:
    if len(items) < 2:
        return None
    buckets: dict[str, list[Question]] = {}
    for q in items:
        key = re.split(r"[-_—·:：]", q.name)[0].strip() or q.name
        buckets.setdefault(key, []).append(q)
    blocks = []
    for label, qs in buckets.items():
        if len(qs) < 2:
            continue
        block = _alpha_block(qs, label)
        if block:
            blocks.append(block)
    if not blocks:
        block = _alpha_block(items, "全部量表题")
        if block:
            blocks = [block]
    if not blocks:
        return {"available": False, "message": "量表题同时有效的样本不足或缺少数值，无法估计信度。"}
    primary = max(blocks, key=lambda b: (b["k"], b["n"]))
    out = dict(primary)
    out["available"] = True
    out["blocks"] = blocks
    out["note"] = "按题目名称前缀自动分组计算 Cronbach's α；跨构念的量表题不应强行合并。"
    return out


def _alpha_block(items: list[Question], label: str) -> dict | None:
    data = pd.DataFrame({q.name: pd.to_numeric(q.series, errors="coerce") for q in items}).dropna()
    if len(data) < 10 or data.shape[1] < 2:
        return None
    k = data.shape[1]
    item_vars = data.var(axis=0, ddof=1)
    total = data.sum(axis=1)
    total_var = total.var(ddof=1)
    alpha = None
    if total_var > 0:
        alpha = k / (k - 1) * (1 - item_vars.sum() / total_var)
    item_rows = []
    for col in data.columns:
        rest = data.drop(columns=[col]).sum(axis=1)
        try:
            item_total = float(np.corrcoef(data[col], rest)[0, 1])
        except Exception:  # noqa: BLE001
            item_total = float("nan")
        deleted = None
        if k > 2:
            var_rest = data.drop(columns=[col]).sum(axis=1).var(ddof=1)
            var_items = item_vars.drop(col).sum()
            if var_rest > 0:
                deleted = (k - 1) / (k - 2) * (1 - var_items / var_rest)
        item_rows.append({
            "name": col,
            "mean": round(float(data[col].mean()), 2),
            "std": round(float(data[col].std(ddof=1)), 2),
            "item_total_r": None if math.isnan(item_total) else round(item_total, 3),
            "alpha_if_deleted": None if deleted is None else round(float(deleted), 3),
        })
    if alpha is None or math.isnan(alpha):
        level, text = "无法计算", "量表题总方差为 0，请检查作答是否存在直线填写。"
        alpha_value = None
    else:
        alpha_value = round(float(alpha), 3)
        if alpha >= 0.9:
            level, text = "优秀", "内部一致性非常高，量表结果可靠；也需留意题目是否存在重复表述。"
        elif alpha >= 0.8:
            level, text = "良好", "内部一致性良好，适合用于综合评分与进一步建模。"
        elif alpha >= 0.7:
            level, text = "可接受", "内部一致性处于可接受范围，个别题目可考虑优化。"
        elif alpha >= 0.6:
            level, text = "偏低", "信度偏低，建议检查题目表述或删减区分度不足的题目。"
        else:
            level, text = "不足", "内部一致性不足，不建议直接合成为量表总分。"
    return {
        "label": label,
        "alpha": alpha_value,
        "alpha_level": level,
        "items": item_rows,
        "n": int(len(data)),
        "k": k,
        "interpretation": (
            f"「{label}」Cronbach's α = {alpha_value:.3f}（{level}）。{text}"
            if alpha_value is not None else f"「{label}」{text}"
        ),
    }


def group_options(ds: SurveyDataset) -> dict:
    groups = []
    for q in ds.analysis_questions:
        if q.is_categorical and 2 <= q.unique <= 12:
            groups.append({"name": q.name, "type": q.type_label, "categories": q.unique,
                           "options": q.options})
    targets = []
    for q in ds.analysis_questions:
        if q.is_continuous and q.n_valid >= 10:
            targets.append({"name": q.name, "type": q.type_label,
                            "mean": round(float(q.numeric_values().mean()), 2)})
    return {"groups": groups, "targets": targets}


def group_compare(ds: SurveyDataset, group_name: str, target_name: str) -> dict:
    """按分类题分组比较数值题均值（Welch t / ANOVA）。"""
    group_q = ds.get(group_name)
    target_q = ds.get(target_name)
    if not group_q.is_categorical:
        raise ValueError("分组变量必须是单选题或量表题。")
    if not target_q.is_continuous:
        raise ValueError("分析指标必须是数值题或量表题。")
    return _cross_group_numeric(group_q, target_q, ds)
