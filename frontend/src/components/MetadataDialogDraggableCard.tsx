import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  getFileWidgets,
  getWidgetMetadata,
  type PostFileWidget,
  patchWidgetMetadata,
  postFileWidget,
  postWidgetMetadata,
} from "~/api/auth.api";
import { useStateReducer } from "~/hooks/useStateReducer";
import { useShallowAppStore } from "~/lib/state/app";
import {
  isMetadataType,
  useShallowBackendConnectorStore,
  type WidgetMetadataItem,
} from "~/lib/state/backendConnector";
import { useShallowCopilotDataStore } from "~/lib/state/copilotData";
import { dispatchSaveState, dispatchUpdateWidget, processWidgetId } from "~/lib/utils";
import type { MetaDataWidgetType } from "~/types/auth.type";
import { handleWidgetMetadata } from "~/utils/dataConnectorsHelpers";
import { Button } from "./ds/atoms/Button";
import { FormInput } from "./ds/atoms/Input";
import { FormTextarea } from "./ds/atoms/TextArea";
import { BaseDialog } from "./ds/dialogs/BaseDialog";
import { DialogDescription, DialogFooter, DialogTitle } from "./ds/dialogs/Dialog";
import { Form, FormField } from "./ds/molecules/Form";
import { useWidgetContext } from "./Widget.context";

interface Props {
  open: boolean;
  setOpen: (open: boolean) => void;
  className?: string;
}

const metadataSchema = z.object({
  name: z.string().min(1, "This field is required"),
  description: z.string().optional(),
  category: z.string().optional(),
  subCategory: z.string().optional(),
  source: z.string().optional(),
});

export type MetadataForm = z.infer<typeof metadataSchema>;

