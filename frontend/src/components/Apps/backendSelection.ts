export type SelectedBackends = string[] | null;

export function isAllBackendsSelected(
  selected: SelectedBackends,
  allIds: string[],
): boolean {
  if (allIds.length === 0) return true;
  if (selected === null) return true;
  return selected.length === allIds.length;
}

export function isNoneBackendsSelected(
  selected: SelectedBackends,
  allIds: string[],
): boolean {
  return allIds.length > 0 && selected !== null && selected.length === 0;
}

export function toggleBackendSelection(
  selected: SelectedBackends,
  allIds: string[],
  backendId: string,
  checked: boolean,
): SelectedBackends {
  const base = selected === null ? allIds : selected;

  const next = checked
    ? base.includes(backendId)
      ? base
      : [...base, backendId]
    : base.filter((id) => id !== backendId);

  if (next.length === allIds.length) return null;
  return next;
}
