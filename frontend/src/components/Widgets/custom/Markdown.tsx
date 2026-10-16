import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";
import get from "lodash/get";
import mammoth from "mammoth";
import MarkdownToJSX from "markdown-to-jsx";
import {
  type ComponentProps,
  type ElementType,
  lazy,
  type MouseEvent,
  memo,
  type ReactNode,
  Suspense,
  useCallback,
  useMemo,
  useState,
} from "react";
import DraggableCard from "~/components/DraggableCard";
import { ExternalLinkDialog } from "~/components/ExternalLinkDialog";
import { InlineMath } from "~/components/Tex";
import { useWidgetContext } from "~/components/Widget.context";
import { useWidgetParamsPositions } from "~/components/WidgetParams/QueryParams";
import { buildIframeWidget } from "~/components/Widgets/custom/buildIframeWidget";
import { useJsonData } from "~/lib/api";
import { useShallowAppStore } from "~/lib/state/app";
import { useSourceCredentials } from "~/lib/state/backendConnector";
import type { ArtifactT, Citation as CitationT } from "~/lib/state/copilot";
import { useShallowThemeStore } from "~/lib/state/theme";
import { protectAiMarkers } from "~/lib/utils/citationMarkers";
import { HTML_SANITIZE_CONFIG } from "~/lib/utils/sanitize";

const AICitation = lazy(() => import("~/components/AI/Citation"));
const AIArtifact = lazy(() => import("~/components/AI/Artifact"));

const EMPTY_CITATIONS: CitationT[] = [];
const EMPTY_ARTIFACTS: ArtifactT[] = [];

interface AiMarkerProps {
  className?: string;
  children?: ReactNode[];
}

const CitationMarker = memo(
  ({
    className,
    children,
    citations = EMPTY_CITATIONS,
  }: AiMarkerProps & { citations?: CitationT[] }) => {
    const citationId = normalizeMarkerId(className || children?.[0] || "");
    const index = citations.findIndex((citation) => citation.id === citationId);

    if (index === -1) return null;

    return (
      <Suspense fallback={null}>
        <AICitation key={citationId} index={index} content={citations[index]} />
      </Suspense>
    );
  },
  (p, n) =>
    p.className === n.className &&
    p.children === n.children &&
    p.citations === n.citations,
);

const ArtifactMarker = memo(
  ({
    className,
    children,
    artifacts = EMPTY_ARTIFACTS,
  }: AiMarkerProps & { artifacts?: ArtifactT[] }) => {
    const artifactId = normalizeMarkerId(className || children?.[0] || "");
    if (!artifactId) return null;

    const artifact = artifacts.find(
      (artifact) => artifact.name === artifactId || artifact.uuid === artifactId,
    );

    if (!artifact) return null;

    return (
      <Suspense fallback={null}>
        <div className="py-2">
          <AIArtifact artifact={artifact} inAiMessage={true} />
        </div>
      </Suspense>
    );
  },
  (p, n) =>
    p.className === n.className &&
    p.children === n.children &&
    p.artifacts === n.artifacts,
);

function getCitations(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((citation): citation is CitationT => !!citation?.id);
}

function getArtifacts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (artifact): artifact is ArtifactT =>
      !!artifact &&
      typeof artifact === "object" &&
      "type" in artifact &&
      "content" in artifact,
  );
}

function normalizeMarkerId(value: unknown) {
  return String(value ?? "").replace(/\\/g, "");
}

async function convertDocxToHtml(docx: ArrayBuffer) {
  try {
    const result = await mammoth.convertToHtml(
      {
        arrayBuffer: docx,
      },
      {
        convertImage: mammoth.images.imgElement((image) =>
          image.read("base64").then((imageBuffer) => ({
            src: `data:${image.contentType};base64,${imageBuffer}`,
            alt: "",
          })),
        ),
        ignoreEmptyParagraphs: true,
      },
    );
    return result.value;
  } catch (error) {
    console.error("Error converting .docx to HTML:", error);
    return "";
  }
}

