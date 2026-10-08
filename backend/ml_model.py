"""Optional machine-learning flood probability. HONEST BY DESIGN: it only trains on real labelled history.

Training data = this system's own risk_history snapshots (features recorded at the time) labelled by what happened
next: a VERIFIED flood / flooded-road incident in the same zone within LABEL_WINDOW_H hours counts as positive. That
history only exists once the deployed system has run for a while, so until there are enough real labelled rows the model
is "not trained" and the probability shown is the uncalibrated prototype mapping from the risk score. Nothing is
synthesised to make the model look trained, and no accuracy figure is reported unless it was measured on held-out rows.
"""
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

MODEL_PATH = Path(__file__).parent / "models" / "flood_model.joblib"
FEATURES = ["rain_1h", "rain_3h", "rain_6h", "rain_24h", "forecast_3h", "forecast_6h", "elevation", "slope", "relative_elevation_pct",
            "susceptibility", "satellite_expansion_pct", "satellite_abnormal", "discharge_ratio", "historical_events", "rain_vs_p99"]
MIN_ROWS, MIN_POSITIVES, MIN_NEGATIVES = 300, 30, 30
LABEL_WINDOW_H = 6
_bundle = {"loaded": False, "data": None}


def _load():
    if _bundle["loaded"]:
        return _bundle["data"]
    _bundle["loaded"] = True
    try:
        import joblib
        if MODEL_PATH.exists():
            _bundle["data"] = joblib.load(MODEL_PATH)
    except Exception:
        _bundle["data"] = None
    return _bundle["data"]


def reset_cache():
    _bundle.update(loaded=False, data=None)


def _vector(features: dict, medians: dict) -> list:
    out = []
    for f in FEATURES:
        v = features.get(f)
        out.append(float(v) if v is not None and math.isfinite(float(v)) else medians.get(f, 0.0))
    return out


def predict(features: dict, score: float):
    """(probability, basis). Uses the trained model when one exists, otherwise the prototype mapping from the score."""
    bundle = _load()
    if bundle:
        try:
            p = float(bundle["model"].predict_proba([_vector(features, bundle["medians"])])[0][1])
            return round(p, 2), f"Trained model (Random Forest, {bundle['samples']} labelled samples; see /admin/ml/status for measured hold-out metrics)"
        except Exception:
            pass
    from flood_intel import probability_from_score
    return probability_from_score(score), "Prototype estimate from the risk score: uncalibrated, no trained model"


def training_rows(c) -> list:
    """Labelled rows from the system's own history (see the module docstring)."""
    now = datetime.now(timezone.utc)
    pos_times = {}
    for r in c.execute("SELECT zone, timestamp FROM incidents WHERE status='VERIFIED' AND duplicate_of IS NULL AND type IN ('FLOOD','FLOODED_ROAD')").fetchall():
        try:
            pos_times.setdefault(r["zone"], []).append(datetime.fromisoformat(r["timestamp"]).replace(tzinfo=timezone.utc))
        except Exception:
            pass
    rows = []
    for h in c.execute("SELECT * FROM risk_history WHERE features IS NOT NULL AND source IS NOT NULL AND source NOT LIKE '%SIMULATED%' ORDER BY id").fetchall():
        try:
            at = datetime.fromisoformat(h["at"]).replace(tzinfo=timezone.utc)
            feats = json.loads(h["features"] or "{}")
        except Exception:
            continue
        if not feats or now - at < timedelta(hours=LABEL_WINDOW_H):
            continue  # the outcome is not known yet
        label = int(any(at <= t <= at + timedelta(hours=LABEL_WINDOW_H) for t in pos_times.get(h["zone"], [])))
        rows.append((at, feats, label))
    return rows


def status(c) -> dict:
    rows = training_rows(c)
    pos = sum(r[2] for r in rows)
    bundle = _load()
    try:
        import sklearn  # noqa: F401
        sk = True
    except Exception:
        sk = False
    base = {"labelled_rows": len(rows), "positives": pos, "negatives": len(rows) - pos,
            "required": {"rows": MIN_ROWS, "positives": MIN_POSITIVES, "negatives": MIN_NEGATIVES}, "scikit_learn_installed": sk,
            "labels": f"verified flood incidents within {LABEL_WINDOW_H} h of a recorded risk snapshot (this system's own history)"}
    if bundle:
        return {**base, "status": "trained", "trained_at": bundle["trained_at"], "samples": bundle["samples"], "holdout_metrics": bundle["metrics"],
                "note": "Metrics were measured on held-out later rows of this system's own history only; they are not a general accuracy claim."}
    why = ("scikit-learn is not installed (pip install -r requirements-ml.txt)" if not sk else
           f"insufficient real labelled data ({len(rows)} rows, {pos} positives; need {MIN_ROWS} rows with at least {MIN_POSITIVES} of each class)")
    return {**base, "status": "not_trained", "reason": why, "note": "Using the prototype risk-score mapping; no accuracy is claimed."}


def train(c) -> dict:
    rows = training_rows(c)
    pos = sum(r[2] for r in rows)
    if len(rows) < MIN_ROWS or pos < MIN_POSITIVES or len(rows) - pos < MIN_NEGATIVES:
        return {"trained": False, **status(c)}
    try:
        import joblib
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.metrics import f1_score, precision_score, recall_score, roc_auc_score
    except Exception:
        return {"trained": False, **status(c)}
    rows.sort(key=lambda r: r[0])  # time order: validate on LATER data than we train on
    cut = int(len(rows) * 0.8)
    train_rows, test_rows = rows[:cut], rows[cut:]
    vals = {f: sorted(float(r[1][f]) for r in train_rows if r[1].get(f) is not None) for f in FEATURES}
    medians = {f: (v[len(v) // 2] if v else 0.0) for f, v in vals.items()}
    X = [_vector(r[1], medians) for r in train_rows]
    y = [r[2] for r in train_rows]
    if len(set(y)) < 2:
        return {"trained": False, **status(c), "reason": "training split has a single class"}
    model = RandomForestClassifier(n_estimators=200, max_depth=6, class_weight="balanced", random_state=7, n_jobs=1).fit(X, y)
    metrics = None
    yt = [r[2] for r in test_rows]
    if len(set(yt)) == 2:
        Xt = [_vector(r[1], medians) for r in test_rows]
        pred = model.predict(Xt)
        metrics = {"holdout_rows": len(test_rows), "precision": round(float(precision_score(yt, pred, zero_division=0)), 3),
                   "recall": round(float(recall_score(yt, pred, zero_division=0)), 3), "f1": round(float(f1_score(yt, pred, zero_division=0)), 3),
                   "roc_auc": round(float(roc_auc_score(yt, model.predict_proba(Xt)[:, 1])), 3)}
    if metrics is None:
        return {"trained": False, **status(c), "reason": "hold-out rows contain a single class, so the model cannot be validated; not saved"}
    MODEL_PATH.parent.mkdir(exist_ok=True)
    joblib.dump({"model": model, "medians": medians, "samples": len(train_rows), "metrics": metrics,
                 "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}, MODEL_PATH)
    reset_cache()
    return {"trained": True, **status(c)}
