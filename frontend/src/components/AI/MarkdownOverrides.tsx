import type { Grammar } from "@wooorm/starry-night";
import type { Root } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import Markdown, { type MarkdownToJSX, RuleType } from "markdown-to-jsx";
import {
  type ComponentPropsWithoutRef,
  isValidElement,
  memo,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { format } from "sql-formatter";
import { useDebounceValue } from "usehooks-ts";
import { type ArtifactT, useShallowCopilotStore } from "~/lib/state/copilot";
import { cn } from "../ds/utils";
import { InlineMath } from "../Tex";
import Artifact from "./Artifact";
import { useExternalLinkAnchorProps } from "./ExternalLinkContext";
import MessageTable from "./MessageTable";

type StarryNightInstance = {
  flagToScope: (flag: string) => string | undefined;
  highlight: (value: string, scope: string) => Root;
  missingScopes: () => ReadonlyArray<string>;
  register: (grammars: ReadonlyArray<Readonly<Grammar>>) => Promise<undefined>;
  scopes: () => ReadonlyArray<string>;
};

let starryNightInstance: StarryNightInstance | null = null;
const starryNightListeners = new Set<() => void>();

const starryNightReady = import("@wooorm/starry-night")
  .then(({ common, createStarryNight }) =>
    createStarryNight(common, {
      getOnigurumaUrlFetch: () =>
        new URL("/assets/wasm/onig.wasm", window.location.href),
    }),
  )
  .then((instance) => {
    starryNightInstance = instance;
    starryNightListeners.forEach((l) => l());
    starryNightListeners.clear();
    return instance;
  });

function useStarryNight() {
  const [sn, setSn] = useState(starryNightInstance);
  useEffect(() => {
    if (sn) return;
    if (starryNightInstance) {
      setSn(starryNightInstance);
      return;
    }
    const listener = () => setSn(starryNightInstance);
    starryNightListeners.add(listener);
    return () => {
      starryNightListeners.delete(listener);
    };
  }, [sn]);
  return sn;
}

function formatSqlIndentation(
  sql: string,
  dialect: "sql" | "postgresql" = "sql",
  retry = true,
): string {
  try {
    // Use sql-formatter with compact configuration
    return format(sql, {
      language: dialect,
      tabWidth: 2,
      keywordCase: "upper",
      functionCase: "preserve",
      identifierCase: "preserve",
      linesBetweenQueries: 1,
      // Compact formatting to avoid excessive line breaks
      logicalOperatorNewline: "before",
      expressionWidth: 80,
      denseOperators: true,
      newlineBeforeSemicolon: false,
    });
  } catch (error) {
    if (retry && error instanceof Error && error.message.includes("postgres"))
      return formatSqlIndentation(sql, "postgresql", false);
    // If formatting fails, return the original SQL
    console.error("SQL formatting error:", error);
    return sql;
  }
}

/** Whether a paragraph holds anything but text, which a `<p>` cannot hold in markdown that is not text. */
export const hasObjectChild = (children: ReactNode) =>
  Array.isArray(children) && children.some((child) => typeof child === "object");

type CodeChildProps = { className?: string; children?: string | string[] };

const AgentComponent = memo(
  (props: { children?: ReactNode[] }) => {
    const agentId = props.children?.[0];
    if (!agentId) {
      console.warn("Agent component missing agentId");
      return null;
    }
    return <span className="text-blue-500 font-semibold">{`Agent: ${agentId}`}</span>;
  },
  (p, n) => p.children === n.children,
);

const ArtifactComponent = memo(
  (props: { className?: string; children?: ReactNode[] }) => {
    const getCurrentChatArtifact = useShallowCopilotStore(
      (state) => state.getCurrentChatArtifact,
    );

    const elementMemo = useMemo(() => {
      try {
        let artifact: ArtifactT | null | undefined = null;
        const className = props.className || "";
        if (className) {
          // This is the new way of getting artifactId
          // The old way is to get it from props.children[0]
          // but it creates problems when the artifactId is JSX-parsable,
          // like <artifact>https://this-id-is-a-url</artifact>
          // New option disableAutoLink from markdown-to-jsx disables links
          // globally so we can't use that
          const artifactId = className;
          // Remove escape characters from the artifact ID
          const normalizedArtifactId = artifactId.replace(/\\/g, "");
          artifact = getCurrentChatArtifact(normalizedArtifactId);
        } else {
          // Leaving this here for backwards compatibility
          if (!props?.children || props?.children?.length === 0) return null;
          const artifactId = props.children[0];
          if (typeof artifactId !== "string") return null;
          artifact = getCurrentChatArtifact(artifactId);
        }
        if (!artifact) return null;

        const element = (
          <Artifact key={artifact.uuid} artifact={artifact} inAiMessage={true} />
        );

        return <div className="py-2">{element}</div>;
      } catch (error) {
        console.error("Failed to parse artifact data:", error);
        return (
          <div className="dark:bg-dark-400 rounded p-2 bg-light-100">
            Failed to load artifact
          </div>
        );
      }
    }, [props?.className, props?.children]);

    return elementMemo;
  },
  (p, n) => p.className === n.className && p.children === n.children,
);

const TableComponent = memo(
  (props: { children: ReactElement<{ children: ReactNode[] }>[] }) => {
    if (!props?.children || props?.children?.length === 0) return null;

    // ensure thead and tbody exist
    const firstChild = props.children[0];

    if (firstChild?.type === "tr") {
      const rest = props.children.slice(1).filter((child) => typeof child === "object");
      return (
        <MessageTable>
          <thead>
            <tr children={firstChild.props.children} />
          </thead>
          <tbody children={rest} />
        </MessageTable>
      );
    }

    return <MessageTable children={props.children} />;
  },
  (p, n) => p.children === n.children,
);

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function isSafeUrl(value: unknown, allowedProtocols: Set<string>) {
  if (typeof value !== "string") return false;
  const href = value.trim();
  if (!href || hasControlCharacters(href)) return false;

  try {
    const baseUrl =
      typeof window === "undefined" ? "https://workspace.local" : window.location.href;
    const url = new URL(href, baseUrl);
    return allowedProtocols.has(url.protocol);
  } catch {
    return false;
  }
}

function hasControlCharacters(value: string) {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

const LinkComponent = memo(
  (props: ComponentPropsWithoutRef<"a">) => {
    const href = isSafeUrl(props.href, SAFE_LINK_PROTOCOLS) ? props.href : undefined;
    const anchorProps = useExternalLinkAnchorProps(href);
    if (!href) return <span>{props.children}</span>;

    return (
      <a
        {...props}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        {...anchorProps}
      >
        {props.children}
      </a>
    );
  },
  (p, n) => p.href === n.href && p.children === n.children,
);

/**
 * The chat never loads an image. What it shows is written by a model, a web page or a file, and loading
 * `![](address)` asks the server at that address for it, with whatever was put in the address: the user's data
 * can leave that way, with no click. So an image in chat text is its alt text, and nothing is requested.
 */
const ImageComponent = memo(
  (props: ComponentPropsWithoutRef<"img">) =>
    props.alt ? <span>{props.alt}</span> : null,
  (p, n) => p.alt === n.alt,
);

/** For every markdown the chat shows: the `img` of markdown-to-jsx would otherwise render an `<img>`. */
export const inertImageOverride = { img: { component: ImageComponent } };

const ParagraphComponent = memo(
  (props: ComponentPropsWithoutRef<"p">) => {
    if (hasObjectChild(props.children)) {
      return <div {...props} />;
    }
    return <p {...props} />;
  },
  (p, n) => p.children === n.children,
);

const parseTableHTML = (code: string) => {
  // Unescape underscores
  code = code.replace(/\\_/g, "_");

  // Ensures that table HTML is properly wrapped
  if (!code.startsWith("<table")) {
    if (code.startsWith("<thead") || code.startsWith("<tbody")) {
      code = `<table>${code}</table>`;
    } else if (code.startsWith("<tr")) {
      code = `<table><tbody>${code}</tbody></table>`;
    }
  }

  // A document of its own that nothing runs or loads in: an element made with `innerHTML` in this page starts
  // loading its `src` and runs its `onerror` at once, even when it is never put on the page, and `code` is a
  // model's text.
  const doc = new DOMParser().parseFromString(code, "text/html");
  const table = doc.querySelector("table");

  if (!table) return null;

  if (
    table.children?.length === 1 &&
    table.children?.[0]?.tagName?.toLowerCase() === "tbody"
  ) {
    const thead = doc.createElement("thead");
    const firstRow = table.querySelector("tbody tr");
    if (firstRow) {
      thead.appendChild(firstRow.cloneNode(true));
      table.insertBefore(thead, table.firstChild);
      firstRow.remove();
    }
  }

  return Array.from(table.children).map((child, index) => {
    const ElemTag = child.tagName.toLowerCase() as "thead" | "tbody";
    return (
      <ElemTag key={`table-${ElemTag}-${index}`}>
        {Array.from(child.children).map((row, rowIndex) => (
          <tr key={`table-row-${rowIndex}`}>
            {Array.from(row.children).map((cell, cellIndex) => {
              const CellTag = cell.tagName.toLowerCase() as "td" | "th";
              return (
                <CellTag
                  className={"!m-0 !p-2 align-top"}
                  key={`table-cell-${cellIndex}`}
                >
                  {cell.innerHTML}
                </CellTag>
              );
            })}
          </tr>
        ))}
      </ElemTag>
    );
  });
};

const codeChildOf = (children: ReactNode): CodeChildProps | undefined =>
  isValidElement<CodeChildProps>(children) ? children.props : undefined;

export const PreCodeComponent = memo(
  (props: ComponentPropsWithoutRef<"pre">) => {
    const child = codeChildOf(props.children);
    const code =
      typeof child?.children === "string" ? child.children : child?.children?.[0] || "";

    const validTable = useMemo(
      () =>
        child?.className === "lang-html" &&
        ["<table", "<thead", "<tr"].some((tag) => code?.startsWith(tag)),
      [code?.slice(0, 7), child?.className],
    );
    const [debouncedCode] = useDebounceValue(code, 500, {
      leading: true,
      maxWait: 300,
    });
    const children = useMemo(
      () => validTable && parseTableHTML(debouncedCode),
      [debouncedCode, validTable],
    );

    if (children) return <MessageTable children={children} />;
    return <pre {...props} data-ai-pre="true" />;
  },
  (p, n) =>
    p.className === n.className &&
    p.children === n.children &&
    codeChildOf(p.children)?.children === codeChildOf(n.children)?.children,
);

export const CodeComponent = memo(
  (props: ComponentPropsWithoutRef<"code">) => {
    const className = props.className || "";
    const starryNight = useStarryNight();

    const { scope, lang } = useMemo(() => {
      const matches = className.match(/lang-([\w-]+)/);
      const lang = matches ? matches[1] : "markdown";

      const scope = starryNight?.flagToScope(lang);
      return { scope, lang };
    }, [className, starryNight]);

    const children = useMemo(() => {
      if (!scope || !starryNight) return props.children;

      const first: unknown = Array.isArray(props.children)
        ? props.children[0]
        : undefined;
      let code =
        typeof props.children === "string"
          ? props.children.replace(/\\_/g, "_")
          : typeof first === "string"
            ? first
            : "";
      if (lang === "sql") code = formatSqlIndentation(code);

      const hast = starryNight.highlight(code, scope);

      const result = toJsxRuntime(hast, { Fragment, jsx, jsxs });
      return result.props.children;
    }, [props.children, scope, lang, starryNight]);

    if (!scope)
      return (
        <code {...props} className={cn("break-words", className)}>
          {children}
        </code>
      );

    return (
      <code
        {...props}
        className={cn(
          "break-words whitespace-pre-wrap overflow-wrap-anywhere",
          className.replace("lang-", "language-"),
        )}
      >
        {children}
      </code>
    );
  },
  (p, n) => p.className === n.className && p.children === n.children,
);

type RenderRuleT = NonNullable<MarkdownToJSX.Options["renderRule"]>;

export const renderRule: RenderRuleT = (next, node, _renderChildren, state) => {
  if (node.type === RuleType.codeBlock) {
    if (node.lang === "latex") {
      // biome-ignore lint/complexity/noUselessStringRaw: False positive
      const childstr = String.raw`${node.text}`;
      return (
        <InlineMath
          renderError={(error) => {
            console.error("LaTeX render error:", error);
            return (
              <span className="font-mono bg-light-100 dark:bg-dark-400 px-1 rounded text-red-500">
                Failed to render LaTeX: {childstr}
              </span>
            );
          }}
          key={state.key}
        >
          {childstr}
        </InlineMath>
      );
    }
    if (node.lang === "markdown") {
      return (
        <Markdown key={state.key} options={MarkdownAIMessageOptions}>
          {node.text}
        </Markdown>
      );
    }
  }

  return next();
};

export const MarkdownAIMessageOverrides = {
  artifact: { component: ArtifactComponent },
  agent: { component: AgentComponent },
  table: { component: TableComponent },
  a: { component: LinkComponent },
  ...inertImageOverride,
  p: { component: ParagraphComponent },
  pre: { component: PreCodeComponent },
  code: { component: CodeComponent },
};

export const MarkdownAIMessageOptions: MarkdownToJSX.Options = {
  disableParsingRawHTML: true,
  renderRule,
  overrides: MarkdownAIMessageOverrides,
};

/** For markdown shown in the chat panel that has no overrides of its own: no raw HTML, and no images. */
export const InertMarkdownOptions: MarkdownToJSX.Options = {
  disableParsingRawHTML: true,
  overrides: { ...inertImageOverride },
};

export const CodeMarkdownOptions = {
  disableParsingRawHTML: true,
  renderRule,
  overrides: {
    ...inertImageOverride,
    code: { component: CodeComponent },
    pre: { component: PreCodeComponent },
  },
};
