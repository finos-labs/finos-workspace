import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { getApiSources, postApiSource } from "~/api/auth.api";
import { EndpointHeadersForm } from "~/components/DataConnectors/EndpointHeadersForm";
import { Button } from "~/components/ds/atoms/Button";
import { FormInput } from "~/components/ds/atoms/Input";
import { FormSelect } from "~/components/ds/atoms/Select";
import { BaseDialog } from "~/components/ds/dialogs/BaseDialog";
import { DialogDescription, DialogTitle } from "~/components/ds/dialogs/Dialog";
import { Form, FormField } from "~/components/ds/molecules/Form";
import { Notice } from "~/components/ds/molecules/Notice";
import Icon from "~/components/Icon";
import { useStateReducer } from "~/hooks/useStateReducer";
import { useAppStore } from "~/lib/state/app";
import {
  type Source,
  useShallowBackendConnectorStore,
} from "~/lib/state/backendConnector";
import { useShallowThemeStore } from "~/lib/state/theme";
import { cn, dispatchSaveState } from "~/lib/utils";
import { createCustomTemplateTab } from "~/lib/utils/createTemplates";
import { toError } from "~/lib/utils/utils";
import { validateSource } from "~/lib/utils/validateBackend";
import {
  formatBackendErrorMessage,
  formatBackendWarningMessage,
  formatZodErrorMessage,
} from "~/utils/zodErrors";
import { updateWidgetEndpoints } from "../DataConnectors/common/helpers";
import { motionElemProps } from "../ds/atoms/collapsible-motion";

const AppSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().min(1, "This field is required"),
  url: z.url().min(1, "This field is required"),
  endpointHeaders: z
    .array(
      z.object({
        key: z.string().min(1, "This field is required"),
        value: z.string().min(1, "This field is required"),
        location: z.enum(["headers", "query"]).default("headers").optional(),
      }),
    )
    .optional(),
  validateWidgets: z.string().default("false").optional(),
});

type AppForm = z.infer<typeof AppSchema>;

const initialState = {
  loading: false,
  saveLoading: false,
  isSuccess: false,
  message: null as null | string,
  errorMessage: null as null | string,
  templateErrorMessage: null as null | string,
  templateWarningMessage: null as null | string,
  uncheckedRoutes: [] as string[],
  backendToAdd: null as Partial<Source> | null,
  isLocalhost: false,
  isConnected: false,
  hasTestedInSession: false,
};

const getInitialState = () => ({ ...initialState });

type AppDialogState = typeof initialState;

