import { z } from "zod";

/** The progress line of a tool call: the base prompt says once what it is, so the tools only name it. */
export const displaySummarySchema = z
  .string()
  .optional()
  .describe("Short progress line for the user, e.g. 'Checking renewable energy trend'. Display-only.");
