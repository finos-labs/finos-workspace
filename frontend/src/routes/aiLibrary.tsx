import * as TabsPrimitive from "@radix-ui/react-tabs";
import { AIAgentsTab } from "~/components/AI/AIAgentsTab";
import { MCPServersTab } from "~/components/AI/MCPServersTab";
import { PromptsTab } from "~/components/AI/PromptsTab";
import { SkillsTab } from "~/components/AI/SkillsTab";
import { SettingsLayout } from "~/components/LayoutAuth/Skeleton/SettingsLayout";

const AI_TABS = [
  { label: "AI Agents", id: "ai-agents" },
  { label: "MCP Servers", id: "mcp-servers" },
  { label: "Skills", id: "skills" },
  { label: "Prompts", id: "prompts" },
];

export default function AILibrary() {
  return (
    <SettingsLayout title="AI Library" tabs={AI_TABS} defaultTab="ai-agents">
      <TabsPrimitive.Content
        value="ai-agents"
        forceMount
        className="data-[state=inactive]:hidden"
      >
        <AIAgentsTab />
      </TabsPrimitive.Content>
      <TabsPrimitive.Content
        value="mcp-servers"
        forceMount
        className="data-[state=inactive]:hidden"
      >
        <MCPServersTab />
      </TabsPrimitive.Content>
      <TabsPrimitive.Content
        value="skills"
        forceMount
        className="data-[state=inactive]:hidden"
      >
        <SkillsTab />
      </TabsPrimitive.Content>
      <TabsPrimitive.Content
        value="prompts"
        forceMount
        className="data-[state=inactive]:hidden"
      >
        <PromptsTab />
      </TabsPrimitive.Content>
    </SettingsLayout>
  );
}
