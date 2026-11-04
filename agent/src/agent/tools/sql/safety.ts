const SAFE_PREFIX = /^(select|with)\b/i;

const DENY_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "sqlite internals", pattern: /\bsqlite_(master|schema|temp_master|temp_schema|sequence)\b/i },
  { name: "PRAGMA", pattern: /\bpragma_/i },
  { name: "ATTACH DATABASE", pattern: /\battach\s+database\b/i },
  { name: "DETACH DATABASE", pattern: /\bdetach\s+database\b/i },
  { name: "PRAGMA", pattern: /\bpragma\s+\w/i },
  {
    name: "multi-statement",
    pattern: /;\s*(select|with|insert|update|delete|drop|create|alter|attach|detach|pragma|vacuum|replace)\b/i,
  },
];

const DENY_TABLE_NAME = /^sqlite_/i;

function stripLeadingSqlComments(sql: string): string {
  let rest = sql;
  while (true) {
    rest = rest.trimStart();
    if (rest.startsWith("--")) {
      const lineEnd = rest.indexOf("\n");
      if (lineEnd === -1) return "";
      rest = rest.slice(lineEnd + 1);
      continue;
    }
    if (rest.startsWith("/*")) {
      const blockEnd = rest.indexOf("*/", 2);
      if (blockEnd === -1) return rest;
      rest = rest.slice(blockEnd + 2);
      continue;
    }
    return rest;
  }
}

export function rejectUnsafeSql(sql: string): string | null {
  if (!SAFE_PREFIX.test(stripLeadingSqlComments(sql))) {
    return "Error: only SELECT or WITH (CTE) statements are allowed.";
  }
  for (const { name, pattern } of DENY_PATTERNS) {
    if (pattern.test(sql)) {
      return `Error: SQL rejected — references ${name}. Allowed: SELECT / WITH against loaded widget tables only.`;
    }
  }
  return null;
}

export function rejectUnsafeTableName(name: string): string | null {
  if (DENY_TABLE_NAME.test(name)) {
    return `Error: "${name}" is a SQLite internal table and is not accessible.`;
  }
  return null;
}
