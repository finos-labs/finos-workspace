import { createWithEqualityFn } from "zustand/traditional";
import { shallow } from "zustand/vanilla/shallow";
import type { ParamDef, WidgetT } from "~/components/types";
import type {
  AvailablePlugin,
  PluginListing,
  PluginWidgetDef,
  ResolvedPluginWidget,
} from "./types";

/**
 * The plugins the signed-in user may use, as the API listed them
 * (docs/widget-plugins/DESIGN.md 5). It is fed by `usePluginRegistrySync`; the server
 * decides availability and the registry only holds the answer.
 */
interface PluginRegistryState {
  loaded: boolean;
  enabled: boolean;
  etag: string | null;
  plugins: AvailablePlugin[];
  vizHandlers: PluginListing["vizHandlers"];
  setListing: (listing: PluginListing) => void;
  clear: () => void;
}

const EMPTY: Pick<
  PluginRegistryState,
  "loaded" | "enabled" | "etag" | "plugins" | "vizHandlers"
> = {
  loaded: false,
  enabled: false,
  etag: null,
  plugins: [],
  vizHandlers: {},
};

export const usePluginRegistryStore = createWithEqualityFn<PluginRegistryState>()(
  (set, get) => ({
    ...EMPTY,
    setListing: (listing) => {
      if (get().loaded && get().etag === listing.etag) return;
      set({
        loaded: true,
        enabled: listing.enabled,
        etag: listing.etag,
        plugins: listing.plugins,
        vizHandlers: listing.vizHandlers,
      });
    },
    clear: () => set({ ...EMPTY }),
  }),
  shallow,
);

/** The viz types an available plugin renders for this user. */
export function getPluginVizTypes(): Set<string> {
  return new Set(Object.keys(usePluginRegistryStore.getState().vizHandlers));
}

function findWidget(
  plugins: AvailablePlugin[],
  pluginId: string,
  widgetId: string,
): { plugin: AvailablePlugin; widget: PluginWidgetDef } | null {
  const plugin = plugins.find((p) => p.id === pluginId);
  const widget = plugin?.widgets.find((w) => w.id === widgetId);
  return plugin && widget ? { plugin, widget } : null;
}

/** The plugin widget that renders a backend widget of this viz type, if any. */
export function resolveVizHandler(
  vizType: string | null | undefined,
  state: Pick<
    PluginRegistryState,
    "plugins" | "vizHandlers"
  > = usePluginRegistryStore.getState(),
): ResolvedPluginWidget | null {
  if (!vizType) return null;
  const handler = state.vizHandlers[vizType];
  if (!handler) return null;
  const found = findWidget(state.plugins, handler.plugin, handler.widget);
  return found ? { ...found, vizType } : null;
}

/** A standalone plugin widget by its plugin and widget ids. */
export function resolvePluginWidget(
  reference: { id: string; widget: string } | null | undefined,
  state: Pick<PluginRegistryState, "plugins"> = usePluginRegistryStore.getState(),
): ResolvedPluginWidget | null {
  if (!reference) return null;
  return findWidget(state.plugins, reference.id, reference.widget);
}

/** The widget id a standalone plugin widget carries in a dashboard. */
export function pluginWidgetId(pluginId: string, widgetId: string) {
  return `plugin:${pluginId}:${widgetId}`;
}

/**
 * The standalone widgets of the plugins available to the user, as Add widget lists them
 * (DESIGN.md 5): under their category, with the plugin named as their source. The
 * instance carries the `plugin` reference, which is what renders it.
 */
export function standalonePluginWidgets(plugins: AvailablePlugin[]): WidgetT[] {
  return plugins.flatMap((plugin) =>
    plugin.widgets
      .filter((widget) => widget.standalone)
      .map((widget) => {
        const widgetId = pluginWidgetId(plugin.id, widget.id);
        const { w, h, minW, minH } = widget.grid;
        return {
          id: widgetId,
          widgetId,
          type: "custom",
          name: widget.name,
          description: widget.description,
          category: widget.category ?? plugin.name,
          subCategory: widget.subCategory ?? undefined,
          sourceName: plugin.name,
          connectionType: "plugin",
          plugin: { id: plugin.id, widget: widget.id },
          params: widget.params as unknown as ParamDef[],
          gridData: { w, h, ...(minW ? { minW } : {}), ...(minH ? { minH } : {}) },
        } satisfies WidgetT;
      }),
  );
}
