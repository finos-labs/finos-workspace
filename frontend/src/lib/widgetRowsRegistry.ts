type RowsProvider = () => Promise<unknown>;

const registry = new Map<string, RowsProvider[]>();

export function provideWidgetRows(uuid: string, provider: RowsProvider): () => void {
  registry.set(uuid, [...(registry.get(uuid) ?? []), provider]);
  return () => {
    const rest = (registry.get(uuid) ?? []).filter((p) => p !== provider);
    if (rest.length) registry.set(uuid, rest);
    else registry.delete(uuid);
  };
}

export function widgetRows(uuid: string): Promise<unknown> | undefined {
  return registry.get(uuid)?.at(-1)?.();
}