export default function ManageAppDialog() {
  const { manageAppDialog, setManageAppDialog, setManageAppsDialogOpen } =
    useShallowThemeStore((state) => ({
      manageAppDialog: state.manageAppDialog,
      setManageAppDialog: state.setManageAppDialog,
      setManageAppsDialogOpen: state.setManageAppsDialogOpen,
    }));

  const { updateApiSource, checkExistingBackend, addApiSource } =
    useShallowBackendConnectorStore((state) => ({
      updateApiSource: state.updateApiSource,
      checkExistingBackend: state.checkExistingBackend,
      addApiSource: state.addApiSource,
    }));

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { add, name, url, modeTitle } = useMemo(() => {
    const add = searchParams.get("modal") === "connect-backend";
    const name = searchParams.get("name");
    const url = searchParams.get("url");

    const modeTitle = manageAppDialog.mode.replace("edit", "update");
    return { add, name, url, modeTitle };
  }, [
    searchParams.get("modal"),
    searchParams.get("name"),
    searchParams.get("url"),
    manageAppDialog.mode,
  ]);

  const [state, dispatch] = useStateReducer<AppDialogState>(null, getInitialState);

  const form = useForm({
    resolver: zodResolver(AppSchema),
    defaultValues: {
      id: undefined,
      name: name || "",
      url: url || "",
      endpointHeaders: [],
      validateWidgets: "false",
    },
  });

  useEffect(() => {
    const source = manageAppDialog?.data;
    form.reset({
      id: source?.id || undefined,
      name: name || source?.name || "",
      url: url || source?.url || "",
      endpointHeaders: source?.endpointHeaders || [],
      validateWidgets: "false",
    });
    dispatch({ isConnected: manageAppDialog.data?.status === "success" });
  }, [manageAppDialog.data]);

  const closeDialog = useCallback(() => {
    const wasActive = manageAppDialog.data?.status === "success";
    const testFailed =
      state.errorMessage !== null || state.templateErrorMessage !== null;
    const editedSource = manageAppDialog.data;
    const isEditMode = manageAppDialog.mode === "edit" && editedSource?.id;

    if (
      editedSource &&
      isEditMode &&
      wasActive &&
      testFailed &&
      state.hasTestedInSession
    ) {
      addApiSource({ ...editedSource, status: "error" });
      toast.error("Backend marked as inactive", {
        description: "The connection test failed.",
      });
    }

    const newParams = new URLSearchParams(searchParams);
    newParams.delete("modal");
    newParams.delete("name");
    newParams.delete("url");
    setSearchParams(newParams);
    setManageAppDialog({ isOpen: false, data: null });
    form.reset({
      id: undefined,
      name: "",
      url: "",
      endpointHeaders: [],
      validateWidgets: "false",
    });
    dispatch(getInitialState());
  }, [
    setManageAppDialog,
    setSearchParams,
    searchParams,
    manageAppDialog.data,
    manageAppDialog.mode,
    state.errorMessage,
    state.templateErrorMessage,
    state.hasTestedInSession,
    addApiSource,
  ]);

  const onFieldChange = useCallback(
    (params: { name?: string; url?: string }) => {
      const { id, url, name } = { ...form.getValues(), ...params };

      const generalError = checkExistingBackend({
        name: name ?? "",
        url: url ?? "",
        id: id ?? "",
      });
      for (const field of ["name", "url"] as const) {
        if (params[field] !== undefined) {
          if (!generalError?.[field]) return form.clearErrors(field);
          form.setError(field, {
            message: generalError[field] || "",
            type: "validate",
          });
          dispatch({ isSuccess: false });
        }
      }
    },
    [form.setError, form.getValues, checkExistingBackend],
  );

  const onSubmit = useCallback(
    async ({ name, url, endpointHeaders, validateWidgets }: AppForm) => {
      const newstate = getInitialState();
      newstate.isLocalhost = ["localhost", "127.0.0.1"].some((host) =>
        url.includes(host),
      );

      dispatch({ ...newstate, loading: true, hasTestedInSession: true });

      try {
        const cleanUrl = url.trim().replace(/\/+$/, "").trim();
        const source = { name, url: cleanUrl, endpointHeaders } as Source;

        const {
          widgets,
          errorMessage,
          templateErrorMessage,
          templateWarningMessage,
          totalFailed,
          templates,
          uncheckedRoutes = [],
        } = await validateSource(source, validateWidgets === "true");

        const widgetsCount = Object.keys(widgets).length;

        const appsCount = templates?.length || 0;
        const failed = totalFailed > 0 ? `, ${totalFailed} failed` : "";

        const { promptsCount, mcpCount } = templates?.reduce(
          (acc, template) => {
            acc.promptsCount += template.prompts?.length || 0;
            acc.mcpCount += template.mcpServers?.length || 0;
            return acc;
          },
          { promptsCount: 0, mcpCount: 0 },
        ) ?? { promptsCount: 0, mcpCount: 0 };

        const messageParts = [
          `${widgetsCount} ${widgetsCount === 1 ? "Widget" : "Widgets"} found${failed}`,
          `${appsCount} ${appsCount === 1 ? "App" : "Apps"} found`,
          `${promptsCount} ${promptsCount === 1 ? "Prompt" : "Prompts"} found`,
        ];
        if (mcpCount > 0) {
          messageParts.push(
            `${mcpCount} MCP ${mcpCount === 1 ? "Server" : "Servers"} found`,
          );
        }
        const detailedMessage = `${messageParts.join(", ")}.`;

        const isSuccess = !(errorMessage || templateErrorMessage);

        Object.assign(newstate, {
          isConnected: isSuccess,
          message: detailedMessage,
          errorMessage: errorMessage || null,
          templateErrorMessage: templateErrorMessage || null,
          templateWarningMessage: templateWarningMessage || null,
          uncheckedRoutes,
          isSuccess,
          backendToAdd: {
            name,
            url: cleanUrl,
            widgets,
            endpointHeaders,
          },
        });
      } catch (err) {
        const { message } = toError(err);
        newstate.errorMessage =
          message === "Failed to fetch"
            ? "Unknown error occurred, check your API console for more detailed error message"
            : message;
      } finally {
        dispatch({ ...newstate, loading: false });
      }
    },
    [],
  );

  const onSaveApp = useCallback(async () => {
    if (!(state.backendToAdd || form.formState.isDirty)) return;
    const { id, name: prevName } = manageAppDialog.data ?? {};

    const source = form.formState.isDirty ? form.getValues() : state.backendToAdd;
    if (!source) return;

    const name = source.name ?? "";
    const url = (source.url ?? "").trim().replace(/\/+$/, "").trim();
    const endpointHeaders = source.endpointHeaders ?? [];
    const data = { name, url, endpointHeaders };

    const appId = id ?? uuidv4();
    try {
      dispatch({ saveLoading: true });
      const { status } = await postApiSource(appId, data);

      if (status !== 200) {
        toast.error("Something went wrong. Please try again.", {
          description: "Unknown error",
        });
        dispatch({ saveLoading: false });
        return;
      }

      dispatchSaveState();

      const result = (await getApiSources()).find((source) => source.id === appId);
      const updatedSource = result || ({ id: appId, ...data } as Source);

      const { templates, widgets, errorMessage } = await updateApiSource(
        updatedSource,
        true,
      );
      Object.assign(updatedSource, {
        templates,
        widgets,
        status: errorMessage ? "error" : "success",
      });

      if (id) {
        updateWidgetEndpoints({ ...data, widgets, id, prevName });
        dispatchSaveState();

        const wasInactive = manageAppDialog.data?.status === "error";
        const isNowActive = !errorMessage;
        if (wasInactive && isNowActive) {
          toast.success("Backend activated successfully");
        } else {
          toast.success("Backend updated successfully");
        }
        closeDialog();
        return;
      }

      const widgetsCount = Object.keys(widgets).length;
      const appsCount = templates?.length || 0;
      const promptsCount = templates?.reduce(
        (count, template) => count + (template.prompts?.length || 0),
        0,
      );

      if (templates.length > 0) {
        const modeText = modeTitle === "add" ? "added" : "updated";
        toast.success(`Backend ${modeText} successfully`, {
          description: `Found ${widgetsCount} widgets, ${appsCount} apps, and ${promptsCount} prompts`,
          action: {
            label: `Open App${templates.length > 1 ? "s" : ""}`,
            onClick: () => {
              const { items, addTab } = useAppStore.getState();
              for (const template of templates) {
                createCustomTemplateTab({
                  items,
                  addTab,
                  template,
                  source: updatedSource,
                  navigate,
                });
              }
            },
          },
        });
      }

      setManageAppsDialogOpen(false);
      closeDialog();
    } catch (error) {
      console.error(error);
      dispatch({ saveLoading: false });
      toast.error(`Failed to ${id ? "update" : "add"} app`);
    }
  }, [
    state.backendToAdd,
    manageAppDialog.data,
    modeTitle,
    updateApiSource,
    closeDialog,
    setManageAppsDialogOpen,
    navigate,
    form.formState.isDirty,
    form.getValues,
    postApiSource,
  ]);

  const handleAddPair = useCallback(() => {
    const endpointHeaders = form.getValues("endpointHeaders");
    form.setValue(
      "endpointHeaders",
      [...(endpointHeaders || []), { key: "", value: "", location: "headers" }],
      { shouldValidate: false },
    );
  }, [form.getValues, form.setValue]);

  return (
    <BaseDialog
      open={manageAppDialog.isOpen || add}
      onClose={closeDialog}
      className="max-h-[80vh] lg:w-[580px] sm:max-w-[580px] sm:max-h-[90vh]"
    >
      <DialogTitle>
        {manageAppDialog.mode === "add" ? "Connect backend" : "Edit backend"}
      </DialogTitle>
      <DialogDescription
        className={cn("", {
          "sr-only": manageAppDialog.mode === "edit",
        })}
      >
        {manageAppDialog.mode === "add" ? (
          <>Integrate your application (widgets and prompts) but also your agents.</>
        ) : (
          "Edit existing backend"
        )}
      </DialogDescription>

      <Form {...form}>
        <form
          id="manage-app-form"
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-2 text-xs max-h-[calc(100%-100px)] overflow-y-auto pr-2"
        >
          <FormField
            name="name"
            control={form.control}
            render={({ field }) => (
              <FormInput
                label="Name"
                placeholder="App"
                {...field}
                onChange={(name: string) => {
                  onFieldChange({ name });
                  field.onChange(name);
                }}
              />
            )}
          />
          <FormField
            name="url"
            control={form.control}
            render={({ field }) => (
              <FormInput
                label="Endpoint URL"
                placeholder="http://127.0.0.1:5056"
                {...field}
                onChange={(url: string) => {
                  if (manageAppDialog.data?.url && url !== manageAppDialog.data.url) {
                    dispatch({ isSuccess: false });
                  }
                  onFieldChange({ url });
                  field.onChange(url);
                }}
              />
            )}
          />
          <FormField
            name="validateWidgets"
            control={form.control}
            render={({ field }) => (
              <FormSelect
                label="Validate widgets"
                options={[
                  {
                    label: "Yes",
                    value: "true",
                  },
                  {
                    label: "No",
                    value: "false",
                  },
                ]}
                {...field}
              />
            )}
          />

          <EndpointHeadersForm connectionType="advanced" />

          {state.templateWarningMessage && (
            <Notice
              variant="warning"
              title="Warning"
              className="mt-2 w-[560px] max-w-full"
            >
              {formatBackendWarningMessage(
                state.templateWarningMessage,
                "!text-ds-text-body",
                "!text-ds-text-body",
              )}
            </Notice>
          )}

          {state.uncheckedRoutes.length > 0 && (
            <Notice
              variant="warning"
              title="Not every route was checked"
              className="mt-2 w-[560px] max-w-full"
            >
              <ul className="list-disc pl-4">
                {state.uncheckedRoutes.map((line) => (
                  <li key={line}>
                    {formatZodErrorMessage(line, "!text-ds-text-body")}
                  </li>
                ))}
              </ul>
            </Notice>
          )}

          {state.isSuccess && (
            <Notice
              variant="success"
              title="Test successful"
              className="mt-2 mb-4 w-[560px] max-w-full"
            >
              {state.message}
            </Notice>
          )}

          {(state.errorMessage || state.templateErrorMessage) && (
            <Notice
              variant="error"
              title="Error"
              className="mt-2 mb-2 w-[560px] max-w-full"
            >
              {formatBackendErrorMessage(
                state.errorMessage,
                state.templateErrorMessage,
                "!text-ds-text-body",
                "!text-ds-text-body",
              )}
              {state.errorMessage?.includes("(Status: ") && state.isLocalhost && (
                <TroubleshootMessage />
              )}
            </Notice>
          )}
        </form>
      </Form>

      <div className="mt-6 flex flex-col gap-3">
        <div className="flex justify-between">
          <Button
            type="button"
            onClick={handleAddPair}
            variant="outlined"
            size="sm"
            className="whitespace-nowrap"
          >
            <Icon id="plus-icon" className="h-4 w-4 mr-1" />
            Add Authentication
          </Button>
          <div className="flex gap-2">
            <Button
              className="[&_svg]:h-4"
              disabled={
                form.formState?.errors?.url !== undefined ||
                form.formState?.errors?.name !== undefined ||
                !form.formState.isValid ||
                state.loading
              }
              onClick={() => onSubmit(form.getValues())}
              loading={state.loading}
              size="sm"
              variant="secondary"
            >
              Test
            </Button>
            <Button
              disabled={
                !form.formState.isValid ||
                state.loading ||
                !(state.isSuccess || manageAppDialog.data?.id) ||
                (!!manageAppDialog.data?.id &&
                  (form.formState.dirtyFields?.url
                    ? !state.isSuccess
                    : !(form.formState.isDirty && state.isConnected)))
              }
              onClick={
                form.formState.isDirty || state.isSuccess ? onSaveApp : closeDialog
              }
              loading={state.saveLoading}
              size="sm"
              className="capitalize"
              variant="primary"
            >
              {modeTitle}
            </Button>
          </div>
        </div>
      </div>
    </BaseDialog>
  );
}

