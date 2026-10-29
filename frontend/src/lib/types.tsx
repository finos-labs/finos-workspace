import type { NewWidgetT } from "~/components/types";

export interface SaveWidgetsPayload {
  saveWidgets: boolean;
}

export type SaveWidgetsEventT = CustomEvent<SaveWidgetsPayload>;
export interface SaveWidgetsEvent extends Event {
  detail: SaveWidgetsPayload;
}

export interface UpdateWidgetPayload {
  newWidget: NewWidgetT;
}

export type UpdateWidgetEventT = CustomEvent<UpdateWidgetPayload>;

export interface UpdateWidgetEvent extends Event {
  detail: UpdateWidgetPayload;
}
