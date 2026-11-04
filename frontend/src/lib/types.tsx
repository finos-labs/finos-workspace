interface SaveWidgetsPayload {
  saveWidgets: boolean;
}

export type SaveWidgetsEventT = CustomEvent<SaveWidgetsPayload>;
