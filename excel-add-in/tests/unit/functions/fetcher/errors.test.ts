import ExcelError, { CFError, handleErrors } from "~/functions/fetcher/errors";


test("handleErrors.objectLen1", () => {
  const errorResponse = {
    detail: [
      {
        type: "missing",
        loc: ["query", "query"],
        msg: "Field required",
        input: null,
        url: "https://errors.pydantic.dev/2.5/v/missing",
      },
    ],
  };
  expect(() => {
    handleErrors(errorResponse);
  }).toThrow("query -> Field required");
});

test("handleErrors.objectLen2", () => {
  const errorResponse = {
    detail: [
      {
        type: "literal_error",
        loc: ["query", "provider"],
        msg: "Input should be 'provider_a' or 'provider_b'",
        input: "a",
        ctx: {
          expected: "'provider_a' or 'provider_b'",
        },
        url: "https://errors.pydantic.dev/2.5/v/literal_error",
      },
      {
        type: "literal_error",
        loc: ["query", "period"],
        msg: "Input should be 'annual' or 'quarter'",
        input: "b",
        ctx: {
          expected: "'annual' or 'quarter'",
        },
        url: "https://errors.pydantic.dev/2.5/v/literal_error",
      },
    ],
  };
  expect(() => {
    handleErrors(errorResponse);
  }).toThrow(
    "provider -> Input should be 'provider_a' or 'provider_b';\nperiod -> Input should be 'annual' or 'quarter'",
  );
});

test("handleErrors.stringObject1", () => {
  const errorResponse = {
    detail:
      "1 validation error for EquityHistoricalQueryParams\ninterval\n  Input should be '1m', '5m', '15m', '30m', '1h', '4h' or '1d' [type=literal_error, input_value='xx', input_type=str]\n    For further information visit https://errors.pydantic.dev/2.5/v/literal_error",
  };
  expect(() => {
    handleErrors(errorResponse);
  }).toThrow(
    "interval ->   Input should be '1m', '5m', '15m', '30m', '1h', '4h' or '1d'",
  );
});

test("handleErrors.stringObject2", () => {
  const errorResponse = {
    detail: `[{'type': 'literal_error', 'loc': ('query', 'provider'), 'msg': "Input should be 'provider_a', 'provider_b' or 'provider_c'", 'input': 'f', 'ctx': {'expected': "'provider_a', 'provider_b' or 'provider_c'"}, 'url': 'https://errors.pydantic.dev/2.6/v/literal_error'}]`,
  };
  expect(() => {
    handleErrors(errorResponse);
  }).toThrow('provider -> Input should be "provider_a", "provider_b" or "provider_c"');
});

test("handleErrors.stringPure", () => {
  const errorResponse = {
    detail:
      "Error in provider request -> Required String parameter 'date' is not present",
  };
  expect(() => {
    handleErrors(errorResponse);
  }).toThrow(
    "Error in provider request -> Required String parameter 'date' is not present",
  );
});

test("handleErrors.fallBack", () => {
  const errorResponse = { detail: null };
  expect(() => {
    handleErrors(errorResponse);
  }).toThrow("Failed to fetch data.");
});

test("ExcelErrorRandomError", () => {
  const error = new Error("This is an error message");
  expect(() => {
    ExcelError(error);
  }).toThrow("This is an error message");
});

test("ExcelErrorCFError", () => {
  const error = CFError("This is an error message");
  const result = ExcelError(error);
  expect(result).toEqual([["#ERROR!: This is an error message"]]);
});