// backend can't have space idents in the markdown otherwise it will render as a code block
// we need to add this to the docs
export default function Markdown() {
  const addWidget = useShallowAppStore((state) => state.addWidget);
  const { widget, activeDashboardId } = useWidgetContext();
  const theme = useShallowThemeStore((s) => s.theme);
  const [externalLinkDialog, setExternalLinkDialog] = useState<{
    open: boolean;
    url: string;
  }>({ open: false, url: "" });

  const extension = useMemo(
    () => widget.endpoint?.url?.split(".")?.pop(),
    [widget.endpoint?.url],
  );
  const validEndpoint = !!widget?.endpoint?.url;
  const credentials = useSourceCredentials(widget.sourceId, widget.endpoint?.url);

  const options = useMemo(() => {
    const endpoint = widget.endpoint;
    const newParams = Object.fromEntries(
      Object.entries({
        ...credentials.query,
        ...(widget?.storage?.params ?? {}),
      }).filter(([_key, value]) => value !== "" && value !== undefined),
    );

    newParams.theme = theme;

    return {
      url: endpoint?.url ?? "",
      endpointHeaders: credentials.headers,
      method: endpoint?.method ?? "GET",
      params: newParams,
    };
  }, [widget?.endpoint, widget?.storage?.params, theme, credentials]);

  const { data, isLoading, error, dataUpdatedAt } = useJsonData(
    {
      ...options,
      responseCb: async (data, resolve) => {
        const clonedData = data.clone();
        if (extension === "docx") {
          return resolve(convertDocxToHtml(await data.arrayBuffer()));
        }
        if (extension === "md") {
          return resolve(await data.text());
        }
        const dataKey = widget?.data?.dataKey;
        try {
          const jsonData = await data.json();
          return resolve(dataKey ? get(jsonData, dataKey, jsonData) : jsonData);
        } catch {
          return resolve(await clonedData.text());
        }
      },
    },
    {
      enabled: validEndpoint,
      staleTime: widget?.staleTime ?? 1000 * 60 * 15,
    },
  );

  // Without an endpoint the widget holds its own text (what the Copilot wrote), which can change.
  const body = validEndpoint ? data : widget.storage?.text;

  const markdownPayload = useMemo(() => {
    return {
      content: typeof body === "string" ? body : (widget.storage?.text ?? ""),
      citations: getCitations(widget.storage?.citations),
      artifacts: getArtifacts(widget.storage?.artifacts),
    };
  }, [
    body,
    widget.storage?.text,
    widget.storage?.citations,
    widget.storage?.artifacts,
  ]);

  const handleExternalLinkClick = useCallback((url: string) => {
    setExternalLinkDialog({ open: true, url });
  }, []);

  const handleOpenInIframe = useCallback(
    (url: string) => {
      addWidget(
        activeDashboardId,
        buildIframeWidget(url, widget.name, widget?.innerTab),
      );
    },
    [addWidget, activeDashboardId, widget.name, widget?.innerTab],
  );

  const handleOpenInNewTab = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const { renderRow0Params, renderBelowNavbarRows } = useWidgetParamsPositions();

  return (
    <>
      <DraggableCard
        elementBelowNavbar={renderBelowNavbarRows}
        title={widget.name}
        aiEnabled={true}
        aiData={body}
        elementRightNextToTitle={renderRow0Params}
        lastUpdated={validEndpoint ? dataUpdatedAt : undefined}
        loading={isLoading}
        error={error || !body}
        errorMessage={widget?.external ? error?.message : "No results found"}
      >
        <div className="prose-sm text-xs! prose-p:my-1.5 p-2.5 pb-4 prose dark:prose-invert max-w-none">
          <MarkdownContent
            extension={extension}
            content={markdownPayload.content}
            citations={markdownPayload.citations}
            artifacts={markdownPayload.artifacts}
            onExternalLinkClick={handleExternalLinkClick}
          />
        </div>
      </DraggableCard>

      <ExternalLinkDialog
        open={externalLinkDialog.open}
        onClose={() => setExternalLinkDialog({ open: false, url: "" })}
        url={externalLinkDialog.url}
        onOpenInIframe={handleOpenInIframe}
        onOpenInNewTab={handleOpenInNewTab}
      />
    </>
  );
}

