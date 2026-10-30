import type { ProtocolCases } from "../../src/data/types.ts";
import { readReference } from "./reference.mts";

export function collectProtocolCases(): ProtocolCases {
  const contract = readReference("frontend", "widgets-contract-reference.json");
  const rows = readReference("frontend", "raw-rows-reference.json");
  const mcp = readReference("frontend", "mcp-link-reference.json");
  return { contract: contract.checks, rawRows: rows.rows, mcpActive: mcp.active, mcpCite: mcp.cite };
}
