import { afterEach, describe, expect, it, vi } from "vitest";
import { REFRESH_WIDGET_INTERVAL } from "~/lib/constants";
import { jitteredRefreshInterval, REFRESH_JITTER } from "~/lib/utils/refreshInterval";

describe("the default refresh interval of a widget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("varies by a tenth either way, so that widgets that loaded together do not refresh together", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(jitteredRefreshInterval()).toBe(
      REFRESH_WIDGET_INTERVAL * (1 - REFRESH_JITTER),
    );
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    expect(jitteredRefreshInterval()).toBeCloseTo(
      REFRESH_WIDGET_INTERVAL * (1 + REFRESH_JITTER),
      -2,
    );
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(jitteredRefreshInterval()).toBe(REFRESH_WIDGET_INTERVAL);
  });
});
