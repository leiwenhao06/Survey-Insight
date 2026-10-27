# -*- coding: utf-8 -*-
"""导出带格式的 Excel 分析报告。"""
from __future__ import annotations

import io
import math
import re
from datetime import datetime

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from .baseline import BaselineDataset
from .statistics import correlation_analysis
from .survey import SurveyDataset

INK = "1F2933"
GREEN = "1B4332"
GREEN_SOFT = "D8E2DC"
PAPER = "F7F5F0"
WHITE = "FFFFFF"
AMBER = "B45309"
RED = "9B2C2C"

THIN = Side(style="thin", color="E4DED2")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def _excel_value(v):
    if v is None:
        return ""
    try:
        if pd.isna(v):
            return ""
    except (TypeError, ValueError):
        pass
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m-%d %H:%M")
    if hasattr(v, "item"):
        try:
            v = v.item()
        except Exception:  # noqa: BLE001
            return str(v)
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return ""
    return v


def _width(text: str) -> int:
    text = str(text)
    wide = len(re.findall(r"[一-鿿（）%，。：；、]", text))
    return min(48, max(8, len(text) + wide))


def _title(ws, row: int, text: str, span: int = 6):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    c = ws.cell(row=row, column=1, value=text)
    c.font = Font(name="微软雅黑", size=13, bold=True, color=GREEN)
    c.fill = PatternFill("solid", fgColor=PAPER)
    c.alignment = Alignment(vertical="center", indent=1)
    ws.row_dimensions[row].height = 28
    return row + 1


def _header(ws, row: int, headers: list[str]):
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=row, column=i, value=h)
        c.font = Font(name="微软雅黑", size=10, bold=True, color=WHITE)
        c.fill = PatternFill("solid", fgColor=GREEN)
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = BORDER
    ws.row_dimensions[row].height = 22
    return row + 1


def _row(ws, row: int, values: list, bold: bool = False, fill: str | None = None, num_cols: set[int] | None = None):
    for i, v in enumerate(values, start=1):
        c = ws.cell(row=row, column=i, value=v)
        c.font = Font(name="微软雅黑", size=10, bold=bold, color=INK)
        c.border = BORDER
        c.alignment = Alignment(vertical="center", wrap_text=i == 1)
        if fill:
            c.fill = PatternFill("solid", fgColor=fill)
        if num_cols and i in num_cols and isinstance(v, (int, float)):
            c.number_format = "0.00"
    return row + 1


