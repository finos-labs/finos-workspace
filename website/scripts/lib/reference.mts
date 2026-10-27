import { existsSync, readFileSync } from "node:fs";
import { fromRepo } from "./paths.mts";

type Json = Record<string, any>;

const SOURCES = {
  backend: {
    folder: "backend-api/backend/reference-data",
    command: "cd backend-api/backend && python -m scripts.export_reference_data",
  },
  agent: { folder: "agent/reference-data", command: "cd agent && npm run reference" },
  frontend: { folder: "frontend/reference-data", command: "cd frontend && npm run reference" },
} as const;

export type Component = keyof typeof SOURCES;

export function referencePath(component: Component, file: string): string {
  return `${SOURCES[component].folder}/${file}`;
}

export function readReference(component: Component, file: string): Json {
  const path = referencePath(component, file);
  if (!existsSync(fromRepo(path))) {
    throw new Error(`${path} does not exist. The ${component} writes it with: ${SOURCES[component].command}`);
  }
  return JSON.parse(readFileSync(fromRepo(path), "utf8")) as Json;
}
