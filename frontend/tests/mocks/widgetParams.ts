/**
 * Widget parameter bar mock: widgets render without their parameter rows unless a test
 * unmocks the module (see tests/unit/components/WidgetParams/QueryParams.test.tsx).
 */
import { vi } from "vitest";

vi.mock("~/components/WidgetParams/QueryParams", () => ({
  useWidgetParamsPositions: () => ({
    renderRow0Params: null,
    renderBelowNavbarRows: null,
  }),
}));