export function TroubleshootMessage() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const duration = 300;
      let startTime: number | null = null;
      const element = document.getElementById("manage-app-form");

      const animateScroll = (timestamp: number) => {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / duration, 1);

        const easeOutCubic = 1 - (1 - progress) ** 3;

        if (element) {
          const start = element.scrollTop;
          const target = element.scrollHeight - element.clientHeight;
          const distance = target - start;
          element.scrollTop = start + distance * easeOutCubic;
        }

        if (progress < 1) {
          requestAnimationFrame(animateScroll);
        }
      };

      requestAnimationFrame(animateScroll);
    }
  }, [isOpen]);

  return (
    <div className="mt-3 pt-3 border-t border-error-100/25 w-full">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity w-full"
      >
        <Icon
          id="chevron-right"
          className={cn(
            "h-4 w-4 text-ds-text-caption transition-transform",
            isOpen && "rotate-90",
          )}
        />
        <p className="text-xs text-ds-text-subtitle font-semibold">
          Troubleshooting localhost
        </p>
      </button>

      <AnimatePresence initial={false}>
        <motion.div
          className="min-h-0 mt-3"
          {...motionElemProps}
          animate={isOpen ? "enter" : "exit"}
        >
          <ul className="text-xs text-ds-text-body space-y-2 text-left list-none pl-0 w-full">
            <li className="flex items-start gap-2">
              <span className="text-error-100/60 mt-0.5 flex-shrink-0">•</span>
              <div className="flex-1 text-left">
                <p className="font-medium mb-1 text-ds-text-subtitle text-left">
                  Address Not Reachable
                </p>
                <p className="text-ds-text-body text-left">
                  The FINOS Workspace API calls your backend, not your browser. When the
                  API runs in a container, it reaches{" "}
                  <code className="bg-general-bg-secondary px-1 py-0.5 rounded text-[11px]">
                    localhost
                  </code>{" "}
                  on your computer through{" "}
                  <code className="bg-general-bg-secondary px-1 py-0.5 rounded text-[11px]">
                    host.docker.internal
                  </code>
                  , so the backend has to be running. On Linux it also has to listen on
                  0.0.0.0 instead of 127.0.0.1.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-error-100/60 mt-0.5 flex-shrink-0">•</span>
              <div className="flex-1 text-left">
                <p className="font-medium mb-1 text-ds-text-subtitle text-left">
                  HTML Response Instead of JSON
                </p>
                <p className="text-ds-text-body text-left">
                  If you're seeing "Unexpected token '&lt;'", your server is returning
                  an HTML page instead of JSON. This often happens when: the URL is
                  incorrect, the server is returning an error page, or the endpoint
                  doesn't exist. Verify your URL points to the correct API endpoint.
                </p>
              </div>
            </li>
          </ul>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
