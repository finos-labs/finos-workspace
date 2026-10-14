/**
 * "Add to dashboard" dialog for a plugin. The user picks a dashboard, a widget title
 * and the plugin's declared settings (from the registry); the plugin is then added as
 * a regular iframe widget whose URL carries those settings.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { Button } from "~/components/ds/atoms/Button";
import { FormInput } from "~/components/ds/atoms/Input";
import { FormSelect } from "~/components/ds/atoms/Select";
import { BaseDialog } from "~/components/ds/dialogs/BaseDialog";
import { DialogDescription, DialogTitle } from "~/components/ds/dialogs/Dialog";
import { Form, FormField } from "~/components/ds/molecules/Form";
import type { WidgetJsonT } from "~/components/types";
import type { PluginMetadata, PluginSetting, PluginSettingValues } from "~/lib/plugins";
import { useShallowAppStore } from "~/lib/state/app";
import { useSidebarStore } from "~/lib/state/sidebar";
import { generateRandomName } from "~/lib/utils";
import { scrollToAndHighlightWidget } from "~/lib/utils/widgetHighlight";

const CREATE_DASHBOARD = "__create_dashboard__";
/** Select option for "no value": the plugin uses its own default. Radix Select can't hold "". */
const PLUGIN_DEFAULT = "__plugin_default__";

