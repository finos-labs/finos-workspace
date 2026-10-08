import { useQueries } from "@tanstack/react-query";
import { uniqueId } from "lodash";
import { useRef } from "react";
import { useDebounceValue, useUpdateEffect } from "usehooks-ts";
import { useStateReducer } from "~/hooks/useStateReducer";
import type { RSSFeed } from "~/lib/constants";
import { getConfig } from "~/lib/runtimeConfig";
import { parseFeedXml } from "~/lib/utils/feedParser";
import DraggableCard from "../DraggableCard";
import { Input } from "../ds/atoms/Input";
import { Tabs, TabsList, TabsTrigger } from "../ds/molecules/Tabs";
import Icon from "../Icon";
import { useWidgetContext } from "../Widget.context";
import ContentTab from "./RssViewerHelpers/ContentTab";
import ManageFeedsTab from "./RssViewerHelpers/ManageFeedsTab";

const rssTabs = ["Content", "Manage Feeds"] as const;
type RssTab = (typeof rssTabs)[number];
const { rssProxy } = getConfig().urls;
const { defaultFeeds } = getConfig().rss;

const RSSViewer = ({ filter = "" }: { filter?: string }) => {
  const { widget, updateWidget } = useWidgetContext();
  const [state, dispatch] = useStateReducer<RSSViewerState>({
    openDialog: false,
    globalFilter: filter,
    selectedTab: rssTabs[0],
    source: "",
    url: "",
    tag: "",
  });

  const [debouncedGlobalFilter] = useDebounceValue(state.globalFilter, 500);
  const inputRef = useRef<HTMLInputElement>(null);

  useUpdateEffect(() => {
    dispatch({ globalFilter: filter });
    // if (inputRef.current) {
    //   inputRef.current.value = filter;
    // }
  }, [filter]);

  const enabledFeeds = (widget?.storage?.feeds ?? []).filter((feed) => feed.enabled);

  const queries = enabledFeeds?.map((feed) => {
    return {
      queryKey: ["feed", feed.url],
      queryFn: () =>
        fetch(rssProxy ? `${rssProxy.replace(/\/+$/, "")}/${feed.url}` : feed.url)
          .then((res) => res.text())
          .then((data) => {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(data, "text/xml");
            const parsedItems = parseFeedXml(xmlDoc);

            return parsedItems.map((item) => {
              // Generate a unique ID for each item, fixes the react duplicate key issue
              const id = uniqueId(`${feed.source}-${feed.url}-${item.title}`);
              return { ...item, feed, id };
            });
          }),
    };
  });

  const results = useQueries({ queries: queries ?? [] });

  const allData = results
    .filter((result) => result.data)
    .reduce<FeedData[]>((acc, { data }) => acc.concat(data ?? []), [])
    .sort((a, b) => {
      const aDate = new Date(a.pubDate ?? 0);
      const bDate = new Date(b.pubDate ?? 0);
      return bDate.getTime() - aDate.getTime();
    });

  function addRssFeedHandler() {
    dispatch({
      selectedTab: "Manage Feeds",
      openDialog: true,
    });
  }

  const aiEnabled = !widget.storage?.disableAI;

  return (
    <DraggableCard
      title={widget.name}
      aiData={allData}
      aiEnabled={aiEnabled}
      showClose={aiEnabled}
      showEllipsisMenu={aiEnabled}
      extraClassName="h-[calc(100%-48px)]!"
      elementNextToTitle={
        <Input
          ref={inputRef}
          size="xs"
          placeholder="Search"
          prefix={<Icon id="search" />}
          value={state.globalFilter}
          onChange={(val) => dispatch({ globalFilter: val.toString() })}
        />
      }
    >
      <Tabs
        variant="filled"
        value={state.selectedTab}
        onValueChange={(selectedTab) =>
          dispatch({ selectedTab: selectedTab as RssTab })
        }
        className="mb-2 flex gap-1 overflow-auto"
      >
        <TabsList>
          {rssTabs.map((value) => (
            <TabsTrigger key={value} value={value}>
              {value}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {state.selectedTab === "Content" ? (
        <ContentTab
          addRssFeedHandler={addRssFeedHandler}
          addDefaults={
            defaultFeeds.length > 0
              ? () =>
                  updateWidget((prev) => ({
                    ...prev,
                    storage: {
                      ...prev.storage,
                      feeds: defaultFeeds,
                    },
                  }))
              : undefined
          }
          allData={allData}
          feeds={widget?.storage?.feeds ?? []}
          globalFilter={debouncedGlobalFilter}
        />
      ) : (
        <ManageFeedsTab
          feeds={widget?.storage?.feeds ?? []}
          state={state}
          dispatch={dispatch}
        />
      )}
    </DraggableCard>
  );
};

export type RSSViewerState = {
  openDialog: boolean;
  globalFilter: string;
  selectedTab: RssTab;
  source: string;
  url: string;
  tag: string;
};

export type FeedData = {
  id: string;
  title: string | null;
  link: string | null;
  pubDate: string | null;
  description: string | null;
  feed: RSSFeed;
  isAtomFeed: boolean;
};

export default RSSViewer;
