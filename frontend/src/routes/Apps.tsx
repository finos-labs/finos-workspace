import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import Fuse from "fuse.js";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";
import { useLocalStorage } from "usehooks-ts";
import { getApiSources, syncUserApps } from "~/api/auth.api";
import AppsEmptyState from "~/components/Apps/AppsEmptyState";
import {
  isAllBackendsSelected,
  isNoneBackendsSelected,
  type SelectedBackends,
  toggleBackendSelection,
} from "~/components/Apps/backendSelection";
import {
  type AppsFuseKey,
  buildAppsFuseSearchQuery,
  createAppsFuseOptions,
  tokenizeWords,
} from "~/components/Apps/fuseSearch";
import { deleteSourceWidgets } from "~/components/DataConnectors/common/helpers";
import { Button } from "~/components/ds/atoms/Button";
import { Checkbox } from "~/components/ds/atoms/Checkbox";
import { Input } from "~/components/ds/atoms/Input";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "~/components/ds/atoms/Popover";
import { Select, SelectTriggerVariants } from "~/components/ds/atoms/Select";
import { Tag } from "~/components/ds/atoms/Tag";
import { ConfirmDialog } from "~/components/ds/dialogs/ConfirmDialog";
import SearchResultsNotFound from "~/components/General/SearchResultsNotFound";
import Icon from "~/components/Icon";
import AppCard from "~/components/LayoutAuth/AppCard";
import type {
  AppsOptions,
  AppsPageState,
  FilterOption,
  SortOption,
} from "~/components/LayoutAuth/AppCard/types";
import { SettingsLayout } from "~/components/LayoutAuth/Skeleton/SettingsLayout";
import { TabPageFilterGroup, TabPageSearchInput } from "~/components/shared/TabPage";
import { type UnifiedTemplate, useAllTemplates } from "~/hooks/useAllTemplates";

import { useSharedTemplates } from "~/hooks/useSharedTemplates";
import { useStateReducer } from "~/hooks/useStateReducer";
import { useShallowBackendConnectorStore } from "~/lib/state/backendConnector";
import { useShallowUserAppsStore } from "~/lib/state/userApps";
import { cn } from "~/lib/utils";

const BETA_TAG = <Tag color="dark-blue">Beta</Tag>;
const FILTER_OPTIONS: FilterOption[] = [
  { label: "All Apps", value: "all" },
  { label: "My Apps", value: "user" },
  { label: "Shared", value: "shared" },
];

const sortOptions: SortOption[] = [
  { label: "Last Added", value: "newest" },
  { label: "First Added", value: "oldest" },
  { label: "Name A-Z", value: "a-z" },
  { label: "Name Z-A", value: "z-a" },
];

const typeOrder: Record<string, number> = {
  shared: 0,
  generated: 1,
  user: 2,
};

const FUSE_KEYS: AppsFuseKey<UnifiedTemplate>[] = [
  { name: "name", weight: 0.6 },
  { name: "source.name", weight: 0.25 },
  {
    name: "description",
    weight: 0.15,
    tokenize: (template) => tokenizeWords(template.description),
  },
];

const fuseOptions = createAppsFuseOptions(FUSE_KEYS);

export default function AppsPage() {
  return (
    <SettingsLayout
      title="Apps"
      description={
        <>
          Manage your Apps in the{" "}
          <Link
            to="/app/connections"
            className="text-brand-main dark:text-brand-lighter hover:underline"
          >
            Connections page
          </Link>
          .
        </>
      }
      tabs={[]}
      defaultTab="my-apps"
    >
      <MyAppsTab />
    </SettingsLayout>
  );
}

function MyAppsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const backendParam = searchParams.get("backend");

  const inputRef = useRef<HTMLInputElement>(null);
  const backendInputRef = useRef<HTMLInputElement>(null);

  const [options, setOptions] = useLocalStorage<AppsOptions>("apps-options", {
    filterBy: "all",
    sortBy: "newest",
    selectedBackends: null,
  });

  const [state, dispatch] = useStateReducer<AppsPageState>(null, () => ({
    search: "",
    backendSearch: "",
    backendDropdownOpen: false,
    filterOptions: FILTER_OPTIONS,
    showToast: false,
    deleteConfirm: null,
  }));

  const handleSetOptions = useCallback(
    (newOptions: Partial<AppsOptions>) => {
      setOptions((prevOptions) => ({ ...prevOptions, ...newOptions }));
    },
    [setOptions],
  );

  const skipSyncUserApps = useShallowUserAppsStore((state) => state.skipSyncUserApps);

  const { apiSources, updateApiSources } = useShallowBackendConnectorStore((state) => ({
    apiSources: state.apiSources,
    updateApiSources: state.updateApiSources,
  }));

  const { isFetching: isLoadingApiSources, refetch: refetchApiSources } = useQuery({
    queryKey: ["apiSources"],
    queryFn: async () => {
      if (!skipSyncUserApps || state.showToast) syncUserApps();
      return await getApiSources().then(
        async (res) => await updateApiSources(res, state.showToast),
      );
    },
    enabled: true,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
  const { isFetching: isLoadingShared, refetch: refetchShared } = useSharedTemplates({
    enabled: !isLoadingApiSources,
  });
  const allTemplates = useAllTemplates(isLoadingApiSources);

  // Backend filter options - only show active (connected) backends
  const backendOptions = useMemo(() => {
    return apiSources
      .filter((source) => source.status === "success" || source.status === "rehydrated")
      .map((source) => ({
        label: source.name,
        value: source.id,
      }));
  }, [apiSources]);

  const allBackendIds = useMemo(
    () => backendOptions.map((o) => o.value),
    [backendOptions],
  );

  // Filtered backend options based on search
  const filteredBackendOptions = useMemo(() => {
    if (!state.backendSearch.trim()) return backendOptions;
    const searchLower = state.backendSearch.toLowerCase();
    return backendOptions.filter((backend) =>
      backend.label.toLowerCase().includes(searchLower),
    );
  }, [backendOptions, state.backendSearch]);

  // Handle dropdown open/close - clear search when closing
  const handleBackendDropdownChange = useCallback((backendDropdownOpen: boolean) => {
    dispatch({
      backendDropdownOpen,
      backendSearch: (prev) => (backendDropdownOpen ? prev : ""),
    });
  }, []);

  // Pre-select backend from URL param (e.g., from Connections page)
  useEffect(() => {
    if (!backendParam || apiSources.length === 0) return;
    const matchedBackend = apiSources.find(
      (s) => s.id === backendParam || s.uuid === backendParam,
    );
    if (matchedBackend?.id) {
      handleSetOptions({ selectedBackends: [matchedBackend.id] });
      setSearchParams({}, { replace: true });
    }
  }, [backendParam, apiSources, handleSetOptions, setSearchParams]);

  const selectedBackends: SelectedBackends = options.selectedBackends ?? null;

  const allBackendsSelected = isAllBackendsSelected(selectedBackends, allBackendIds);
  const noneBackendsSelected = isNoneBackendsSelected(selectedBackends, allBackendIds);

  // Clean up selected backends if they no longer exist. If none remain, fall
  // back to the "all" sentinel rather than the "none" state (the user did not
  // explicitly clear — their selection was just invalidated).
  useEffect(() => {
    if (selectedBackends === null || selectedBackends.length === 0) return;
    const validBackendIds = new Set(apiSources.map((s) => s.id));
    const validSelected = selectedBackends.filter((id) => validBackendIds.has(id));
    if (validSelected.length !== selectedBackends.length) {
      handleSetOptions({
        selectedBackends: validSelected.length === 0 ? null : validSelected,
      });
    }
  }, [apiSources, selectedBackends, handleSetOptions]);

  // Backend filter display text
  const backendFilterText = useMemo(() => {
    if (selectedBackends === null) return "All Backends";
    if (selectedBackends.length === 0) return "No Backends";
    if (selectedBackends.length === 1) {
      const backend = apiSources.find((s) => s.id === selectedBackends[0]);
      return backend?.name || "1 Backend";
    }
    return `Backends (${selectedBackends.length})`;
  }, [selectedBackends, apiSources]);

  const handleBackendSelect = useCallback(
    (backendId: string, checked: boolean) => {
      handleSetOptions({
        selectedBackends: toggleBackendSelection(
          selectedBackends,
          allBackendIds,
          backendId,
          checked,
        ),
      });
    },
    [selectedBackends, allBackendIds, handleSetOptions],
  );

  // Toggle the "Select All" checkbox:
  //   - all-selected (null) -> [] so the user can pick a single backend without
  //     manually unchecking the rest.
  //   - none / partial -> null (back to "all").
  const handleSelectAllBackends = useCallback(() => {
    handleSetOptions({ selectedBackends: allBackendsSelected ? [] : null });
  }, [allBackendsSelected, handleSetOptions]);

  const invalidateQueries = useCallback(() => {
    dispatch({ showToast: true });
    const onDone = () => dispatch({ showToast: false });
    queueMicrotask(() => {
      refetchApiSources().then(onDone, onDone);
      refetchShared();
    });
  }, [refetchApiSources, refetchShared]);

  const debounceRefetch = useDebouncedCallback(invalidateQueries, 500, {
    leading: true,
    maxWait: 200,
  });

  useEffect(() => {
    if (!(isLoadingApiSources || isLoadingShared)) refetchShared();
  }, []);

  const fuseInstance = useMemo(() => {
    if (!allTemplates.length) return null;
    return new Fuse(allTemplates, fuseOptions);
  }, [allTemplates]);

  const searchQuery = useMemo(
    () => buildAppsFuseSearchQuery(state.search, FUSE_KEYS),
    [state.search],
  );

  const filteredTemplates = useMemo(() => {
    const { filterBy, sortBy } = options;

    const searched =
      searchQuery && fuseInstance
        ? fuseInstance.search(searchQuery).map((r) => r.item)
        : allTemplates;

    return searched
      .filter((template) => {
        const { type } = template;
        // "My Apps" filter includes "user" and "generated"
        const matchesFilter =
          filterBy === "all" ||
          type === filterBy ||
          (filterBy === "user" && type === "generated");
        if (!matchesFilter) return false;

        if (selectedBackends !== null) {
          const templateBackendId = template.source?.id;
          if (!(templateBackendId && selectedBackends.includes(templateBackendId))) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const aUpdatedDate = dayjs(a.source?.createdDate || 0);
        const bUpdatedDate = dayjs(b.source?.createdDate || 0);
        switch (sortBy) {
          case "newest":
            return dayjs(bUpdatedDate).diff(aUpdatedDate);
          case "oldest":
            return dayjs(aUpdatedDate).diff(bUpdatedDate);
          case "a-z":
            return a.name?.localeCompare(b.name || "");
          case "z-a":
            return b.name?.localeCompare(a.name || "");
          default: {
            return typeOrder[a.type] - typeOrder[b.type];
          }
        }
      });
  }, [allTemplates, searchQuery, fuseInstance, options, selectedBackends]);

  const isLoading = isLoadingApiSources || isLoadingShared;
  const showEmptyState =
    !import.meta.env.VITEST && allTemplates.length === 0 && !isLoading;

  if (showEmptyState) {
    return (
      <TabsPrimitive.Content value="my-apps" className="p-6 flex flex-col gap-4">
        <Button
          className="h-8 w-8 self-end"
          variant="secondary"
          loading={isLoading}
          onClick={debounceRefetch}
          loadingChildren={null}
        >
          <Icon
            id="refresh-icon-ds"
            className="w-4 min-w-4 h-4 min-h-4 dark:text-light-100"
          />
        </Button>
        <AppsEmptyState />
      </TabsPrimitive.Content>
    );
  }

  return (
    <TabsPrimitive.Content value="my-apps" className="p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          <TabPageSearchInput
            ref={inputRef}
            placeholder="Search for apps"
            defaultValue={state.search}
            onChange={(search) => {
              dispatch({ search: search as string });
              if (inputRef.current) {
                inputRef.current.value = search as string;
              }
            }}
          />
          <PopoverRoot
            open={state.backendDropdownOpen}
            onOpenChange={handleBackendDropdownChange}
          >
            <PopoverTrigger asChild={true}>
              <button
                type="button"
                className={cn(SelectTriggerVariants({ size: "sm" }), "h-8 w-auto")}
              >
                <span className="truncate text-left">{backendFilterText}</span>
                <Icon
                  id="chevron-down"
                  className="size-4 text-light-600 dark:text-light-400"
                />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[230px] p-2">
              <div className="mb-2">
                <Input
                  ref={backendInputRef}
                  size="sm"
                  placeholder="Search for backends"
                  prefix={<Icon id="search" className="size-3.5" />}
                  defaultValue={state.backendSearch}
                  onChange={(backendSearch: string) => {
                    dispatch({ backendSearch });
                    if (backendInputRef.current) {
                      backendInputRef.current.value = backendSearch;
                    }
                  }}
                  className="h-8 [&_input]:h-8"
                />
              </div>
              <div className="flex flex-col gap-1 max-h-[250px] overflow-y-auto">
                {!state.backendSearch && (
                  <>
                    <label
                      className="flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer
                              body-xs-regular hover:bg-general-bg-primary-hover"
                    >
                      <Checkbox
                        checked={
                          allBackendsSelected
                            ? true
                            : noneBackendsSelected
                              ? false
                              : "indeterminate"
                        }
                        onCheckedChange={() => handleSelectAllBackends()}
                      />
                      <span>Select All</span>
                    </label>
                    {backendOptions.length > 0 && (
                      <div className="my-1 border-b border-general-border-secondary" />
                    )}
                  </>
                )}
                {filteredBackendOptions.map((backend) => (
                  <label
                    key={backend.value}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer
                            body-xs-regular hover:bg-general-bg-primary-hover"
                  >
                    <Checkbox
                      checked={
                        selectedBackends === null
                          ? true
                          : selectedBackends.includes(backend.value)
                      }
                      onCheckedChange={(checked) =>
                        handleBackendSelect(backend.value, checked as boolean)
                      }
                    />
                    <span className="truncate">{backend.label}</span>
                  </label>
                ))}
                {backendOptions.length === 0 && (
                  <div className="px-2 py-1.5 text-light-500 dark:text-dark-200 body-xs-regular">
                    No backends connected
                  </div>
                )}
                {backendOptions.length > 0 && filteredBackendOptions.length === 0 && (
                  <div className="px-2 py-1.5 text-light-500 dark:text-dark-200 body-xs-regular">
                    No backends match your search
                  </div>
                )}
              </div>
            </PopoverContent>
          </PopoverRoot>
          <TabPageFilterGroup>
            <Select
              options={state.filterOptions}
              placeholder="Filter by"
              className="h-8"
              value={options.filterBy}
              onChange={(filterBy: FilterOption["value"]) =>
                handleSetOptions({ filterBy })
              }
            />
            <Select
              options={sortOptions}
              placeholder="Sort by"
              className="h-8"
              value={options.sortBy}
              onChange={(sortBy: SortOption["value"]) => handleSetOptions({ sortBy })}
            />
          </TabPageFilterGroup>
        </div>
        <div className="flex items-center gap-2.5">
          <Button
            className="h-8 w-8"
            variant="secondary"
            loading={isLoading}
            onClick={debounceRefetch}
            loadingChildren={null}
          >
            <Icon
              id="refresh-icon-ds"
              className="w-4 min-w-4 h-4 min-h-4 dark:text-light-100"
            />
          </Button>
        </div>
      </div>
      <div
        className={cn(
          "grid-cols-[repeat(auto-fill,minmax(min(250px,280px),1fr))] gap-4",
          { grid: filteredTemplates.length > 0 },
        )}
      >
        {filteredTemplates.length === 0 ? (
          <SearchResultsNotFound
            extraClassName="col-span-full dark:bg-dark-800 bg-light-50 py-60 rounded"
            icon={true}
            firstMessage="No apps found"
            secondMessage={
              options.filterBy !== "all" || selectedBackends !== null
                ? "Try updating the filters to find different apps."
                : state.search
                  ? "Try searching for a different app."
                  : undefined
            }
          />
        ) : (
          filteredTemplates.map((template, index) => (
            <AppCard
              key={`${template.id}-${index}`}
              template={template}
              setDeleteConfirm={(deleteConfirm) => dispatch({ deleteConfirm })}
            />
          ))
        )}
      </div>

      {state.deleteConfirm && (
        <DeleteConfirmDialog
          {...state.deleteConfirm}
          onClose={() => dispatch({ deleteConfirm: null })}
        />
      )}
    </TabsPrimitive.Content>
  );
}

type DeleteConfirmDialogProps = AppsPageState["deleteConfirm"] & {
  onClose: () => void;
};

const DeleteConfirmDialog = memo((props: DeleteConfirmDialogProps) => {
  const { template, type, onClose } = props;

  const { source, deleteApiSource } = useShallowBackendConnectorStore((s) => {
    const sourceId = template.source?.id;

    return {
      source: sourceId ? s.getApiSourceById(sourceId) : null,
      deleteApiSource: s.deleteApiSource,
    };
  });

  const [state, dispatch] = useStateReducer({
    isDeleting: false,
  });

  const backendAppsCount = useMemo(() => {
    if (!source) return 0;
    return source.templates?.length || 0;
  }, [source]);

  const handleDeleteBackend = useCallback(async () => {
    if (!source) return;

    dispatch({ isDeleting: true });
    try {
      deleteSourceWidgets(source);
      await deleteApiSource(source);

      toast.success(
        backendAppsCount > 1
          ? `Backend and ${backendAppsCount} apps deleted successfully`
          : "Backend deleted successfully",
      );
      onClose?.();
    } catch (error) {
      console.error(error);
      toast.error("Failed to delete backend");
    } finally {
      dispatch({ isDeleting: false });
    }
  }, [source, deleteApiSource, backendAppsCount, onClose]);

  return (
    <>
      {template.type === "generated" && template.onDelete && (
        <ConfirmDialog
          open={type === "app"}
          onClose={onClose}
          title="Delete App"
          description={
            <span className="block text-light-600 dark:text-dark-50">
              Are you sure you want to delete{" "}
              <span className="font-medium text-light-900 dark:text-light-100">
                {template.name}
              </span>
              ? This action cannot be undone.
            </span>
          }
          confirmButton={
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                try {
                  await template.onDelete?.();
                } catch (error) {
                  console.error(error);
                  return toast.error("Failed to delete app");
                }
                onClose();
              }}
            >
              Delete
            </Button>
          }
          cancelText="Cancel"
        />
      )}

      {template.type !== "generated" && source && (
        <ConfirmDialog
          open={type === "backend"}
          onClose={onClose}
          title="Delete Backend"
          description={
            <span className="flex flex-col gap-3">
              <span className="block text-light-600 dark:text-dark-50">
                Are you sure you want to delete the backend{" "}
                <span className="font-medium text-light-900 dark:text-light-100">
                  {source.name}
                </span>
                ?
              </span>
              {backendAppsCount > 1 && (
                <span className="block text-light-600 dark:text-dark-50">
                  This will delete{" "}
                  <span className="font-medium text-light-900 dark:text-light-100">
                    {backendAppsCount} apps
                  </span>{" "}
                  associated with this backend.
                </span>
              )}
              <span className="flex flex-col gap-2 text-amber-500 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-md border-[1.5px] border-amber-700 dark:border-amber-700">
                <span className="flex items-center gap-2">
                  <Icon
                    id="warning-icon"
                    className="h-4 w-4 flex-shrink-0 text-amber-500"
                  />
                  <span className="font-bold text-light-800 dark:text-white leading-[18px]">
                    Warning
                  </span>
                </span>
                <span className="block text-light-800 dark:text-white">
                  Widgets already added to dashboards will be disabled. This action
                  cannot be undone.
                </span>
              </span>
            </span>
          }
          confirmButton={
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteBackend}
              loading={state.isDeleting}
              disabled={state.isDeleting}
            >
              Yes, Delete
            </Button>
          }
          cancelText="Cancel"
        />
      )}
    </>
  );
});
