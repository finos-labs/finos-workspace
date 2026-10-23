export const SSE_BRIDGE_COMMANDS: ReadonlySet<string> = new Set([
  "update_widget_in_dashboard",
  "add_widget_to_dashboard",
  "get_params_options",
  "manage_navigation_bar",
  "add_generative_widget",
  "assign_tasks_to_agents",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeBridgeArgs(
  fn: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  switch (fn) {
    case "update_widget_in_dashboard": {
      const config = asRecord(input.config);
      return {
        data_sources: [
          {
            widget_uuid: input.widget_uuid,
            ...(input.widget_id ? { id: input.widget_id } : {}),
            input_args: asRecord(config.data_args),
          },
        ],
      };
    }
    case "add_widget_to_dashboard": {
      const config = asRecord(input.config);
      return {
        data_sources: [
          {
            origin: input.origin,
            id: input.widget_id,
            input_args: asRecord(config.data_args),
          },
        ],
      };
    }
    case "get_params_options": {
      const queries = Array.isArray(input.param_options_queries)
        ? input.param_options_queries
        : [];
      return {
        param_options_queries: queries.map((query) => {
          const q = asRecord(query);
          return {
            origin: q.origin,
            id: q.widget_id,
            param: q.param_name,
            options_endpoint_input_args: asRecord(q.data_args),
          };
        }),
      };
    }
    case "add_generative_widget": {
      const { dashboard_id: _dashboardId, ...rest } = input;
      return {
        ...rest,
        name: typeof input.name === "string" ? input.name : "",
      };
    }
    case "manage_navigation_bar":
    case "assign_tasks_to_agents":
      return input;
    default:
      return input;
  }
}