def _auto_width(ws, widths: list[int]):
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def export_workbook(ds: SurveyDataset, baseline: BaselineDataset | None = None,
                    extra_compare: tuple[str, str] | None = None) -> bytes:
    wb = Workbook()
    overview = ds.overview()
    corr = correlation_analysis(ds)

    # ---------------------------------------------------------------- 概览
    ws = wb.active
    ws.title = "分析概览"
    ws.sheet_view.showGridLines = False
    ws.merge_cells("A1:F1")
    c = ws.cell(row=1, column=1, value="问卷数据分析报告")
    c.font = Font(name="微软雅黑", size=20, bold=True, color=GREEN)
    ws.row_dimensions[1].height = 40
    ws.merge_cells("A2:F2")
    c = ws.cell(row=2, column=1, value=f"{ds.name}　·　生成时间 {datetime.now():%Y-%m-%d %H:%M}")
    c.font = Font(name="微软雅黑", size=10, color="6B7280")

    r = 4
    r = _title(ws, r, "一、样本概况")
    kpi = overview["kpi"]
    r = _header(ws, r, ["指标", "数值", "说明"])
    rows = [
        ("有效答卷", kpi["rows"], "参与分析的数据行数"),
        ("分析题目", kpi["questions"], "单题、多选、量表、数值与文本题"),
        ("整体完成率", f"{kpi['completion']}%", "非缺失单元格占比"),
        ("重复答卷", kpi["duplicates"], "分析字段完全相同的记录"),
        ("直线作答", kpi["straight_liners"], "所有量表题选择同一分值"),
        ("数据质量分", kpi["quality_score"], "综合缺失、重复与作答模式，满分 100"),
    ]
    if overview.get("date_range"):
        dr = overview["date_range"]
        rows.append(("采集时间", f"{dr['start']} 至 {dr['end']}", f"覆盖 {dr['days']} 天"))
    for row in rows:
        r = _row(ws, r, list(row), num_cols={2})
    r += 1
    r = _title(ws, r, "二、题型构成")
    r = _header(ws, r, ["题型", "数量"])
    for item in overview["type_counts"]:
        r = _row(ws, r, [item["name"], item["value"]])
    r += 1
    r = _title(ws, r, "三、自动洞察")
    r = _header(ws, r, ["级别", "标签", "结论", "说明"])
    level_map = {"warn": "需关注", "good": "良好", "info": "提示"}
    for ins in overview["insights"]:
        r = _row(ws, r, [level_map.get(ins["level"], ins["level"]), ins["tag"], ins["title"], ins["text"]])
    _auto_width(ws, [16, 24, 54, 64, 10, 10])

    # ---------------------------------------------------------------- 题目说明
    ws2 = wb.create_sheet("题目说明")
    ws2.sheet_view.showGridLines = False
    r = _title(ws2, 1, "题目清单与数据质量", 7)
    r = _header(ws2, r, ["序号", "题目", "题型", "有效样本", "缺失率", "唯一值", "选项预览"])
    for i, q in enumerate(ds.analysis_questions, start=1):
        preview = "、".join(str(x) for x in q.options[:8]) if q.options else "—"
        r = _row(ws2, r, [i, q.name, q.type_label, q.n_valid, f"{q.meta['missing_rate']}%", q.unique, preview])
    _auto_width(ws2, [6, 30, 10, 10, 10, 8, 60])

    # ---------------------------------------------------------------- 频数
    ws3 = wb.create_sheet("频数统计")
    ws3.sheet_view.showGridLines = False
    r = _title(ws3, 1, "各题频数与描述统计", 6)
    for i, q in enumerate(ds.analysis_questions, start=1):
        freq = ds.frequency(q.name)
        r = _title(ws3, r, f"{i}. {q.name}　（{q.type_label}，有效样本 {freq['n_valid']}，缺失 {freq['missing']}）", 6)
        if freq["kind"] in ("categorical", "multi"):
            if freq["kind"] == "multi":
                r = _header(ws3, r, ["选项", "选择人数", "应答率(%)", "提及率(%)"])
                for it in freq["items"]:
                    r = _row(ws3, r, [it["label"], it["count"], it["pct"], it.get("pct_mentions")], num_cols={3, 4})
            else:
                r = _header(ws3, r, ["选项", "频数", "占比(%)", "累计占比(%)"])
                for it in freq["items"]:
                    r = _row(ws3, r, [it["label"], it["count"], it["pct"], it.get("cum_pct")], num_cols={3, 4})
        elif freq["kind"] == "scale":
            r = _header(ws3, r, ["分值", "频数", "占比(%)"])
            for it in freq["items"]:
                r = _row(ws3, r, [it["label"], it["count"], it["pct"]], num_cols={3})
            r += 1
            r = _header(ws3, r, ["统计量", "数值"])
            st = freq["stats"]
            for key, label in [("mean", "均值"), ("median", "中位数"), ("std", "标准差"), ("min", "最小值"),
                               ("max", "最大值"), ("top2_pct", "高分组占比(≥4)"), ("bottom2_pct", "低分组占比(≤2)")]:
                val = freq.get(key) if key in freq else st.get(key)
                r = _row(ws3, r, [label, val], num_cols={2})
        elif freq["kind"] == "numeric":
            st = freq["stats"]
            r = _header(ws3, r, ["统计量", "数值"])
            for key, label in [("n", "有效样本"), ("mean", "均值"), ("median", "中位数"), ("std", "标准差"),
                               ("min", "最小值"), ("q1", "下四分位"), ("q3", "上四分位"), ("max", "最大值"),
                               ("outliers", "异常值个数"), ("skew", "偏度")]:
                r = _row(ws3, r, [label, st.get(key)], num_cols={2})
            r += 1
            r = _header(ws3, r, ["区间", "频数", "占比(%)"])
            for it in freq["distribution"]:
                r = _row(ws3, r, [it["label"], it["count"], it["pct"]], num_cols={3})
        else:
            r = _header(ws3, r, ["高频回答", "次数"])
            for it in freq["top_answers"]:
                r = _row(ws3, r, [it["label"], it["count"]])
            if freq["words"]:
                r += 1
                r = _header(ws3, r, ["高频词", "次数"])
                for it in freq["words"][:15]:
                    r = _row(ws3, r, [it["label"], it["count"]])
        r += 2
    _auto_width(ws3, [34, 16, 16, 16, 16, 16])

    # ---------------------------------------------------------------- 相关
    ws4 = wb.create_sheet("相关与信度")
    ws4.sheet_view.showGridLines = False
    r = _title(ws4, 1, "相关矩阵与量表信度", 8)
    if corr.get("available"):
        names = corr["names"]
        r = _title(ws4, r, "Spearman 相关矩阵", len(names) + 1)
        r = _header(ws4, r, ["题目"] + names)
        for i, name in enumerate(names):
            row = [name]
            for v in corr["matrix"][i]:
                row.append(v if v is not None else "—")
            r = _row(ws4, r, row, num_cols=set(range(2, len(names) + 2)))
        r += 1
        r = _title(ws4, r, "显著相关对（|ρ| ≥ 0.3）", 6)
        r = _header(ws4, r, ["题目 A", "题目 B", "ρ", "p 值", "N", "强度"])
        for p in corr["pairs"]:
            if p["abs"] < 0.3:
                continue
            strength = "强" if p["abs"] >= 0.5 else "中等"
            r = _row(ws4, r, [p["q1"], p["q2"], p["r"], p["p_text"], p["n"], strength], num_cols={3})
        r += 1
        rel = corr.get("reliability")
        if rel and rel.get("available"):
            r = _title(ws4, r, f"Cronbach's α = {rel['alpha']}（{rel['alpha_level']}，N={rel['n']}，题目数={rel['k']}）", 6)
            r = _header(ws4, r, ["题目", "均值", "标准差", "校正后题总相关", "删除后 α"])
            for it in rel["items"]:
                r = _row(ws4, r, [it["name"], it["mean"], it["std"], it["item_total_r"], it["alpha_if_deleted"]], num_cols={2, 3, 4, 5})
        _auto_width(ws4, [34] + [14] * (len(corr["names"]) + 1))
    else:
        r = _row(ws4, r, [corr.get("message", "无可分析数据")])

    # ---------------------------------------------------------------- 大数据对比
    if baseline is not None:
        ws5 = wb.create_sheet("大数据对比")
        ws5.sheet_view.showGridLines = False
        r = _title(ws5, 1, "问卷样本与大数据统计基准对比", 7)
        meta = baseline.match_meta(ds)
        pairs = [(m["baseline_question"], m["suggested"]) for m in meta["matches"] if m["suggested"]]
        if extra_compare and extra_compare not in pairs:
            pairs.append(extra_compare)
        if not pairs:
            r = _row(ws5, r, ["未匹配到可对比的题目，请检查基准数据的题目名称。"])
        for bq, sq in pairs:
            try:
                cmp = baseline.compare(ds, bq, sq)
            except Exception:  # noqa: BLE001
                continue
            r = _title(ws5, r, f"{bq}　×　{sq}", 7)
            r = _row(ws5, r, ["问卷样本量", cmp["n_survey"], cmp["similarity_name"], f"{cmp['similarity']}%",
                              "整体判断", cmp["similarity_level"]], bold=True)
            r = _header(ws5, r, ["选项", "问卷占比(%)", "基准占比(%)", "差异(百分点)", "p 值", "备注"])
            for row in cmp["rows"]:
                note = {"survey_only": "仅问卷", "baseline_only": "仅基准"}.get(row["status"], "")
                r = _row(ws5, r, [row["option"], row["survey_pct"], row["baseline_pct"], row["diff"],
                                  row["p_text"], note], num_cols={2, 3, 4})
            if cmp["overall"].get("valid"):
                r = _row(ws5, r, ["整体分布检验", cmp["overall"]["test"], f"χ²={cmp['overall']['stat']}",
                                  cmp["overall"]["p_text"], "", ""], bold=True)
            r += 2
        ws5.column_dimensions["A"].width = 36
        for col in "BCDEFG":
            ws5.column_dimensions[col].width = 16

    # ---------------------------------------------------------------- 原始数据
    ws6 = wb.create_sheet("原始数据")
    ws6.sheet_view.showGridLines = False
    df = ds.df.copy()
    for j, col in enumerate(df.columns, start=1):
        c = ws6.cell(row=1, column=j, value=str(col))
        c.font = Font(name="微软雅黑", size=10, bold=True, color=WHITE)
        c.fill = PatternFill("solid", fgColor=GREEN)
        c.alignment = Alignment(horizontal="center")
    for i, (_, row) in enumerate(df.iterrows(), start=2):
        for j, v in enumerate(row, start=1):
            ws6.cell(row=i, column=j, value=_excel_value(v))
    for j, col in enumerate(df.columns, start=1):
        ws6.column_dimensions[get_column_letter(j)].width = _width(col)
    ws6.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
