/** An entry of a backend's widgets.json or apps.json that does not pass validation. */
export type InvalidItem = {
  /** The file of the backend that the item is in */
  file: "widgets.json" | "apps.json" | "templates.json";
  /** The widget id, or the name of the app */
  id: string;
  name?: string;
  /** What is wrong with it, in the format of the other validation messages */
  errors: string;
  /** The item as the backend sent it, to inspect it next to what is wrong */
  json: string;
};

const MAX_JSON_LENGTH = 6000;

/** The item as pretty JSON, cut when it is very long. */
export function toInspectableJson(item: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(item, null, 2) ?? String(item);
  } catch {
    json = String(item);
  }
  return json.length > MAX_JSON_LENGTH
    ? `${json.slice(0, MAX_JSON_LENGTH)}\n... (${json.length - MAX_JSON_LENGTH} more characters)`
    : json;
}

export function countInvalidItems(items: InvalidItem[]) {
  const widgets = items.filter((item) => item.file === "widgets.json").length;
  return { widgets, apps: items.length - widgets };
}

/** One line for a toast: "2 widgets and 1 app were skipped". */
export function summarizeInvalidItems(items: InvalidItem[]): string {
  const { widgets, apps } = countInvalidItems(items);
  const parts = [
    widgets > 0 ? `${widgets} ${widgets === 1 ? "widget" : "widgets"}` : null,
    apps > 0 ? `${apps} ${apps === 1 ? "app" : "apps"}` : null,
  ].filter(Boolean);
  return `${parts.join(" and ")} could not be loaded.`;
}

/** Plain text of the items, to copy into a bug report or the backend's issue tracker. */
export function formatInvalidItemsAsText(
  sourceName: string,
  items: InvalidItem[],
): string {
  const sections = items.map((item) => {
    const title =
      item.name && item.name !== item.id ? `${item.name} (${item.id})` : item.id;
    return `[${item.file}] ${title}\n${item.errors.trim()}`;
  });
  return `Invalid items in ${sourceName}\n\n${sections.join("\n\n")}`;
}
