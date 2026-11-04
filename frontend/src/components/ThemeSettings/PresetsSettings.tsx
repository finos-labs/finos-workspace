import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ds/atoms/Button";
import { Input } from "~/components/ds/atoms/Input";
import { Select } from "~/components/ds/atoms/Select";
import { ConfirmDialog } from "~/components/ds/dialogs/ConfirmDialog";
import SettingsMenu from "~/components/ds/molecules/SettingsMenu";
import { Tabs, TabsList, TabsTrigger } from "~/components/ds/molecules/Tabs";
import { useShallowThemeStore } from "~/lib/state/theme";
import {
  isDirty,
  useShallowThemePresetsStore,
  useThemePresetsStore,
} from "~/lib/state/themePresets";
import { toCss } from "~/lib/theme/css";
import { applyPreviewTheme } from "~/lib/theme/sheet";
import { PropertyList } from "./PropertyList";
import { ThemeSpecimen } from "./ThemeSpecimen";

const DEFAULT_ID = "default";
const NAME_MAX = 60;

type DialogKind = "saveAs" | "rename" | "delete" | null;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/css" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function PresetsSettings() {
  const mode = useShallowThemeStore((state) => state.theme);
  const setTheme = useShallowThemeStore((state) => state.setTheme);
  const store = useShallowThemePresetsStore((state) => state);
  const { presets, activeId, selectedId, draft, loaded } = store;
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [discarding, setDiscarding] = useState<{ id: string | null } | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    useThemePresetsStore.getState().load();
    return () => applyPreviewTheme(null);
  }, []);

  useEffect(() => {
    applyPreviewTheme(draft);
  }, [draft]);

  const selected = presets.find((preset) => preset.uuid === selectedId);
  const dirty = isDirty(store);
  const css = useMemo(() => toCss(draft), [draft]);
  const applied = selectedId === activeId;
  const options = [
    { label: "FINOS (default)", value: DEFAULT_ID },
    ...presets.map((preset) => ({
      label: preset.uuid === activeId ? `${preset.name} (applied)` : preset.name,
      value: preset.uuid,
    })),
  ];

  function choose(value: string) {
    const id = value === DEFAULT_ID ? null : value;
    if (id === selectedId) return;
    if (dirty) setDiscarding({ id });
    else store.select(id);
  }

  function openNameDialog(kind: "saveAs" | "rename") {
    setName(kind === "rename" ? (selected?.name ?? "") : "");
    setDialog(kind);
  }

  async function confirmName() {
    const ok = await (dialog === "rename" ? store.rename(name) : store.saveAs(name));
    if (ok) setDialog(null);
  }

  async function confirmDelete() {
    setDialog(null);
    await store.remove();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(css);
      toast.success("Copied the stylesheet");
    } catch {
      toast.error("Could not copy the stylesheet");
    }
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="sticky top-0 z-20 flex flex-col gap-2 rounded bg-general-bg-primary p-3 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="body-xs-medium text-ds-text-heading">Preset</span>
            <div className="min-w-0 flex-1">
              <Select
                aria-label="Preset"
                options={options}
                value={selectedId ?? DEFAULT_ID}
                onChange={choose}
                size="sm"
                className="w-full"
                disabled={!loaded}
              />
            </div>
            {dirty && (
              <span className="body-xs-regular text-alert-warning">
                Unsaved changes
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {applied ? (
              <span className="body-xs-medium text-alert-success">
                Applied to everyone
              </span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => store.activate(selectedId)}
                disabled={dirty}
                title={dirty ? "Save the changes first" : undefined}
              >
                Apply to everyone
              </Button>
            )}
            <Button
              size="sm"
              variant="outlined"
              disabled={!selected}
              onClick={() => openNameDialog("rename")}
            >
              Rename
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!selected}
              onClick={() => setDialog("delete")}
            >
              Delete
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs
              value={mode}
              onValueChange={(next) => setTheme(next as "light" | "dark")}
              variant="filled_secondary"
              className="w-64"
            >
              <TabsList>
                <TabsTrigger value="light" className="text-xs">
                  Light Mode
                </TabsTrigger>
                <TabsTrigger value="dark" className="text-xs">
                  Dark Mode
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" onClick={store.save} disabled={!selected || !dirty}>
                Save
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => openNameDialog("saveAs")}
              >
                Save as…
              </Button>
              <Button
                size="sm"
                variant="outlined"
                onClick={store.revert}
                disabled={!dirty}
              >
                Revert
              </Button>
            </div>
          </div>
        </div>

        <SettingsMenu
          title="Stylesheet"
          canCollapse={true}
          defaultOpen={false}
          rightElement={
            <div className="flex items-center gap-1">
              <Button size="xs" variant="ghost" onClick={copy} disabled={!css}>
                Copy CSS
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => download("theme.css", css)}
                disabled={!css}
              >
                Download theme.css
              </Button>
            </div>
          }
        >
          <pre className="whitespace-pre-wrap p-3 font-mono text-xs text-ds-text-body">
            {css || "No changes: the preset is the FINOS theme."}
          </pre>
        </SettingsMenu>

        <PropertyList scope={mode} />
      </div>

      <div className="min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        <ThemeSpecimen />
      </div>

      <ConfirmDialog
        open={dialog === "saveAs" || dialog === "rename"}
        onClose={() => setDialog(null)}
        title={dialog === "rename" ? "Rename preset" : "Save as a new preset"}
        content={
          <Input
            aria-label="Preset name"
            placeholder="Preset name"
            value={name}
            maxLength={NAME_MAX}
            onChange={setName}
            clearable={false}
            autoFocus={true}
          />
        }
        confirmButton={
          <Button size="sm" disabled={!name.trim()} onClick={confirmName}>
            Save
          </Button>
        }
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        title="Delete preset"
        description={`Delete ${selected?.name ?? "this preset"}? If it is applied, everyone returns to the FINOS theme.`}
        confirmButton={
          <Button variant="danger" size="sm" onClick={confirmDelete}>
            Yes, Delete
          </Button>
        }
      />
      <ConfirmDialog
        open={discarding !== null}
        onClose={() => setDiscarding(null)}
        title="Discard unsaved changes"
        description="The changes to this preset have not been saved."
        confirmButton={
          <Button
            size="sm"
            onClick={() => {
              if (discarding) store.select(discarding.id);
              setDiscarding(null);
            }}
          >
            Discard
          </Button>
        }
      />
    </div>
  );
}
