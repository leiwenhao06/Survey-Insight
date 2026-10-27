# -*- coding: utf-8 -*-
"""问卷与大数据统计结果分析平台 —— Flask 入口。"""
from __future__ import annotations

import io
import os
import threading
import uuid
from collections import OrderedDict
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file

from utils.baseline import BaselineDataset
from utils.dataio import (DataError, jsonable, load_sample_baseline, load_sample_survey,
                          read_table)
from utils.insights import build_insights
from utils.report import export_workbook
from utils.statistics import crosstab, correlation_analysis, group_compare, group_options
from utils.survey import SurveyDataset

BASE_DIR = Path(__file__).resolve().parent
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024
app.json.ensure_ascii = False
app.json.sort_keys = False

MAX_DATASETS = 8
MAX_SURVEY_ROWS = 100_000
MAX_BASELINE_ROWS = 10_000


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


class Registry:
    """内存中的数据集仓库，带简单的 LRU 淘汰。"""

    def __init__(self, limit: int = MAX_DATASETS):
        self.limit = limit
        self.items: OrderedDict[str, tuple[str, object]] = OrderedDict()
        self.lock = threading.Lock()

    def add(self, kind: str, obj) -> str:
        dataset_id = uuid.uuid4().hex[:12]
        with self.lock:
            self.items[dataset_id] = (kind, obj)
            self.items.move_to_end(dataset_id)
            while len(self.items) > self.limit:
                self.items.popitem(last=False)
        return dataset_id

    def get(self, dataset_id: str, kind: str):
        with self.lock:
            entry = self.items.get(dataset_id)
            if entry is None:
                raise ApiError("数据集不存在或已过期，请重新上传。", 404)
            if entry[0] != kind:
                raise ApiError("数据类型不匹配，请检查请求参数。", 400)
            self.items.move_to_end(dataset_id)
            return entry[1]


REGISTRY = Registry()


def get_survey(dataset_id: str | None) -> SurveyDataset:
    if not dataset_id:
        raise ApiError("缺少 dataset_id 参数。", 400)
    return REGISTRY.get(dataset_id, "survey")


def get_baseline(baseline_id: str | None) -> BaselineDataset | None:
    if not baseline_id or baseline_id == "none":
        return None
    return REGISTRY.get(baseline_id, "baseline")


def ok(payload):
    return jsonify(jsonable(payload))


@app.errorhandler(ApiError)
def handle_api_error(exc: ApiError):
    return jsonify({"error": exc.message}), exc.status


@app.errorhandler(DataError)
def handle_data_error(exc: DataError):
    return jsonify({"error": str(exc)}), 400


@app.errorhandler(ValueError)
def handle_value_error(exc: ValueError):
    return jsonify({"error": str(exc)}), 400


@app.errorhandler(KeyError)
def handle_key_error(exc: KeyError):
    message = exc.args[0] if exc.args else "未找到指定内容"
    return jsonify({"error": str(message)}), 404


@app.errorhandler(413)
def handle_too_large(_exc):
    return jsonify({"error": "文件超过 32MB 限制，请压缩或拆分后再上传。"}), 413


@app.errorhandler(404)
def handle_not_found(_exc):
    if request.path.startswith("/api/"):
        return jsonify({"error": "接口不存在。"}), 404
    return render_template("index.html"), 404


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/health")
def health():
    return ok({"ok": True, "datasets": len(REGISTRY.items), "time": datetime.now().isoformat()})


# --------------------------------------------------------------------- 数据导入
@app.post("/api/upload")
def upload():
    kind = request.form.get("kind", "survey")
    file = request.files.get("file")
    if file is None or not file.filename:
        raise ApiError("请选择要上传的文件。")
    df = read_table(file.read(), file.filename)
    name = Path(file.filename).name

    if kind == "baseline":
        if len(df) > MAX_BASELINE_ROWS:
            raise ApiError(f"基准数据最多支持 {MAX_BASELINE_ROWS} 行。")
        baseline = BaselineDataset(df, name)
        dataset_id = REGISTRY.add("baseline", baseline)
        return ok({"kind": "baseline", "dataset_id": dataset_id, "summary": baseline.summary()})

    if len(df) > MAX_SURVEY_ROWS:
        raise ApiError(f"问卷明细最多支持 {MAX_SURVEY_ROWS} 行，请先抽样或聚合。")
    ds = SurveyDataset(df, name)
    if not ds.analysis_questions:
        raise ApiError("未识别到可分析的题目，请检查列名与数据内容。")
    dataset_id = REGISTRY.add("survey", ds)
    ds.dataset_id = dataset_id
    return ok({
        "kind": "survey",
        "dataset_id": dataset_id,
        "name": name,
        "rows": len(df),
        "columns": len(df.columns),
        "questions": ds.questions_meta(),
        "unrecognized": [q.meta for q in ds.questions if not q.is_analyzable],
    })