export function MetadataDialog(props: Props) {
  const { open, setOpen, className } = props;
  const { setStoredFiles, setWidgetMetadata } = useShallowBackendConnectorStore(
    (state) => ({
      setStoredFiles: state.setStoredFiles,
      setWidgetMetadata: state.setWidgetMetadata,
    }),
  );

  const copilot = useShallowCopilotDataStore((state) => ({
    addDataOnDashboardWidget: state.addDataOnDashboardWidget,
    dashboardWidgetsData: state.dashboardWidgetsData,
  }));

  const { getWidgetsByAttribute, storeUpdateWidget } = useShallowAppStore((s) => ({
    getWidgetsByAttribute: s.getWidgetsByAttribute,
    storeUpdateWidget: s.updateWidget,
  }));

  const { widget, activeDashboardId, updateWidget } = useWidgetContext();

  const widgetInfo = useMemo(
    () => processWidgetId(widget.widgetId ?? "", widget.connectionType),
    [widget.widgetId, widget.connectionType],
  );
  const liveWidgetMetadata = useShallowBackendConnectorStore((state) =>
    state.getWidgetMetadataById(widgetInfo.uuid),
  );

  const metadata = useMemo(() => {
    if (widget.connectionType === "widgetMetadata") return liveWidgetMetadata;

    return handleWidgetMetadata<WidgetMetadataItem>(widget);
  }, [liveWidgetMetadata, widget.widgetId, widget.connectionType]);

  const [state, dispatch] = useStateReducer({
    isLoading: false,
  });

  const sourceValue = useMemo(() => {
    if (typeof widget?.source === "string") return widget.source;
    if (Array.isArray(widget?.source)) return widget.source.join(", ");
    return metadata?.source ?? "";
  }, [metadata?.source, widget?.source]);

  const form = useForm<MetadataForm>({
    resolver: zodResolver(metadataSchema),
    defaultValues: {
      name: metadata?.name ?? widget?.name ?? "",
      description: metadata?.description ?? widget?.description ?? "",
      category: metadata?.category ?? widget?.category ?? "",
      subCategory: metadata?.subCategory ?? widget?.subCategory ?? "",
      source: sourceValue,
    },
  });

  // Track previous open state to only reset form when dialog opens, not on background changes
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;

    if (justOpened) {
      form.reset({
        name: metadata?.name ?? widget?.name ?? "",
        description: metadata?.description ?? widget?.description ?? "",
        category: metadata?.category ?? widget?.category ?? "",
        subCategory: metadata?.subCategory ?? widget?.subCategory ?? "",
        source: sourceValue,
      });
    }
  }, [open]);

  const handleSubmit = useCallback(
    async (data: MetadataForm) => {
      dispatchSaveState();
      dispatch({ isLoading: true });
      try {
        let updateOtherDashboardsWidgets = true; // we need this for when creating a metadata item from inside a dashboard. we cannot update all the other elements with widgetId because core widgets created from the search will have widgetId as iframe or html, so they would all be updated which is not what we want
        if (isMetadataType(widget, metadata, "file")) {
          // Handle file widget update
          const cleanData = {
            stored_file_uuid: metadata?.uuid,
            originalFileName: metadata?.originalFileName,
            url: metadata?.url,
            extension: metadata?.extension,
            name: data.name,
            description: data.description,
            category: data.category,
            subCategory: data.subCategory,
            source: data.source,
            dataKey: metadata?.dataKey,
          } as PostFileWidget;

          const { status } = await postFileWidget(widgetInfo.uuid, cleanData);
          if (status !== 200) {
            throw new Error("Failed to update file widget");
          }

          // Update file widgets
          const fileWidgets = await getFileWidgets();
          setStoredFiles(fileWidgets);
        } else {
          const widgetMetadata = {
            name: data.name,
            description: data.description,
            category: data.category,
            subCategory: data.subCategory,
            source: data.source,
            storage: widget.storage,
          } as WidgetMetadataItem;

          if (metadata) {
            const result = await patchWidgetMetadata(widgetMetadata, widgetInfo.uuid);
            if (!result.success) {
              throw new Error("Failed to update widget metadata");
            }
          } else {
            updateOtherDashboardsWidgets = false;
            widgetMetadata.subCategory = undefined;
            const id = uuidv4();

            // TODO: We should be getting the widgetType explicitly from the widget
            const widgetType = widgetInfo.cleanWidgetId as MetaDataWidgetType;
            const result = await postWidgetMetadata({
              ...widgetMetadata,
              widgetId: id,
              widgetType: widgetType,
              subCategory: data.subCategory,
            });
            updateWidget((prev) => ({
              ...prev,
              widgetId: `${widgetType}-${id}`,
              name: data.name,
              description: data.description,
              category: data.category,
              subCategory: data.subCategory,
              source: data.source,
            }));
            if (!result.success) {
              throw new Error("Failed to create widget metadata");
            }
          }
          const updatedMetadata = await getWidgetMetadata();
          setWidgetMetadata(updatedMetadata);
        }

        const updatedFields = {
          name: data.name,
          description: data.description,
          category: data.category,
          subCategory: data.subCategory,
          source: data.source,
        };

        if (updateOtherDashboardsWidgets) {
          const selectedWidgets = getWidgetsByAttribute("widgetId", widget.widgetId);

          for (const [dashId, widgets] of Object.entries(selectedWidgets)) {
            for (const w of widgets) {
              const updatedWidget = {
                ...w,
                ...updatedFields,
              };

              if (activeDashboardId === dashId && w.innerTab === widget.innerTab) {
                dispatchUpdateWidget(w.id, updatedWidget);
                continue;
              }

              storeUpdateWidget(dashId, updatedWidget);
            }
          }
        }

        if (widget.id in copilot.dashboardWidgetsData) {
          const aiWidgetData = copilot.dashboardWidgetsData[widget.id];
          copilot.addDataOnDashboardWidget(widget.id, {
            ...aiWidgetData,
            title: data.name,
            description: data.description,
            metadata: {
              ...(aiWidgetData?.metadata || {}),
              source: data.source,
              category: data.category,
              description: data.description,
            },
          });
        }

        toast.success("Widget metadata updated successfully");
        setOpen(false);
      } catch (error) {
        toast.error("Update Error", {
          description: "An error occurred while updating widget metadata",
        });
      } finally {
        dispatch({ isLoading: false });
      }
    },
    [
      getWidgetsByAttribute,
      storeUpdateWidget,
      metadata,
      setStoredFiles,
      setWidgetMetadata,
      widget,
      setOpen,
    ],
  );

  if (!widget) return null;

  return (
    <BaseDialog
      open={open}
      onClose={() => setOpen(false)}
      focusOnOpen={false}
      className={className}
    >
      <DialogTitle>Edit widget metadata</DialogTitle>
      <DialogDescription>
        By editing the metadata, you will help Copilot to better understand your widget.
      </DialogDescription>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="flex flex-col overflow-hidden flex-1 min-h-0"
        >
          <div className="overflow-y-auto flex-1 min-h-0 flex flex-col gap-2 pr-1">
            <FormField
              name="name"
              control={form.control}
              render={({ field }) => (
                <FormInput label="Name" maxLength={50} {...field} />
              )}
            />
            <FormField
              name="description"
              control={form.control}
              render={({ field }) => (
                <FormTextarea
                  label={
                    <p>
                      Description
                      <span className="text-[#5A5961] italic"> (optional)</span>
                    </p>
                  }
                  {...field}
                />
              )}
            />
            <FormField
              name="category"
              control={form.control}
              render={({ field }) => (
                <FormInput
                  label={
                    <p>
                      Category
                      <span className="text-[#5A5961] italic"> (optional)</span>
                    </p>
                  }
                  {...field}
                />
              )}
            />
            <FormField
              name="subCategory"
              render={({ field }) => (
                <FormInput
                  label={
                    <p>
                      Sub Category
                      <span className="text-[#5A5961] italic"> (optional)</span>
                    </p>
                  }
                  {...field}
                />
              )}
            />
            <FormField
              name="source"
              render={({ field }) => (
                <FormInput
                  maxLength={50}
                  label={
                    <p>
                      Source<span className="text-[#5A5961] italic"> (optional)</span>
                    </p>
                  }
                  {...field}
                />
              )}
            />
          </div>
          <DialogFooter className="pt-4">
            <Button
              variant="outlined"
              size="sm"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button size="sm" type="submit" loading={state.isLoading}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </BaseDialog>
  );
}
