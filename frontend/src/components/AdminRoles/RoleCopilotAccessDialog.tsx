import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { fetchDefaultAgent } from "~/api/auth.api";
import { getRoleCopilotAccess, putRoleCopilotAccess } from "~/api/entity_roles.api";
import { copilotModels, useShallowCopilotStore } from "~/lib/state/copilot";
import {
  ALL_MCP_TOOLS,
  ALL_MODELS,
  grantAgentId,
  normalizeMcpUrl,
} from "~/lib/state/copilotAccess";
import { useShallowMcpToolsStore } from "~/lib/state/mcpTools";
import { Button } from "../ds/atoms/Button";
import { Checkbox } from "../ds/atoms/Checkbox";
import { BaseDialog } from "../ds/dialogs/BaseDialog";
import { DialogFooter, DialogTitle } from "../ds/dialogs/Dialog";
import type { RoleT } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  role: RoleT | null;
}

type AgentModels = {
  agentId: string;
  name: string;
  models: { id: string; name: string }[];
};

type McpServerTools = { url: string; name: string; tools: string[] };

const modelKey = (agentId: string, modelId: string) => `${agentId}\u0000${modelId}`;
const mcpKey = (url: string, tool: string) => `${url}\u0000${tool}`;
const splitKey = (key: string) => key.split("\u0000") as [string, string];