@app.post("/api/sample")
def sample():
    df, _ = load_sample_survey()
    ds = SurveyDataset(df, "城市青年数字生活质量调查（示例）")
    sid = REGISTRY.add("survey", ds)
    ds.dataset_id = sid
    result = {"survey_id": sid, "survey_name": ds.name, "rows": len(df), "questions": ds.questions_meta()}
    try:
        bdf, bname = load_sample_baseline()
        baseline = BaselineDataset(bdf, "全国数字生活大数据基准（示例）")
        bid = REGISTRY.add("baseline", baseline)
        result.update({"baseline_id": bid, "baseline_name": baseline.name,
                       "baseline_summary": baseline.summary()})
    except DataError:
        result["baseline_id"] = None
    return ok(result)


@app.post("/api/sample-baseline")
def sample_baseline():
    bdf, _ = load_sample_baseline()
    baseline = BaselineDataset(bdf, "全国数字生活大数据基准（示例）")
    bid = REGISTRY.add("baseline", baseline)
    return ok({"kind": "baseline", "dataset_id": bid, "summary": baseline.summary()})


@app.get("/api/overview")
def overview():
    ds = get_survey(request.args.get("dataset_id"))
    data = ds.overview()
    data["dataset"]["id"] = request.args.get("dataset_id")
    return ok(data)


@app.get("/api/questions")
def questions():
    ds = get_survey(request.args.get("dataset_id"))
    return ok({"questions": ds.questions_meta(), "dataset": {"name": ds.name, "rows": len(ds.df)}})


# --------------------------------------------------------------------- 单题分析
@app.get("/api/frequency")
def frequency():
    ds = get_survey(request.args.get("dataset_id"))
    question = request.args.get("question")
    if not question:
        raise ApiError("缺少 question 参数。")
    return ok(ds.frequency(question))


# --------------------------------------------------------------------- 交叉分析
@app.post("/api/crosstab")
def crosstab_api():
    body = request.get_json(silent=True) or {}
    ds = get_survey(body.get("dataset_id"))
    q1, q2 = body.get("q1"), body.get("q2")
    if not q1 or not q2:
        raise ApiError("请选择两个题目。")
    return ok(crosstab(ds, q1, q2))


@app.get("/api/group-options")
def group_options_api():
    ds = get_survey(request.args.get("dataset_id"))
    return ok(group_options(ds))


@app.post("/api/group-compare")
def group_compare_api():
    body = request.get_json(silent=True) or {}
    ds = get_survey(body.get("dataset_id"))
    group, target = body.get("group"), body.get("target")
    if not group or not target:
        raise ApiError("请选择分组题目与分析指标。")
    return ok(group_compare(ds, group, target))


# --------------------------------------------------------------------- 相关与信度
@app.get("/api/correlation")
def correlation_api():
    ds = get_survey(request.args.get("dataset_id"))
    return ok(correlation_analysis(ds))


# --------------------------------------------------------------------- 大数据对比
@app.get("/api/comparison/meta")
def comparison_meta():
    ds = get_survey(request.args.get("survey_id") or request.args.get("dataset_id"))
    baseline = get_baseline(request.args.get("baseline_id"))
    if baseline is None:
        raise ApiError("请先上传大数据统计结果（基准数据）。")
    return ok(baseline.match_meta(ds))


@app.post("/api/compare")
def compare_api():
    body = request.get_json(silent=True) or {}
    ds = get_survey(body.get("dataset_id"))
    baseline = get_baseline(body.get("baseline_id"))
    if baseline is None:
        raise ApiError("请先上传大数据统计结果（基准数据）。")
    bq, sq = body.get("baseline_question"), body.get("survey_question")
    if not bq or not sq:
        raise ApiError("请选择基准题目与对应的问卷题目。")
    return ok(baseline.compare(ds, bq, sq))


# --------------------------------------------------------------------- 洞察与导出
@app.get("/api/insights")
def insights_api():
    ds = get_survey(request.args.get("dataset_id"))
    baseline = get_baseline(request.args.get("baseline_id"))
    return ok(build_insights(ds, baseline))


@app.get("/api/export/excel")
def export_excel():
    ds = get_survey(request.args.get("dataset_id"))
    baseline = get_baseline(request.args.get("baseline_id"))
    extra = None
    bq, sq = request.args.get("bq"), request.args.get("sq")
    if bq and sq and baseline is not None:
        extra = (bq, sq)
    content = export_workbook(ds, baseline, extra)
    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    return send_file(
        io.BytesIO(content),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=f"问卷分析报告_{stamp}.xlsx",
    )


@app.get("/api/template/<kind>")
def download_template(kind: str):
    files = {
        "survey": (BASE_DIR / "data" / "sample_survey.csv", "问卷明细数据_格式示例.csv"),
        "baseline": (BASE_DIR / "data" / "sample_baseline.csv", "大数据基准数据_格式示例.csv"),
    }
    if kind not in files or not files[kind][0].exists():
        raise ApiError("模板文件不存在。", 404)
    path, name = files[kind]
    return send_file(path, mimetype="text/csv", as_attachment=True, download_name=name)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    print("=" * 58)
    print("  问卷洞察 · Survey Insight")
    print(f"  访问地址: http://127.0.0.1:{port}")
    print("=" * 58)
    app.run(host="127.0.0.1", port=port, debug=os.environ.get("FLASK_DEBUG") == "1")
