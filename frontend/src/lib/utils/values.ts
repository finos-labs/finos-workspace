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

/**
 * Function to check if all the arguments passed are truthy
 * @param args - Arguments to check if they are truthy
 * @returns boolean
 **/
export function areTruthy<T extends unknown[]>(...args: T): boolean {
  return args.every((arg) => validateValue(arg));
}

/**
 * Function to check if any of the arguments passed are truthy
 * @param args - Arguments to check if they are truthy
 * @returns boolean
 **/
export function someTruthy<T extends unknown[]>(...args: T): boolean {
  return args.some((arg) => validateValue(arg));
}

/**
 * Function to check if the value passed is truthy
 * @param value - Value to check if it is truthy
 * @returns boolean
 **/
export function isTruthy(value: unknown): boolean {
  return validateValue(value, true);
}

/**
 * Function to check if the value passed is a non-empty record
 * @param value - Value to check if it is a non-empty record
 * @returns boolean
 **/
export function isTruthyRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).length > 0;
}
