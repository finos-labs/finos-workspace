import { describe, it } from "node:test";
import { expect } from "expect";
import { BODY_MEMORY_FACTOR, bodyBudget, createBodyBudget } from "../../../../src/lib/body-budget.ts";

describe("createBodyBudget", () => {
  it("holds a multiple of the body for as long as the request lives", () => {
    const budget = createBodyBudget(1_000);
    const give = budget.reserve(100);
    expect(give).not.toBeNull();
    expect(budget.held).toBe(100 * BODY_MEMORY_FACTOR);
    give?.();
    expect(budget.held).toBe(0);
  });

  it("turns a request away when it does not fit beside the ones already held", () => {
    const budget = createBodyBudget(1_000);
    const first = budget.reserve(200);
    expect(first).not.toBeNull();
    expect(budget.reserve(200)).toBeNull();
    expect(budget.held).toBe(200 * BODY_MEMORY_FACTOR);
    first?.();
    expect(budget.reserve(200)).not.toBeNull();
  });

  it("lets small requests in around a big one", () => {
    const budget = createBodyBudget(1_000);
    budget.reserve(200);
    const small = budget.reserve(10);
    expect(small).not.toBeNull();
  });

  it("lets a request that is bigger than the whole budget run alone, never forever refused", () => {
    const budget = createBodyBudget(100);
    const alone = budget.reserve(1_000);
    expect(alone).not.toBeNull();
    expect(budget.reserve(1)).toBeNull();
    alone?.();
    expect(budget.reserve(1)).not.toBeNull();
  });

  it("gives back only once, however often the request says it is done", () => {
    const budget = createBodyBudget(1_000);
    const a = budget.reserve(100);
    const b = budget.reserve(50);
    a?.();
    a?.();
    expect(budget.held).toBe(50 * BODY_MEMORY_FACTOR);
    b?.();
    expect(budget.held).toBe(0);
  });

  it("counts a body that is not a number as nothing rather than as a negative", () => {
    const budget = createBodyBudget(1_000);
    expect(budget.reserve(-5)).not.toBeNull();
    expect(budget.held).toBe(0);
  });
});

describe("the process budget", () => {
  it("is half of what this process may hold on its heap", () => {
    expect(bodyBudget.capacity).toBeGreaterThan(0);
    expect(bodyBudget.held).toBe(0);
  });
});
