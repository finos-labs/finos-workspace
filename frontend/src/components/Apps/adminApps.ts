import dayjs from "dayjs";

export interface App {
  uuid: string;
  name: string;
  url: string;
  user_uuid: string | null;
  user_email: string | null;
  enabled: boolean;
  created_date: string;
  updated_date: string;
}

export function ownerLabel(app: App) {
  return app.user_uuid ? app.user_email || "-" : "Organization";
}

export function formatDate(value: string | undefined) {
  return value ? dayjs(value).locale("en").format("MMM D, YYYY h:mm A") : "-";
}

export function dedupeApps(apps: App[]): App[] {
  const latest = new Map<string, App>();
  for (const a of apps) {
    const key = `${a.user_uuid}|||${a.name}|||${a.url}`;
    const existing = latest.get(key);
    if (!existing || a.updated_date > existing.updated_date) {
      latest.set(key, a);
    }
  }
  return Array.from(latest.values());
}