export default function RoleCopilotAccessDialog({ open, onClose, role }: Props) {
  const queryClient = useQueryClient();
  const roleUuid = role?.uuid ?? "";

  const { selectedCopilot, externalCopilotHolders } = useShallowCopilotStore((s) => ({
    selectedCopilot: s.selectedCopilot,
    externalCopilotHolders: s.externalCopilotHolders,
  }));
  const servers = useShallowMcpToolsStore((s) => s.servers);

  const { data: granted, isLoading } = useQuery({
    queryKey: ["roleCopilotAccess", roleUuid],
    queryFn: () => getRoleCopilotAccess(roleUuid),
    enabled: open && !!roleUuid,
    staleTime: 0,
  });

  const { data: defaultAgent } = useQuery({
    queryKey: ["defaultAgent"],
    queryFn: ({ signal }) => fetchDefaultAgent(signal),
    enabled: open,
  });

  const [models, setModels] = useState<Set<string>>(new Set());
  const [mcp, setMcp] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!granted) return;
    setModels(new Set(granted.models.map((g) => modelKey(g.agent_id, g.model_id))));
    setMcp(new Set(granted.mcp.map((g) => mcpKey(g.server_url, g.tool_name))));
  }, [granted]);

  const agents = useMemo<AgentModels[]>(() => {
    const byId = new Map<string, AgentModels>();
    const copilots = [
      defaultAgent,
      selectedCopilot,
      ...externalCopilotHolders.flatMap((holder) => holder.copilots),
    ];
    for (const copilot of copilots) {
      const models = copilotModels(copilot);
      if (!copilot || !models.length) continue;
      const agentId = grantAgentId(copilot.id);
      if (byId.has(agentId)) continue;
      byId.set(agentId, { agentId, name: copilot.name, models });
    }
    for (const g of granted?.models ?? []) {
      const agent = byId.get(g.agent_id) ?? {
        agentId: g.agent_id,
        name: g.agent_id,
        models: [],
      };
      if (g.model_id !== ALL_MODELS && !agent.models.some((m) => m.id === g.model_id)) {
        agent.models = [...agent.models, { id: g.model_id, name: g.model_id }];
      }
      byId.set(g.agent_id, agent);
    }
    return [...byId.values()];
  }, [defaultAgent, selectedCopilot, externalCopilotHolders, granted]);

  const mcpServers = useMemo<McpServerTools[]>(() => {
    const byUrl = new Map<string, McpServerTools>();
    for (const server of servers) {
      const url = normalizeMcpUrl(server.url);
      if (byUrl.has(url)) continue;
      byUrl.set(url, { url, name: server.name, tools: server.tools.map((t) => t.id) });
    }
    for (const g of granted?.mcp ?? []) {
      const entry = byUrl.get(g.server_url) ?? {
        url: g.server_url,
        name: g.server_url,
        tools: [],
      };
      if (g.tool_name !== ALL_MCP_TOOLS && !entry.tools.includes(g.tool_name)) {
        entry.tools = [...entry.tools, g.tool_name];
      }
      byUrl.set(g.server_url, entry);
    }
    return [...byUrl.values()];
  }, [servers, granted]);

  const toggle = (
    set: Set<string>,
    setter: (next: Set<string>) => void,
    key: string,
    on: boolean,
  ) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    setter(next);
  };

  const { mutate: save, isPending } = useMutation({
    mutationFn: () =>
      putRoleCopilotAccess(roleUuid, {
        models: [...models].map((key) => {
          const [agent_id, model_id] = splitKey(key);
          return { agent_id, model_id };
        }),
        mcp: [...mcp].map((key) => {
          const [server_url, tool_name] = splitKey(key);
          return { server_url, tool_name };
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roleCopilotAccess", roleUuid] });
      toast.success("Agent access saved");
      onClose();
    },
    onError: () => toast.error("Failed to save the agent access"),
  });

  if (!role) return null;

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      className="max-w-md lg:max-w-2xl max-h-[760px] overflow-y-auto"
    >
      <DialogTitle>Agent access - {role.name}</DialogTitle>
      <p className="body-xs-regular text-ds-text-caption">
        Choose what the members of this role may use in the agent. They may use the
        models and tools that one of their roles grants, and nothing else.
      </p>

      {!granted ? (
        <p className="mt-4 body-xs-regular text-ds-text-caption">
          {isLoading ? "Loading..." : "The access of this role could not be loaded."}
        </p>
      ) : (
        <>
          <section
            className="mt-4 flex flex-col gap-2"
            data-testid="copilot-access-models"
          >
            <h3 className="body-sm-bold">Models</h3>
            {agents.length === 0 && !isLoading && (
              <p className="body-xs-regular text-ds-text-caption">
                No agent with a choice of models is available.
              </p>
            )}
            {agents.map((agent) => {
              const all = models.has(modelKey(agent.agentId, ALL_MODELS));
              return (
                <div key={agent.agentId} className="flex flex-col gap-1">
                  <span className="body-xs-medium text-ds-text-caption">
                    {agent.name}
                  </span>
                  <Checkbox
                    label="All models"
                    checked={all}
                    onCheckedChange={(on) =>
                      toggle(
                        models,
                        setModels,
                        modelKey(agent.agentId, ALL_MODELS),
                        on === true,
                      )
                    }
                  />
                  {agent.models.map((model) => (
                    <Checkbox
                      key={model.id}
                      label={model.name}
                      disabled={all}
                      checked={all || models.has(modelKey(agent.agentId, model.id))}
                      onCheckedChange={(on) =>
                        toggle(
                          models,
                          setModels,
                          modelKey(agent.agentId, model.id),
                          on === true,
                        )
                      }
                    />
                  ))}
                </div>
              );
            })}
          </section>

          <section
            className="mt-4 flex flex-col gap-2"
            data-testid="copilot-access-mcp"
          >
            <h3 className="body-sm-bold">MCP servers and tools</h3>
            {mcpServers.length === 0 && !isLoading && (
              <p className="body-xs-regular text-ds-text-caption">
                Add an MCP server to your own workspace to choose its tools here.
              </p>
            )}
            {mcpServers.map((server) => {
              const all = mcp.has(mcpKey(server.url, ALL_MCP_TOOLS));
              return (
                <div key={server.url} className="flex flex-col gap-1">
                  <span className="body-xs-medium text-ds-text-caption">
                    {server.name} ({server.url})
                  </span>
                  <Checkbox
                    label="All tools"
                    checked={all}
                    onCheckedChange={(on) =>
                      toggle(
                        mcp,
                        setMcp,
                        mcpKey(server.url, ALL_MCP_TOOLS),
                        on === true,
                      )
                    }
                  />
                  {server.tools.map((tool) => (
                    <Checkbox
                      key={tool}
                      label={tool}
                      disabled={all}
                      checked={all || mcp.has(mcpKey(server.url, tool))}
                      onCheckedChange={(on) =>
                        toggle(mcp, setMcp, mcpKey(server.url, tool), on === true)
                      }
                    />
                  ))}
                </div>
              );
            })}
          </section>
        </>
      )}

      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={isPending || !granted}
          onClick={() => save()}
        >
          Save
        </Button>
      </DialogFooter>
    </BaseDialog>
  );
}
