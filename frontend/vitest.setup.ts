import "fake-indexeddb/auto";
import "vitest-canvas-mock";
import { afterEach, vi } from "vitest";
import "@testing-library/jest-dom";

import "./tests/mocks/jsdom-polyfills";
import "./tests/mocks/constants";
import "./tests/mocks/runtimeConfig";
import "./tests/mocks/components";
import "./tests/mocks/widgetParams";
import "./tests/mocks/api-client";

vi.mock("*.css", () => ({}));

afterEach(async () => {
  await vi.dynamicImportSettled()
})