function isHttpUrl(value: string) {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Form-level checks only; the plugin validates setting values again. */
function settingSchema(setting: PluginSetting) {
  const value = z.string().trim().max(2000);
  if (setting.type === "url") {
    return value.refine((v) => !v || isHttpUrl(v), "Enter an http(s) URL");
  }
  return value;
}

function buildFormSchema(settings: PluginSetting[]) {
  return z.object({
    dashboardId: z.string().min(1, "Choose a dashboard"),
    title: z.string().trim().min(1, "This field is required"),
    settings: z.object(
      Object.fromEntries(
        settings.map((setting) => [setting.key, settingSchema(setting)]),
      ),
    ),
  });
}

interface FormValues {
  dashboardId: string;
  title: string;
  settings: PluginSettingValues;
}

interface AddPluginToDashboardDialogProps {
  plugin: PluginMetadata;
  /** Resolves the runtime URL (plugin host + route) with the chosen setting values. */
  resolveUrl: (settings: PluginSettingValues) => string;
  onClose: () => void;
}

/**
 * Adds a plugin to a dashboard through Workspace's existing iframe widget, so
 * the dashboard owns layout, persistence and sharing as for any other widget.
 */
export function AddPluginToDashboardDialog({
  plugin,
  resolveUrl,
  onClose,
}: AddPluginToDashboardDialogProps) {
  const settings = useMemo(() => plugin.settings ?? [], [plugin]);
  const formSchema = useMemo(() => buildFormSchema(settings), [settings]);
  const navigate = useNavigate();
  const { items, getRootTabs, addTab, addWidgets } = useShallowAppStore((state) => ({
    items: state.items,
    getRootTabs: state.getRootTabs,
    addTab: state.addTab,
    addWidgets: state.addWidgets,
  }));

  // `items` is a dependency so the list refreshes when a dashboard is created.
  const dashboards = useMemo(() => getRootTabs(), [items, getRootTabs]);
  const options = useMemo(
    () => [
      ...dashboards.map((tab) => ({
        label: tab.data?.name || "Untitled dashboard",
        value: String(tab.index),
      })),
      { label: "+ Create dashboard", value: CREATE_DASHBOARD },
    ],
    [dashboards],
  );

  // Default to the dashboard the user last had open, if it still exists.
  const defaultDashboardId = useMemo(() => {
    const active = useSidebarStore.getState().activeItem;
    return dashboards.some((tab) => tab.index === active) ? String(active) : "";
  }, []);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      dashboardId: defaultDashboardId,
      title: plugin.name,
      settings: Object.fromEntries(
        settings.map((setting) => [
          setting.key,
          setting.type === "select" ? PLUGIN_DEFAULT : "",
        ]),
      ),
    },
  });

  const [adding, setAdding] = useState(false);
  const [createdDashboardId, setCreatedDashboardId] = useState<string | null>(null);

  const handleDashboardChange = useCallback(
    (value: string, onChange: (value: string) => void) => {
      // Radix Select reports "" when its hidden native <select> briefly lacks the
      // current option (right after a dashboard is created). Ignore it.
      if (!value) return;
      if (value !== CREATE_DASHBOARD) {
        onChange(value);
        return;
      }
      // Same create flow as the sidebar's "New Dashboard".
      const id = uuidv4();
      addTab({
        index: id,
        data: { name: generateRandomName(), type: "custom", widgets: [] },
      });
      setCreatedDashboardId(id);
    },
    [addTab],
  );

  // Select the new dashboard only once its option is rendered.
  useEffect(() => {
    if (!createdDashboardId) return;
    if (!dashboards.some((tab) => tab.index === createdDashboardId)) return;
    const frame = requestAnimationFrame(() => {
      form.setValue("dashboardId", createdDashboardId, { shouldValidate: true });
      setCreatedDashboardId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [createdDashboardId, dashboards, form]);

  const onSubmit = useCallback(
    async (values: FormValues) => {
      setAdding(true);
      const id = uuidv4();
      // Each widget keeps its own values in its URL, so two widgets of one plugin can differ.
      const url = resolveUrl(
        Object.fromEntries(
          Object.entries(values.settings).filter(
            ([, value]) => value !== PLUGIN_DEFAULT,
          ),
        ),
      );
      // The same shape the website connector uses for iframe widgets.
      const widget: Partial<WidgetJsonT> = {
        id,
        widgetId: `iframe-${id}`,
        name: values.title.trim(),
        description: plugin.description,
        gridData: { w: 40, h: 22, minW: 12, minH: 10 },
        storage: { html: url },
      };
      const addedId = await addWidgets(values.dashboardId, [widget as WidgetJsonT]);
      setAdding(false);
      if (!addedId) return; // addWidgets already explained why

      toast.success(`${plugin.name} added to the dashboard`);
      onClose();
      navigate(`/app/${values.dashboardId}`);
      scrollToAndHighlightWidget(id, { waitForLayout: true });
    },
    [plugin, resolveUrl, addWidgets, onClose, navigate],
  );

  return (
    <BaseDialog open onClose={onClose} className="lg:w-[480px] sm:max-w-[480px]">
      <DialogTitle>Add {plugin.name} to a dashboard</DialogTitle>
      <DialogDescription>
        The plugin is added as a widget, so you can move, resize and share it like any
        other widget.
      </DialogDescription>
      <Form {...form}>
        <form
          id="add-plugin-to-dashboard"
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-2 text-xs"
        >
          <FormField
            name="dashboardId"
            control={form.control}
            render={({ field }) => (
              <FormSelect
                label="Dashboard"
                placeholder="Choose a dashboard"
                options={options}
                value={field.value}
                onChange={(value: string) =>
                  handleDashboardChange(value, field.onChange)
                }
              />
            )}
          />
          <FormField
            name="title"
            control={form.control}
            render={({ field }) => (
              <FormInput label="Widget title" placeholder="Widget title" {...field} />
            )}
          />
          {settings.map((setting) => (
            <FormField
              key={setting.key}
              name={`settings.${setting.key}`}
              control={form.control}
              render={({ field }) =>
                setting.type === "select" ? (
                  <FormSelect
                    label={setting.label}
                    message={setting.description}
                    options={[
                      { label: "Plugin default", value: PLUGIN_DEFAULT },
                      ...(setting.options ?? []),
                    ]}
                    value={field.value}
                    onChange={(value: string) => value && field.onChange(value)}
                  />
                ) : (
                  <FormInput
                    label={setting.label}
                    message={setting.description}
                    placeholder={setting.type === "url" ? "https://" : setting.label}
                    type={setting.type === "url" ? "url" : "text"}
                    {...field}
                  />
                )
              }
            />
          ))}
        </form>
      </Form>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outlined" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="add-plugin-to-dashboard"
          size="sm"
          loading={adding}
          disabled={adding}
        >
          Add
        </Button>
      </div>
    </BaseDialog>
  );
}
