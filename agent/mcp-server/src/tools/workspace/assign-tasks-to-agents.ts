import { z } from "zod";
import type { ContentItem } from "../../lib/typed.ts";
import { bridgeManager } from "../../bridge/singleton.ts";
import { executeBridgeCommand } from "../../bridge/execute.ts";
import { parseJsonList, JsonArgumentError } from "../../bridge/json-args.ts";
import { describeTool } from "../../bridge/instructions.ts";

export const assignTasksToAgentsSchema = {
  task_requests_json: z.string().describe(
    "JSON array of task objects shaped like " +
      "{id, description, assigned_holder_url, assigned_agent_id}.",
  ),
} as const;

export const assignTasksToAgentsDescription = describeTool(
  "Assign tasks to configured external Workspace agents.",
  "Use task_requests items shaped like {id, description, assigned_holder_url, assigned_agent_id}.",
);

export async function assignTasksToAgentsHandler(args: {
  task_requests_json: string;
}): Promise<{ content: ContentItem[] }> {
  let taskRequests: Array<Record<string, unknown>>;
  try {
    taskRequests = parseJsonList(
      "assign_tasks_to_agents",
      "task_requests_json",
      args.task_requests_json,
    );
  } catch (err) {
    if (err instanceof JsonArgumentError) {
      return { content: [err.toContentItem()] };
    }
    throw err;
  }

  const { content } = await executeBridgeCommand(bridgeManager, {
    command: "assign_tasks_to_agents",
    task_requests: taskRequests,
  });
  return { content };
}
