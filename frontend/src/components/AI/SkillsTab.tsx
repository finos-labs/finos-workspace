import { useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useDebounceValue } from "usehooks-ts";
import { deleteUserSkills } from "~/api/auth.api";
import { AgentSkillCard, SkillCard } from "~/components/AI/SkillCard";
import { Button } from "~/components/ds/atoms/Button";
import { ConfirmDialog } from "~/components/ds/dialogs/ConfirmDialog";
import SearchResultsNotFound from "~/components/General/SearchResultsNotFound";
import Icon from "~/components/Icon";
import {
  TabPageEmptyState,
  TabPageLayout,
  TabPageSearchInput,
  TabPageToolbar,
} from "~/components/shared/TabPage";
import { useStateReducer } from "~/hooks/useStateReducer";
import { useShallowCopilotStore } from "~/lib/state/copilot";
import { useShallowSkillsLibraryStore } from "~/lib/state/skillsLibrary";

type SkillsTabState = {
  deleteSkillId: string | null;
  bulkDeleteOpen: boolean;
  selectedSkills: Set<string>;
  filter: string;
};

export function SkillsTab() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [state, dispatch] = useStateReducer<SkillsTabState>({
    deleteSkillId: null,
    bulkDeleteOpen: false,
    selectedSkills: new Set(),
    filter: "",
  });

  const [debouncedFilter] = useDebounceValue(state.filter, 300);

  const { skills, setSkillDialogOpen, updateSkills } = useShallowSkillsLibraryStore(
    (s) => ({
      skills: s.skills,
      setSkillDialogOpen: s.setSkillDialogOpen,
      updateSkills: s.updateSkills,
    }),
  );
  const agent = useShallowCopilotStore((s) => s.selectedCopilot);

  const handleDelete = useCallback((id: string) => {
    dispatch({ deleteSkillId: id });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (state.deleteSkillId) {
      const updatedSkills = await deleteUserSkills(state.deleteSkillId);
      dispatch({ deleteSkillId: null });
      if (!updatedSkills) return toast.error("Failed to delete skill");

      updateSkills(updatedSkills);
      toast.success("Skill deleted");
    }
  }, [state.deleteSkillId, updateSkills]);

  const handleEdit = useCallback(
    (id: string) => setSkillDialogOpen(id),
    [setSkillDialogOpen],
  );

  const toggleSkillSelection = useCallback((id: string) => {
    dispatch({
      selectedSkills: (prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      },
    });
  }, []);

  const handleBulkDelete = useCallback(() => {
    if (state.selectedSkills.size > 0) {
      dispatch({ bulkDeleteOpen: true });
    }
  }, [state.selectedSkills.size]);

  const handleConfirmBulkDelete = useCallback(async () => {
    const count = state.selectedSkills.size;
    if (count > 0) {
      const updatedSkills = await deleteUserSkills(Array.from(state.selectedSkills));
      if (!updatedSkills) return toast.error("Failed to delete selected skills");
      updateSkills(updatedSkills);
    }

    dispatch({ selectedSkills: new Set(), bulkDeleteOpen: false });
    toast.success("Skills deleted", {
      description: `Successfully deleted ${count} skill(s).`,
    });
  }, [updateSkills, state.selectedSkills]);

  const handleSearchChange = useCallback(
    (value: string) => {
      dispatch({ filter: value });
      if (inputRef.current && !value) {
        inputRef.current.value = value;
      }
    },
    [dispatch],
  );

  const handleOpenAddSkill = useCallback(() => {
    setSkillDialogOpen(true);
  }, [setSkillDialogOpen]);

  const selectedSkillsList = useMemo(
    () => skills.filter((s) => state.selectedSkills.has(s.id)),
    [skills, state.selectedSkills],
  );

  const agentSkills = useMemo(() => {
    const ownSlugs = new Set(skills.map((skill) => skill.slug));
    return (agent?.skills ?? []).filter((skill) => !ownSlugs.has(skill.slug));
  }, [agent?.skills, skills]);

  const filteredAgentSkills = useMemo(() => {
    if (!debouncedFilter) return agentSkills;
    const searchTerm = debouncedFilter.toLowerCase();
    return agentSkills.filter(
      (skill) =>
        skill.slug.toLowerCase().includes(searchTerm) ||
        skill.description.toLowerCase().includes(searchTerm),
    );
  }, [agentSkills, debouncedFilter]);

  const filteredSkills = useMemo(() => {
    if (!debouncedFilter) return skills;
    const searchTerm = debouncedFilter.toLowerCase();
    return skills.filter(
      (skill) =>
        skill.slug.toLowerCase().includes(searchTerm) ||
        skill.description.toLowerCase().includes(searchTerm) ||
        skill.content.toLowerCase().includes(searchTerm),
    );
  }, [skills, debouncedFilter]);

  return (
    <>
      <TabPageLayout>
        <TabPageToolbar className="flex-nowrap">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <TabPageSearchInput
              ref={inputRef}
              placeholder="Search for skills"
              defaultValue={state.filter}
              onChange={handleSearchChange}
              className="w-full min-w-[120px] max-w-[420px]"
            />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {state.selectedSkills.size > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleBulkDelete}
                className="h-8"
              >
                <Icon id="trash-04" className="size-3.5" />
                Delete skill{state.selectedSkills.size > 1 ? "s" : ""}
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={handleOpenAddSkill}>
              Add Skill
            </Button>
          </div>
        </TabPageToolbar>

        <div className="flex flex-col gap-4">
          {filteredSkills.length === 0 && filteredAgentSkills.length === 0 ? (
            debouncedFilter ? (
              <SearchResultsNotFound
                extraClassName="rounded-lg bg-general-bg-primary p-12 h-[200px]"
                icon={true}
              />
            ) : (
              <TabPageEmptyState
                title="No Skills added"
                description={
                  <>
                    Skills are reusable instructions that help the AI handle specific
                    tasks. Use{" "}
                    <code className="bg-light-200 dark:bg-dark-700 px-1 rounded">
                      /skill:skill-name
                    </code>{" "}
                    in chat to activate them or let the agent pick them up on its own.
                  </>
                }
              />
            )
          ) : (
            <div>
              <hr className="mt-2 border-surface-divider" />
              <div className="flex flex-col">
                {filteredAgentSkills.map((skill) => (
                  <AgentSkillCard
                    key={`agent-skill-card-${skill.slug}`}
                    skill={skill}
                    agentName={agent?.name ?? "the agent"}
                  />
                ))}
                {filteredSkills.map((skill) => (
                  <SkillCard
                    key={`skill-card-${skill.id}`}
                    skill={skill}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    selected={state.selectedSkills.has(skill.id)}
                    onToggleSelect={toggleSkillSelection}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </TabPageLayout>

      <ConfirmDialog
        open={state.deleteSkillId !== null}
        onClose={() => dispatch({ deleteSkillId: null })}
        title="Delete Skill"
        description={
          <>
            <span className="block">Are you sure you want to delete this skill?</span>
            <span className="block text-light-600 dark:text-dark-50 text-xs mt-2">
              This action cannot be undone.
            </span>
          </>
        }
        confirmButton={
          <Button variant="danger" size="sm" onClick={handleConfirmDelete}>
            Delete
          </Button>
        }
        cancelText="Cancel"
      />

      <ConfirmDialog
        open={state.bulkDeleteOpen}
        onClose={() => dispatch({ bulkDeleteOpen: false })}
        title="Delete Skill(s)"
        description={
          <>
            <span className="block">
              Are you sure you want to delete{" "}
              <span className="font-bold">{state.selectedSkills.size}</span> selected
              skill(s)?
            </span>
            <span className="block mt-2">
              <span className="block text-light-600 dark:text-dark-50 text-xs font-medium mb-1">
                Skills to be deleted:
              </span>
              <ul className="text-xs space-y-1 max-h-40 overflow-y-auto border-l-2 border-light-200 dark:border-dark-600">
                {selectedSkillsList.map((skill) => (
                  <li
                    key={skill.id}
                    className="text-light-900 dark:text-light-100 pl-2 py-0.5"
                  >
                    <code className="bg-light-200 dark:bg-dark-700 px-1 rounded">
                      /{skill.slug}
                    </code>{" "}
                    - {skill.description.slice(0, 40)}
                    {skill.description.length > 40 && "..."}
                  </li>
                ))}
              </ul>
            </span>
            <span className="block text-light-600 dark:text-dark-50 text-xs mt-3">
              This action cannot be undone.
            </span>
          </>
        }
        confirmButton={
          <Button variant="danger" size="sm" onClick={handleConfirmBulkDelete}>
            Yes, Delete
          </Button>
        }
        cancelText="Cancel"
      />
    </>
  );
}
