import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useMentions } from "~/components/AI/hooks/useMentions";
import type { Mention } from "~/lib/state/copilot";
import { useMentionsStore } from "~/lib/state/mentions";

const widget = (id: string, name: string): Mention =>
  ({ id, name, trigger: "@", group: "all" }) as Mention;

afterEach(() => {
  act(() => useMentionsStore.getState().setOptionsMap(new Map()));
});

describe("useMentions reactivity to optionsMap", () => {
  it("re-resolves @[id:...] once optionsMap loads after reload", () => {
    const { result } = renderHook(() => useMentions());

    expect(result.current.processMentions("@[id:w1]").result).toBe("@[id:w1]");
    const before = result.current.processMentions;

    act(() => {
      useMentionsStore
        .getState()
        .setOptionsMap(new Map([["w1", widget("w1", "MyWidget")]]));
    });

    expect(result.current.processMentions).not.toBe(before);
    expect(result.current.processMentions("@[id:w1]").result).toBe("@MyWidget");
  });
});

describe("useMentions restoreMentions with regex-special names", () => {
  it("restores a mention whose name contains parentheses", () => {
    const { result } = renderHook(() => useMentions());
    const mention = widget("w1", "Discount Curve (1M Delayed)");

    const rendered = "show @Discount Curve (1M Delayed) please";
    const raw = result.current.restoreMentions(rendered, [mention]);

    expect(raw).toBe("show @[id:w1] please");
  });
});
