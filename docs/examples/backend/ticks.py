import asyncio
import json
import random

INSTRUMENTS = 24
TICK_SECONDS = 0.4
TICK_ROWS = 4
RESET_EVERY = 25


def instrument(i: int, price: float) -> dict:
    return {"id": f"I{i:02d}", "name": f"Instrument {i:02d}", "price": round(price, 2), "ticks": 0}


def start() -> dict[str, dict]:
    rng = random.Random(7)
    return {f"I{i:02d}": instrument(i, 40 + rng.random() * 120) for i in range(INSTRUMENTS)}


def snapshot_rows() -> list[dict]:
    return list(start().values())


def move(rows: dict[str, dict], rng: random.Random) -> list[dict]:
    moved = []
    for key in rng.sample(sorted(rows), TICK_ROWS):
        row = rows[key]
        rows[key] = {**row, "price": round(max(1.0, row["price"] * (1 + rng.uniform(-0.01, 0.01))), 2), "ticks": row["ticks"] + 1}
        moved.append(rows[key])
    return moved


async def stream(websocket) -> None:
    await websocket.accept()
    rng = random.Random()
    rows = start()
    await websocket.send_text(json.dumps({"op": "snapshot", "rows": list(rows.values())}))
    tick = 0
    try:
        while True:
            await asyncio.sleep(TICK_SECONDS)
            tick += 1
            await websocket.send_text(json.dumps({"op": "upsert", "rows": move(rows, rng)}))
            if tick % RESET_EVERY == 0:
                gone = rng.choice(sorted(rows))
                rows[gone] = {**rows[gone], "price": round(40 + rng.random() * 120, 2), "ticks": 0}
                await websocket.send_text(json.dumps({"op": "upsert", "rows": [rows[gone]]}))
    except Exception:
        return
