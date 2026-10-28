export type InvalidItem = {
  file: "widgets.json" | "apps.json" | "templates.json";
  id: string;
  name?: string;
  errors: string;
  json: string;
};

const MAX_JSON_LENGTH = 6000;

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

export function summarizeInvalidItems(items: InvalidItem[]): string {
  const { widgets, apps } = countInvalidItems(items);
  const parts = [
    widgets > 0 ? `${widgets} ${widgets === 1 ? "widget" : "widgets"}` : null,
    apps > 0 ? `${apps} ${apps === 1 ? "app" : "apps"}` : null,
  ].filter(Boolean);
  return `${parts.join(" and ")} could not be loaded.`;
}

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
