# -*- coding: utf-8 -*-
"""生成演示用的问卷明细数据与大数据基准数据。"""
import numpy as np
import pandas as pd
from pathlib import Path

rng = np.random.default_rng(20261027)
N = 280
out = Path(__file__).resolve().parent.parent / "data"
out.mkdir(parents=True, exist_ok=True)

def choices(labels, p):
    return rng.choice(labels, size=N, p=np.array(p) / np.sum(p))

# ---- 人口学变量 ----
gender = choices(["男", "女", "其他"], [48, 50, 2])
age = choices(["18-24岁", "25-34岁", "35-44岁", "45-54岁", "55岁以上"], [22, 38, 24, 12, 4])
edu = choices(["高中及以下", "大专", "本科", "硕士及以上"], [12, 22, 50, 16])
city = choices(["一线城市", "新一线城市", "二线城市", "三线及以下"], [30, 32, 23, 15])
job = choices(["企业职员", "公务员/事业单位", "自由职业", "学生", "其他"], [36, 14, 16, 18, 16])
income = choices(["5000元以下", "5000-10000元", "10000-20000元", "20000元以上"], [18, 32, 32, 18])
pay = choices(["愿意", "不愿意", "不确定"], [35, 30, 35])

age_num = pd.Series(age).map({"18-24岁": 21, "25-34岁": 30, "35-44岁": 39, "45-54岁": 49, "55岁以上": 61}).to_numpy()
phone = np.clip(rng.normal(340 - (age_num - 30) * 1.8, 85, N), 30, 900).round().astype(int)

# ---- 多选：常用 App 类型 ----
app_labels = ["社交", "短视频", "购物", "资讯", "游戏", "办公", "学习"]
app_p = [0.76, 0.69, 0.56, 0.41, 0.30, 0.35, 0.28]
app_matrix = rng.random((N, len(app_labels))) < np.array(app_p)
for i in range(N):
    if not app_matrix[i].any():
        app_matrix[i, rng.integers(0, len(app_labels))] = True
apps = ["、".join([lab for lab, on in zip(app_labels, row) if on]) for row in app_matrix]

# ---- 量表：潜变量 + 题目噪声 ----
latent = rng.normal(0, 1, N)
def likert(load, target_pcts, offset=0.0):
    """按目标分布切分潜变量，既保留题目间相关，又得到合理的 1-5 分布。"""
    raw = load * latent + rng.normal(offset, 1.0, N)
    cuts = np.quantile(raw, np.cumsum(target_pcts)[:-1])
    return np.digitize(raw, cuts) + 1

sat_conv = likert(0.9, [0.05, 0.09, 0.26, 0.36, 0.24], 0.55)
sat_info = likert(0.8, [0.06, 0.12, 0.29, 0.35, 0.18], 0.35)
sat_privacy = likert(0.5, [0.12, 0.20, 0.30, 0.25, 0.13], -0.15)
sat_social = likert(0.85, [0.07, 0.13, 0.28, 0.34, 0.18], 0.15)
ai_know = np.clip(likert(-0.35, [0.08, 0.17, 0.31, 0.28, 0.16], 0.1), 1, 5)
shop_week = np.clip(rng.poisson(1.6 + (pd.Series(income).map({"5000元以下": -0.5, "5000-10000元": 0.2, "10000-20000元": 0.6, "20000元以上": 1.0}).to_numpy()), N), 0, 10)

suggestions = [
    "希望平台减少广告推送", "隐私协议太长看不懂", "客服响应可以更快一些",
    "多关注老年人数字技能培训", "线上办事流程还能再简化", "希望推荐内容更精准",
    "信息真假难辨，需要加强审核", "会员价格偏高", "希望有更多线下服务网点",
    "APP 界面设计更简洁一些", "加强个人信息保护", "增加适老化功能",
]

df = pd.DataFrame({
    "问卷编号": [f"Q{i:04d}" for i in range(1, N + 1)],
    "提交时间": pd.to_datetime("2026-08-01") + pd.to_timedelta(rng.integers(0, 76 * 24 * 60, N), unit="m"),
    "性别": gender,
    "年龄段": age,
    "学历": edu,
    "所在城市": city,
    "职业类型": job,
    "月收入": income,
    "每日手机使用时长(分钟)": phone,
    "最常用App类型": apps,
    "数字生活满意度-便捷性": sat_conv,
    "数字生活满意度-信息质量": sat_info,
    "数字生活满意度-隐私安全": sat_privacy,
    "数字生活满意度-社交连接": sat_social,
    "是否愿意为数字服务付费": pay,
    "每周线上购物次数": shop_week,
    "对AI工具的了解程度": ai_know,
    "改进建议": [rng.choice(suggestions) if rng.random() > 0.55 else np.nan for _ in range(N)],
})

# 少量缺失值，模拟真实回收数据
for col, ratio in [("月收入", 0.025), ("数字生活满意度-社交连接", 0.033),
                   ("改进建议", 0), ("每周线上购物次数", 0.02), ("学历", 0.014)]:
    if ratio and col in df.columns:
        idx = rng.choice(N, int(N * ratio), replace=False)
        df.loc[idx, col] = np.nan

# 重复回收 6 份，用于质量检测
dup = df.sample(6, random_state=7).copy()
dup["问卷编号"] = [f"Q{N + i:04d}" for i in range(1, 7)]
dup["提交时间"] = dup["提交时间"] + pd.Timedelta(minutes=5)
df = pd.concat([df, dup], ignore_index=True)

# 直答式答卷 4 份（量表题全部同分）
straight_idx = rng.choice(len(df), 4, replace=False)
for col in [c for c in df.columns if c.startswith("数字生活满意度")]:
    df.loc[straight_idx, col] = 3

# 打乱顺序
df = df.sample(frac=1, random_state=11).reset_index(drop=True)
df["提交时间"] = df["提交时间"].dt.strftime("%Y-%m-%d %H:%M")
df.to_csv(out / "sample_survey.csv", index=False, encoding="utf-8-sig")

# ---- 大数据基准（聚合长表）----
def baseline_block(question, labels, percents):
    return [{"题目": question, "选项": lab, "比例(%)": round(p, 2)} for lab, p in zip(labels, percents)]

rows = []
rows += baseline_block("性别", ["男", "女", "其他"], [50.4, 47.9, 1.7])
rows += baseline_block("年龄段", ["18-24岁", "25-34岁", "35-44岁", "45-54岁", "55岁以上"], [18.5, 33.0, 26.5, 15.0, 7.0])
rows += baseline_block("所在城市", ["一线城市", "新一线城市", "二线城市", "三线及以下"], [24.0, 29.0, 25.0, 22.0])
rows += baseline_block("最常用App类型", ["社交", "短视频", "购物", "资讯", "游戏", "办公", "学习"],
                       [71.0, 74.0, 60.0, 36.0, 33.0, 41.0, 33.0])
rows += baseline_block("数字生活满意度-隐私安全", ["1", "2", "3", "4", "5"], [6.0, 12.0, 29.0, 35.0, 18.0])
rows += baseline_block("是否愿意为数字服务付费", ["愿意", "不愿意", "不确定"], [31.0, 34.0, 35.0])
rows += baseline_block("对AI工具的了解程度", ["1", "2", "3", "4", "5"], [7.0, 15.0, 32.0, 28.0, 18.0])
pd.DataFrame(rows).to_csv(out / "sample_baseline.csv", index=False, encoding="utf-8-sig")

print(f"survey rows={len(df)}, cols={len(df.columns)}")
print(f"baseline rows={len(rows)}, questions={pd.DataFrame(rows)['题目'].nunique()}")
