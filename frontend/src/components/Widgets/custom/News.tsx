import get from "lodash/get";
import { useCallback, useMemo, useState } from "react";
import { buildNoteWidget } from "~/components/AI/hooks/buildWidget";
import DraggableCard from "~/components/DraggableCard";
import { Input } from "~/components/ds/atoms/Input";
import { BaseDialog } from "~/components/ds/dialogs/BaseDialog";
import { DialogDescription, DialogTitle } from "~/components/ds/dialogs/Dialog";
import { ExternalLinkDialog } from "~/components/ExternalLinkDialog";
import Icon from "~/components/Icon";
import { DecreaseFontSizeIcon, IncreaseFontSizeIcon } from "~/components/Icons";
import Tooltip from "~/components/Tooltip";
import { useWidgetContext } from "~/components/Widget.context";
import { useWidgetParamsPositions } from "~/components/WidgetParams/QueryParams";
import { buildIframeWidget } from "~/components/Widgets/custom/buildIframeWidget";
import { MarkdownContent } from "~/components/Widgets/custom/Markdown";
import { useJsonData } from "~/lib/api";
import { useShallowAppStore } from "~/lib/state/app";
import { cn, formatDate } from "~/lib/utils";
import { buildWidgetRequest } from "~/lib/utils/widgetRequest";

type NewsData = {
  title: string;
  excerpt: string;
  date: string;
  author: string;
  body: string;
};

const DEFAULT_FONT_SIZE = 14;

function formatArticleDate(date: string) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : formatDate(parsed);
}

/** A list of articles from the widget's endpoint; an article opens in a dialog. */
export default function News() {
  const { widget } = useWidgetContext();

  const validEndpoint = !!widget?.endpoint?.url;

  const [popupArticle, setPopupArticle] = useState<NewsData | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const request = useMemo(
    () => buildWidgetRequest(widget),
    [widget.endpoint, widget.params, widget.storage?.params],
  );

  const { data, isLoading, error, dataUpdatedAt } = useJsonData(
    {
      request,
      responseCb: async (response, resolve) => {
        const dataKey = widget?.data?.dataKey;
        const json = await response.json();
        return resolve(dataKey ? get(json, dataKey, json) : json);
      },
    },
    {
      enabled: validEndpoint,
      staleTime: widget?.staleTime ?? 1000 * 60 * 15,
    },
  );

  const articles = useMemo<NewsData[]>(() => (Array.isArray(data) ? data : []), [data]);

  const filteredArticles = useMemo(() => {
    if (!searchQuery) return articles;

    const query = searchQuery.toLowerCase();
    return articles.filter(
      (article) =>
        article.title?.toLowerCase().includes(query) ||
        article.excerpt?.toLowerCase().includes(query),
    );
  }, [articles, searchQuery]);

  const { renderRow0Params, renderBelowNavbarRows } = useWidgetParamsPositions();

  return (
    <DraggableCard
      title={widget.name}
      aiEnabled={true}
      aiData={data}
      elementNextToTitle={
        <Input
          size="xs"
          className="ws-parameter h-5 py-0"
          placeholder="Search articles..."
          value={searchQuery}
          onChange={(value: string) => setSearchQuery(value)}
        />
      }
      elementRightNextToTitle={renderRow0Params}
      elementBelowNavbar={renderBelowNavbarRows}
      lastUpdated={validEndpoint ? dataUpdatedAt : undefined}
      loading={isLoading}
      error={error || articles.length === 0}
      errorMessage={widget?.external ? error?.message : "No results found"}
      extraClassName="flex flex-col divide-y divide-surface-divider"
    >
      <ArticleDialog article={popupArticle} onClose={() => setPopupArticle(null)} />
      {filteredArticles.map((article, index) => (
        <button
          type="button"
          key={`${article.date}-${index}`}
          onClick={() => setPopupArticle(article)}
          className="py-2 first:pt-0 cursor-pointer text-left"
        >
          <div
            className={cn(
              "overflow-x-auto p-0.5 rounded text-xs flex flex-col gap-2 text-left hover:bg-light-100 dark:hover:bg-[#212126]",
            )}
          >
            {article.excerpt?.length > 10 ? (
              <Tooltip message={article.excerpt} className="max-w-[300px]">
                <p className="font-semibold underline text-brand-main dark:text-brand-lighter w-fit">
                  {article.title}
                </p>
              </Tooltip>
            ) : (
              <p className="font-semibold underline text-brand-main dark:text-brand-lighter">
                {article.title}
              </p>
            )}
            <div className="flex items-center gap-2 text-light-500 dark:text-[#A2A2A2]">
              <span>{formatArticleDate(article.date)}</span>
              <span>•</span>
              <span>{article.author}</span>
            </div>
          </div>
        </button>
      ))}
    </DraggableCard>
  );
}

