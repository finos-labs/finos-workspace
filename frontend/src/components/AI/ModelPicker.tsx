import { useCallback, useEffect, useMemo } from "react";
import { type CopilotModel, useShallowCopilotStore } from "~/lib/state/copilot";
import { allowedModels, useCopilotAccessStore } from "~/lib/state/copilotAccess";
import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValue,
} from "../ds/atoms/Select";

export default function ModelPicker() {
  const { selectedCopilot, selectedModelByAgent, setSelectedModelForAgent } =
    useShallowCopilotStore((s) => ({
      selectedCopilot: s.selectedCopilot,
      selectedModelByAgent: s.selectedModelByAgent,
      setSelectedModelForAgent: s.setSelectedModelForAgent,
    }));

  const access = useCopilotAccessStore((s) => s.access);
  const agentId = selectedCopilot?.id;
  const models = useMemo(
    () =>
      agentId
        ? allowedModels(access, agentId, selectedCopilot?.models as CopilotModel[])
        : [],
    [access, agentId, selectedCopilot?.models],
  );

  const storedModelId = agentId ? selectedModelByAgent[agentId] : undefined;
  const isStoredModelValid =
    storedModelId && models?.some((m) => m.id === storedModelId);
  const currentModel = isStoredModelValid ? storedModelId : (models?.[0]?.id ?? "");

  useEffect(() => {
    if (agentId && storedModelId && !isStoredModelValid && models?.[0]?.id) {
      setSelectedModelForAgent(agentId, models[0].id);
    }
  }, [agentId, storedModelId, isStoredModelValid, models, setSelectedModelForAgent]);

  const handleChange = useCallback(
    (value: string) => {
      if (agentId) setSelectedModelForAgent(agentId, value);
    },
    [agentId, setSelectedModelForAgent],
  );

  if (!models.length || !agentId) return null;

  return (
    <SelectRoot value={currentModel} onValueChange={handleChange}>
      <SelectTrigger
        size="sm"
        className="text-xs h-6 min-w-0 max-w-40 border-none bg-transparent px-1.5 gap-1"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {models.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}
