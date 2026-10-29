import numpy as np
import plotly.graph_objects as go

from data import MONTHS, REGIONS

TEMPLATES = {"dark": "plotly_dark", "light": "plotly_white"}


def template(theme: str) -> str:
    return TEMPLATES.get(theme, "plotly")


def sales(theme: str) -> go.Figure:
    figure = go.Figure([go.Bar(name=region, x=MONTHS, y=values) for region, values in REGIONS.items()])
    return figure.update_layout(template=template(theme), title="Sales by region", barmode="stack", yaxis_title="Units")


def trend(theme: str) -> go.Figure:
    figure = go.Figure(
        [go.Scatter(name=region, x=MONTHS, y=values, mode="lines+markers") for region, values in REGIONS.items()]
    )
    return figure.update_layout(template=template(theme), title="Sales trend", yaxis_title="Units")


def signal(theme: str) -> go.Figure:
    t = np.linspace(0, 20, 80)
    samples = t[::4]
    figure = go.Figure(
        [
            go.Scatter(name="signal", x=t, y=np.sin(t), mode="lines"),
            go.Scatter(name="samples", x=samples, y=np.sin(samples) + 0.2 * np.cos(7 * samples), mode="markers"),
        ]
    )
    return figure.update_layout(template=template(theme), title="Signal and noise", xaxis_title="t", yaxis_title="value")


def correlation(theme: str) -> go.Figure:
    names = ["alpha", "beta", "gamma", "delta", "epsilon"]
    series = np.random.default_rng(7).normal(size=(5, 200)).cumsum(axis=1)
    figure = go.Figure(go.Heatmap(z=np.corrcoef(series), x=names, y=names, zmin=-1, zmax=1, colorscale="RdBu"))
    return figure.update_layout(template=template(theme), title="Correlation")


def query(rows: list[dict], theme: str) -> go.Figure:
    names = list(rows[0]) if rows else []
    figure = go.Figure([go.Bar(name=name, x=[r[names[0]] for r in rows], y=[r[name] for r in rows]) for name in names[1:]])
    return figure.update_layout(template=template(theme), title="Query result")


FIGURES = {"sales": sales, "trend": trend, "signal": signal, "correlation": correlation}