interface ArticleDialogProps {
  article: NewsData | null;
  onClose: () => void;
}

function ArticleDialog({ article, onClose }: ArticleDialogProps) {
  const { widget, activeDashboardId } = useWidgetContext();
  const addWidget = useShallowAppStore((state) => state.addWidget);
  const innerTab = widget?.innerTab;
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [externalLinkDialog, setExternalLinkDialog] = useState({
    open: false,
    url: "",
  });

  const openAsWidget = useCallback(() => {
    if (!article) return;
    const note = buildNoteWidget(article.body, {
      name: article.title,
      description: article.excerpt,
    });
    addWidget(activeDashboardId, { ...note, ...(innerTab ? { innerTab } : {}) });
    onClose();
  }, [article, activeDashboardId, innerTab, addWidget, onClose]);

  const handleExternalLinkClick = useCallback((url: string) => {
    setExternalLinkDialog({ open: true, url });
  }, []);

  return (
    <>
      <BaseDialog
        className="max-h-[80vh] lg:max-w-3xl xl:max-w-5xl"
        open={!!article}
        onClose={onClose}
      >
        {article && (
          <>
            <div className="flex justify-between items-center pr-7 gap-2">
              <DialogTitle className="pr-0">{article.title}</DialogTitle>
              <Tooltip message="Open as a Widget on the Dashboard">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Open as a Widget on the Dashboard"
                  onClick={openAsWidget}
                  className="BB-Button inline-flex items-center justify-center gap-2 rounded-sm ring-offset-background focus-visible:outline-hidden focus-visible:ring-4 disabled:pointer-events-none transition cursor-pointer border border-general-border-primary text-ds-text-subtitle hover:border-general-border-primary hover:text-ds-text-heading focus-visible:ring-general-border-secondary disabled:border-general-border-disabled disabled:text-general-label-disabled body-sm-medium aspect-square p-0 h-5 w-5 border-none"
                >
                  <Icon id="copy-to-file" className="w-4 h-4" />
                </button>
              </Tooltip>
            </div>
            <DialogDescription className="sr-only">{article.excerpt}</DialogDescription>
            <div className="flex gap-4 items-center mt-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label="Decrease font size"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFontSize((size) => size - 1);
                  }}
                  className="p-1 border-light-300 rounded border dark:border-light-600"
                >
                  <DecreaseFontSizeIcon />
                </button>
                <button
                  type="button"
                  aria-label="Increase font size"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFontSize((size) => size + 1);
                  }}
                  className="p-1 border-light-300 rounded border dark:border-light-600"
                >
                  <IncreaseFontSizeIcon />
                </button>
              </div>
              <p className="text-light-500 dark:text-light-400 whitespace-nowrap">
                {formatArticleDate(article.date)}
              </p>
              <p className="text-light-500 dark:text-light-400 whitespace-nowrap">
                Author:{" "}
                <span className="text-brand-main dark:text-brand-lighter">
                  {article.author}
                </span>
              </p>
            </div>
            <div
              className="_article prose dark:prose-invert max-w-none overflow-y-auto"
              style={{ fontSize: `${fontSize}px` }}
            >
              <MarkdownContent
                content={article.body}
                onExternalLinkClick={handleExternalLinkClick}
              />
            </div>
          </>
        )}
      </BaseDialog>
      <ExternalLinkDialog
        open={externalLinkDialog.open}
        onClose={() => setExternalLinkDialog({ open: false, url: "" })}
        url={externalLinkDialog.url}
        onOpenInIframe={(url) =>
          addWidget(activeDashboardId, buildIframeWidget(url, widget.name, innerTab))
        }
        onOpenInNewTab={(url) => window.open(url, "_blank", "noopener,noreferrer")}
      />
    </>
  );
}
