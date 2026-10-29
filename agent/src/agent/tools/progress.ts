import { z } from "zod";

export const displaySummarySchema = z
  .string()
  .optional()
  .describe("Short progress line for the user, e.g. 'Checking renewable energy trend'. Display-only.");