interface CustomOverrides {
  [key: string]: {
    component: ElementType;
    props?: Record<string, unknown>;
  };
}

export interface MarkdownContentProps {
  extension?: string;
  content: string;
  citations?: CitationT[];
  artifacts?: ArtifactT[];
  sanitizeOptions?: DOMPurifyConfig;
  customOverrides?: CustomOverrides;
  onExternalLinkClick?: (url: string) => void;
}

export function MarkdownContent({
  extension,
  content,
  citations = EMPTY_CITATIONS,
  artifacts = EMPTY_ARTIFACTS,
  sanitizeOptions = {},
  customOverrides = {},
  onExternalLinkClick,
}: MarkdownContentProps) {
  const hasAiMarkers = citations.length > 0 || artifacts.length > 0;

  const sanitizedContent = useMemo(() => {
    if (!content) return "";

    const sanitize = (text: string) =>
      DOMPurify.sanitize(text, {
        ...HTML_SANITIZE_CONFIG,
        ALLOW_SELF_CLOSE_IN_ATTR: extension === "docx",
        ...sanitizeOptions,
      });

    if (!hasAiMarkers) return sanitize(content);

    const { protectedText, restoreAiMarkers } = protectAiMarkers(content);
    return restoreAiMarkers(sanitize(protectedText));
  }, [content, extension, sanitizeOptions, hasAiMarkers]);

  const markdownOptions = useMemo(
    () => ({
      overrides: {
        citation: {
          component: CitationMarker,
          props: { citations },
        },
        artifact: {
          component: ArtifactMarker,
          props: { artifacts },
        },
        latex: (props: { children?: string[] }) => {
          const childStr = props?.children?.[0] ?? "";
          const sanitizedLatex = DOMPurify.sanitize(childStr, {
            ALLOWED_TAGS: [],
            ALLOWED_ATTR: [],
          });
          return <InlineMath math={sanitizedLatex} />;
        },
        a: {
          component: ({ children, href }: { children: ReactNode; href?: string }) => {
            const handleClick = (e: MouseEvent) => {
              e.preventDefault();
              if (onExternalLinkClick && href) {
                onExternalLinkClick(href);
              } else {
                window.open(href, "_blank", "noopener,noreferrer");
              }
            };

            return (
              <button onClick={handleClick} className="ws-hyper-link">
                {children}
              </button>
            );
          },
        },
        img: {
          component: ({ src, alt }: { src: string; alt: string }) => {
            if (!["data:image", "http", "https"].some((p) => src.startsWith(p)))
              return null;

            return <img src={src} alt={alt} />;
          },
        },
        p: (props: ComponentProps<"p">) => {
          if (
            Array.isArray(props.children) &&
            props.children.some((child) => typeof child === "object")
          ) {
            return <div {...(props as ComponentProps<"div">)} />;
          }
          return <p {...props} />;
        },
        pre: {
          component: (props: ComponentProps<"pre">) => {
            return <pre {...props} className="ws-code" />;
          },
        },
        ...customOverrides,
      },
      forceBlock: true,
      forceWrapper: true,
    }),
    [artifacts, citations, customOverrides, onExternalLinkClick],
  );

  return useMemo(
    () =>
      sanitizedContent && (
        <div className="markdown-safe-container">
          <MarkdownToJSX options={markdownOptions}>{sanitizedContent}</MarkdownToJSX>
        </div>
      ),
    [sanitizedContent, markdownOptions],
  );
}
