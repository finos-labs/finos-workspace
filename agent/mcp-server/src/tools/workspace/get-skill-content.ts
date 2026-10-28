import { z } from "zod";
import type { ContentItem } from "../../lib/typed.ts";
import { bridgeManager } from "../../bridge/singleton.ts";
import { executeBridgeCommand } from "../../bridge/execute.ts";
import { describeTool } from "../../bridge/instructions.ts";

export const getSkillContentSchema = {
  slug: z.string().describe(
    "Exact skill slug from the latest workspace snapshot.",
  ),
  reason: z.string().optional().describe(
    "Optional human-facing reason for loading this skill.",
  ),
} as const;

export const getSkillContentDescription = describeTool(
  "Load one skill body from the FINOS Workspace skill library.",
  "Pass the exact skill slug from the latest workspace snapshot.",
);

export async function getSkillContentHandler(args: {
  slug: string;
  reason?: string;
}): Promise<{ content: ContentItem[] }> {
  const { content } = await executeBridgeCommand(bridgeManager, {
    command: "get_skill_content",
    slug: args.slug,
    reason: args.reason ?? null,
  });
  return { content };
}
