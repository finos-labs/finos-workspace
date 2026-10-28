function validateValue(value: unknown, checkValues = false): boolean {
  if (value === undefined || value === null) return false;

  switch (typeof value) {
    case "string":
      return value.trim().length > 0;

    case "object": {
      if (Array.isArray(value)) return value.length > 0;
      if (!checkValues) return Object.keys(value).length > 0;
      return Object.values(value).some((v) => validateValue(v, true));
    }

    case "boolean":
      return value;

    default:
      return !!value;
  }
}

export function areTruthy<T extends unknown[]>(...args: T): boolean {
  return args.every((arg) => validateValue(arg));
}

export function someTruthy<T extends unknown[]>(...args: T): boolean {
  return args.some((arg) => validateValue(arg));
}

export function isTruthy(value: unknown): boolean {
  return validateValue(value, true);
}

export function isTruthyRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).length > 0;
}
