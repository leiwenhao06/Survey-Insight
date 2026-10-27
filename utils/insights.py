# -*- coding: utf-8 -*-
"""自动洞察：把统计结果翻译成可读结论。"""
from __future__ import annotations

from .baseline import BaselineDataset
from .statistics import correlation_analysis
from .survey import SurveyDataset


def build_insights(ds: SurveyDataset, baseline: BaselineDataset | None = None) -> dict:
    overview = ds.overview()
    items: list[dict] = list(overview["insights"])
    corr = correlation_analysis(ds)

    rel = corr.get("reliability") if isinstance(corr, dict) else None
    if rel and rel.get("available"):
        alpha = rel.get("alpha")
        if alpha is not None:
            level = "good" if alpha >= 0.7 else "warn" if alpha < 0.6 else "info"
            items.append({
                "level": level, "tag": "信度",
                "title": f"量表信度 Cronbach's α = {alpha:.2f}（{rel['alpha_level']}）",
                "text": rel["interpretation"],
            })
        weakest = [i for i in rel.get("items", []) if (i.get("alpha_if_deleted") or 0) > (alpha or 0) + 0.02]
        if weakest:
            name = weakest[0]["name"]
            items.append({
                "level": "info", "tag": "信度",
                "title": f"删除「{name}」可略微提升信度",
                "text": f"删除后 α 预计升至 {weakest[0]['alpha_if_deleted']:.3f}，"
                        "如该题与量表主题关联较弱，可考虑在后续问卷中调整表述。",
            })

    if corr.get("available"):
        top = next((p for p in corr.get("pairs", []) if p["abs"] >= 0.3 and p["p"] < 0.05), None)
        if top:
            direction = "正" if top["r"] > 0 else "负"
            items.append({
                "level": "info", "tag": "相关",
                "title": f"「{top['q1']}」与「{top['q2']}」呈中等以上{direction}相关",
                "text": f"Spearman ρ = {top['r']:.2f}（{top['p_text']}），"
                        f"两个指标可能受同一潜在因素影响。",
            })

    comparisons = []
    if baseline is not None:
        meta = baseline.match_meta(ds)
        for m in meta["matches"][:40]:
            if not m["suggested"]:
                continue
            try:
                cmp = baseline.compare(ds, m["baseline_question"], m["suggested"])
            except Exception:  # noqa: BLE001
                continue
            comparisons.append(cmp)
        if comparisons:
            best = max(comparisons, key=lambda c: c["similarity"])
            worst = min(comparisons, key=lambda c: c["similarity"])
            items.append({
                "level": "good" if best["similarity"] >= 80 else "info", "tag": "大数据",
                "title": f"与大数据最一致：「{best['baseline_question']}」（{best['similarity']:.0f}%）",
                "text": f"{best['similarity_name']} {best['similarity']:.1f}%，问卷样本与该题基准分布{best['similarity_level']}。",
            })
            if worst is not best:
                items.append({
                    "level": "warn" if worst["similarity"] < 70 else "info", "tag": "大数据",
                    "title": f"与大数据差异最大：「{worst['baseline_question']}」（{worst['similarity']:.0f}%）",
                    "text": worst["interpretation"],
                })
            # 逐题显著差异汇总
            sig_all = []
            for c in comparisons:
                for r in c.get("significant", []):
                    sig_all.append((c, r))
            sig_all.sort(key=lambda cr: -abs(cr[1]["diff"]))
            for c, r in sig_all[:2]:
                items.append({
                    "level": "warn", "tag": "大数据差异",
                    "title": f"{c['baseline_question']}「{r['option']}」偏离基准 {r['diff']:+.1f} 个百分点",
                    "text": f"问卷占比 {r['survey_pct']:.1f}%，基准占比 {r['baseline_pct']:.1f}%，"
                            f"{r['p_text']}，差异具有统计显著性。",
                })

    order = {"warn": 0, "good": 1, "info": 2}
    items = sorted(items, key=lambda x: order.get(x["level"], 3))
    counts = {lvl: sum(1 for i in items if i["level"] == lvl) for lvl in ("warn", "good", "info")}
    return {
        "insights": items,
        "counts": counts,
        "overview": overview,
        "comparisons": comparisons,
        "correlation_summary": corr.get("summary") if corr.get("available") else corr.get("message"),
        "reliability": rel,
    }
