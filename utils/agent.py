# -*- coding: utf-8 -*-
"""LLM Agent 可调用的本地分析工具。

模型通过 OpenAI 兼容的 function calling 按需读取题目分布、交叉分析、相关与信度、
分组比较、大数据基准对比等结果。所有计算都在本地完成，返回给模型的仍是聚合结果。
"""
from __future__ import annotations

from .baseline import BaselineDataset
from .statistics import correlation_analysis, crosstab, group_compare
from .survey import SurveyDataset

MAX_TOOL_RESULT_CHARS = 6000

TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "list_questions",
            "description": "列出当前问卷的全部可分析题目，包括题目名称、题型、有效样本量和主要选项。需要确认题目名称时调用。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_frequency",
            "description": "获取指定题目的频数分布或描述统计。单选题返回选项占比，多选题返回应答率，量表/数值题返回均值等统计量。",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "题目名称，必须与题目清单完全一致"},
                },
                "required": ["question"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_crosstab",
            "description": "对两道题做交叉分析：分类×分类返回列联表、卡方检验与 Cramér's V；分类×数值返回分组均值与 t 检验/ANOVA。",
            "parameters": {
                "type": "object",
                "properties": {
                    "q1": {"type": "string", "description": "第一道题（分组变量或行变量）"},
                    "q2": {"type": "string", "description": "第二道题（分析变量或列变量）"},
                },
                "required": ["q1", "q2"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "group_compare",
            "description": "按一道分类题分组，比较另一道数值题或量表题的组均值（Welch t 检验或单因素 ANOVA）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "group": {"type": "string", "description": "分组题目（单选题或量表题）"},
                    "target": {"type": "string", "description": "要比较的数值题或量表题"},
                },
                "required": ["group", "target"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_correlation",
            "description": "获取当前数据的 Spearman 相关对与 Cronbach's α 信度摘要。需要更细的相关结果时调用。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_baseline",
            "description": "将问卷题目与已上传的大数据基准题目对比，返回分布重合度/余弦相似度、整体检验与显著偏差。",
            "parameters": {
                "type": "object",
                "properties": {
                    "survey_question": {"type": "string", "description": "问卷题目名称；留空则自动匹配"},
                    "baseline_question": {"type": "string", "description": "基准题目名称；留空则自动匹配"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_data_quality",
            "description": "返回样本量、完成率、缺失、重复答卷、直线作答、低完成题目与数据质量分。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def _str_arg(args: dict, key: str) -> str:
    value = args.get(key) if isinstance(args, dict) else None
    return str(value).strip()[:120] if value is not None else ""


def _round(value, digits: int = 2):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return value
    return round(number, digits)


def _compact_frequency(ds: SurveyDataset, args: dict) -> dict:
    name = _str_arg(args, "question")
    if not name:
        return {"error": "缺少 question 参数。"}
    data = ds.frequency(name)
    kind = data.get("kind")
    out = {
        "question": name,
        "type": data["question"]["type_label"],
        "n_valid": data.get("n_valid"),
        "missing": data.get("missing"),
        "kind": kind,
    }
    if kind in ("categorical", "multi"):
        out["items"] = [
            {
                "label": item.get("label"),
                "count": item.get("count"),
                "pct": item.get("pct"),
                **({"pct_mentions": item.get("pct_mentions")} if kind == "multi" else {}),
            }
            for item in (data.get("items") or [])[:12]
        ]
        out["top_option"] = data.get("top_option")
        out["top_share"] = data.get("top_share")
        if kind == "multi":
            out["n_respondents"] = data.get("n_respondents")
            out["avg_selected"] = data.get("avg_selected")
    elif kind in ("scale", "numeric"):
        out["stats"] = data.get("stats")
        if kind == "scale":
            out["top2_pct"] = data.get("top2_pct")
            out["bottom2_pct"] = data.get("bottom2_pct")
            out["neutral_pct"] = data.get("neutral_pct")
            out["items"] = [
                {"label": item.get("label"), "count": item.get("count"), "pct": item.get("pct")}
                for item in (data.get("items") or [])[:10]
            ]
        else:
            out["distribution"] = [
                {"label": item.get("label"), "count": item.get("count"), "pct": item.get("pct")}
                for item in (data.get("distribution") or [])[:8]
            ]
    else:
        out.update({
            "n_answers": data.get("n_answers"),
            "unique_answers": data.get("unique_answers"),
            "avg_length": data.get("avg_length"),
            "words": [{"word": item.get("label"), "count": item.get("count")}
                      for item in (data.get("words") or [])[:15]],
        })
    return out


def _compact_crosstab(data: dict) -> dict:
    out = {
        "type": data.get("type"),
        "q1": data.get("q1"),
        "q2": data.get("q2"),
        "n": data.get("n"),
        "interpretation": data.get("interpretation"),
    }
    if data.get("type") == "categorical":
        out.update({
            "rows": data.get("rows"),
            "cols": data.get("cols"),
            "counts": data.get("counts"),
            "row_pct": data.get("row_pct"),
            "chi2": data.get("chi2"),
            "dof": data.get("dof"),
            "p": data.get("p"),
            "p_text": data.get("p_text"),
            "stars": data.get("stars"),
            "cramers_v": data.get("cramers_v"),
            "association": data.get("association"),
            "highlight": data.get("highlight"),
            "warnings": data.get("warnings"),
        })
    elif data.get("type") == "group":
        out.update({
            "group_question": data.get("group_question"),
            "numeric_question": data.get("numeric_question"),
            "groups": data.get("groups"),
            "test": data.get("test"),
            "eta_squared": data.get("eta_squared"),
            "effect": data.get("effect"),
        })
    else:
        out.update({
            "pearson_r": data.get("pearson_r"),
            "pearson_p": data.get("pearson_p"),
            "spearman_r": data.get("spearman_r"),
            "spearman_p": data.get("spearman_p"),
            "p_text": data.get("p_text"),
            "stars": data.get("stars"),
            "slope": data.get("slope"),
            "intercept": data.get("intercept"),
        })
    return out


def _compact_correlation(ds: SurveyDataset) -> dict:
    data = correlation_analysis(ds)
    if not data.get("available"):
        return {"available": False, "message": data.get("message")}
    out = {
        "available": True,
        "summary": data.get("summary"),
        "method": data.get("method"),
        "names": data.get("names"),
        "pairs": [
            {
                "q1": pair.get("q1"), "q2": pair.get("q2"), "r": pair.get("r"),
                "p": pair.get("p"), "p_text": pair.get("p_text"),
                "n": pair.get("n"), "stars": pair.get("stars"),
            }
            for pair in (data.get("pairs") or [])[:18]
        ],
        "strong_count": data.get("strong_count"),
        "moderate_count": data.get("moderate_count"),
    }
    rel = data.get("reliability")
    if rel and rel.get("available"):
        out["reliability"] = {
            "note": rel.get("note"),
            "blocks": [
                {
                    "label": block.get("label"),
                    "alpha": block.get("alpha"),
                    "alpha_level": block.get("alpha_level"),
                    "k": block.get("k"),
                    "n": block.get("n"),
                    "weak_items": [
                        item.get("name") for item in block.get("items") or []
                        if item.get("alpha_if_deleted") is not None
                        and block.get("alpha") is not None
                        and item["alpha_if_deleted"] > block["alpha"] + 0.02
                    ],
                }
                for block in rel.get("blocks") or [rel]
            ],
        }
    return out


def _compact_compare(cmp: dict) -> dict:
    return {
        "survey_question": cmp.get("survey_question"),
        "baseline_question": cmp.get("baseline_question"),
        "n_survey": cmp.get("n_survey"),
        "similarity": cmp.get("similarity"),
        "similarity_name": cmp.get("similarity_name"),
        "similarity_level": cmp.get("similarity_level"),
        "overall": cmp.get("overall"),
        "biggest": cmp.get("biggest"),
        "significant": cmp.get("significant"),
        "caveats": cmp.get("caveats"),
        "interpretation": cmp.get("interpretation"),
    }


def _compact_baseline(ds: SurveyDataset, baseline: BaselineDataset | None, args: dict) -> dict:
    if baseline is None:
        return {"error": "当前没有接入大数据基准数据。"}
    bq, sq = _str_arg(args, "baseline_question"), _str_arg(args, "survey_question")
    if bq and sq:
        return _compact_compare(baseline.compare(ds, bq, sq))
    if bq or sq:
        meta = baseline.match_meta(ds)
        match = next((m for m in meta.get("matches") or []
                      if (bq and m.get("baseline_question") == bq) or (sq and m.get("suggested") == sq)), None)
        if not match or not match.get("suggested"):
            return {"error": "未能匹配到基准题目，请先用 list_questions 查看问卷题目。"}
        return _compact_compare(baseline.compare(ds, match["baseline_question"], match["suggested"]))
    meta = baseline.match_meta(ds)
    out = []
    for match in meta.get("matches") or []:
        if not match.get("suggested"):
            continue
        try:
            out.append(_compact_compare(baseline.compare(ds, match["baseline_question"], match["suggested"])))
        except Exception:  # noqa: BLE001
            continue
        if len(out) >= 6:
            break
    return {"baseline": meta.get("baseline"), "comparisons": out}


def _compact_quality(ds: SurveyDataset) -> dict:
    overview = ds.overview()
    kpi = overview.get("kpi") or {}
    return {
        "dataset": overview.get("dataset"),
        "kpi": kpi,
        "date_range": overview.get("date_range"),
        "low_completion": [
            {"name": item.get("name"), "completion": item.get("completion")}
            for item in overview.get("completion_by_question") or [] if item.get("completion", 100) < 90
        ][:8],
        "warnings": [
            {"title": item.get("title"), "text": item.get("text")}
            for item in overview.get("insights") or [] if item.get("level") == "warn"
        ],
    }


def run_tool(ds: SurveyDataset, baseline: BaselineDataset | None, name: str, args: dict) -> dict:
    """执行模型请求的工具，返回 JSON 可序列化的结果。"""
    args = args if isinstance(args, dict) else {}
    try:
        if name == "list_questions":
            return {
                "count": len(ds.analysis_questions),
                "questions": [
                    {
                        "name": q.name,
                        "type": q.type_label,
                        "n_valid": q.n_valid,
                        "unique": q.unique,
                        "options": (q.options or [])[:12],
                    }
                    for q in ds.analysis_questions
                ],
            }
        if name == "get_frequency":
            return _compact_frequency(ds, args)
        if name == "get_crosstab":
            q1, q2 = _str_arg(args, "q1"), _str_arg(args, "q2")
            if not q1 or not q2:
                return {"error": "需要 q1 与 q2 两个题目名称。"}
            return _compact_crosstab(crosstab(ds, q1, q2))
        if name == "group_compare":
            group, target = _str_arg(args, "group"), _str_arg(args, "target")
            if not group or not target:
                return {"error": "需要 group 与 target 两个题目名称。"}
            return _compact_crosstab(group_compare(ds, group, target))
        if name == "get_correlation":
            return _compact_correlation(ds)
        if name == "compare_baseline":
            return _compact_baseline(ds, baseline, args)
        if name == "get_data_quality":
            return _compact_quality(ds)
        return {"error": f"未知工具：{name}"}
    except (KeyError, ValueError) as exc:
        return {"error": str(exc).strip("'\"")}
    except Exception as exc:  # noqa: BLE001
        return {"error": f"工具执行失败：{type(exc).__name__}: {exc}"[:300]}


def tool_label(name: str, args: dict) -> str:
    args = args if isinstance(args, dict) else {}
    if name == "get_frequency":
        return f"读取「{_str_arg(args, 'question') or '题目'}」的分布"
    if name == "get_crosstab":
        return f"交叉分析「{_str_arg(args, 'q1') or '题目 A'} × {_str_arg(args, 'q2') or '题目 B'}」"
    if name == "group_compare":
        return f"分组比较「{_str_arg(args, 'group') or '分组'} → {_str_arg(args, 'target') or '指标'}」"
    if name == "get_correlation":
        return "读取相关矩阵与量表信度"
    if name == "compare_baseline":
        return "对比大数据基准"
    if name == "get_data_quality":
        return "检查数据质量"
    if name == "list_questions":
        return "查看题目清单"
    return f"调用工具 {name}"


def tool_event(name: str, args: dict, result: dict) -> dict:
    error = result.get("error") if isinstance(result, dict) else None
    text = str(result)
    if len(text) > MAX_TOOL_RESULT_CHARS:
        text = text[:MAX_TOOL_RESULT_CHARS]
    return {
        "name": name,
        "label": tool_label(name, args),
        "ok": not error,
        "detail": str(error)[:200] if error else "",
        "result_chars": len(text),
    }
