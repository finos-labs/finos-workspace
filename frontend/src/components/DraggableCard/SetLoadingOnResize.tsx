import {
  type ComponentType,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  useMemo,
} from "react";
import type { IconId } from "~/components/Icon.types";
import { isExcludedWidgetId } from "~/lib/state/featureFlags";
import { useShallowThemeStore } from "~/lib/state/theme";
import { cn } from "~/lib/utils";
import { useShallowStreamingStore } from "../AI/hooks/useStreaming";
import BrandedLogo from "../General/BrandedLogo";
import SearchResultsNotFound from "../General/SearchResultsNotFound";
import Icon from "../Icon";
import { useWidgetContext } from "../Widget.context";
import type { WidgetId } from "../Widgets";

type LoadingElementProps = {
  className?: string;
  loading?: boolean;
  errorMessage?: ReactNode | string | null;
  secondaryMessage?: ReactNode | string | null;
  errorChildren?: ReactNode;
  children?: ReactNode;
  failingUrl?: string;
  widgetId?: WidgetId;
  icon?: boolean | IconId;
  /**
   * Keep the children mounted and hide them under the loading or error state, instead of
   * replacing them. A widget plugin's frame is its whole realm: unmounting it restarts
   * the plugin.
   */
  keepMounted?: boolean;
};

interface ChildrenProps {
  children: ReactNode;
}

function UnfetchableURL({ url }: { url: string }) {
  const widgetUUID = useWidgetContext(true)?.widgetRef?.current?.id;
  return (
    <div
      className="relative overflow-auto flex px-2.5 mb-2.5
      h-[calc(100%-38px)] w-full flex-col items-center justify-center gap-2"
    >
      <Icon id="warning-icon" className="size-6 text-ds-text-caption" />
      <p
        id={`widget-error-${widgetUUID}`}
        className="text-sm text-ds-text-body font-bold"
      >
        Widget Unavailable
      </p>
      <p className="text-xs text-ds-text-caption break-words">
        The URL: {url} is currently not accessible.
      </p>
    </div>
  );
}

export const LoadingElement = forwardRef<HTMLElement, LoadingElementProps>(
  (props, _ref) => {
    const {
      children,
      errorMessage,
      secondaryMessage = null,
      errorChildren,
      loading,
      failingUrl,
      widgetId,
      icon = true,
      keepMounted = false,
    } = props;

    const childrenExist = !!children;
    const isMinimized = useWidgetContext(true)?.widget?.isMinimized;
    const showLoading = !isMinimized && (!!loading || !childrenExist);

    const loadingElement = useMemo(() => {
      return (
        <div
          className={cn(
            "flex h-[calc(100%-38px)] w-full items-center justify-center overflow-hidden p-4",
            props.className,
          )}
        >
          <BrandedLogo />
        </div>
      );
    }, [props.className]);

    let cover: ReactNode = null;
    if (isExcludedWidgetId(widgetId)) {
      cover = (
        <SearchResultsNotFound
          icon={true}
          iconClassName="text-ds-text-caption"
          firstMessage="This widget is not available in your current plan."
          secondMessage={null}
        />
      );
    } else if (failingUrl && !isMinimized) {
      cover = <UnfetchableURL url={failingUrl} />;
    } else if (errorMessage && !isMinimized) {
      cover = (
        <SearchResultsNotFound
          icon={Boolean(icon)}
          iconClassName={typeof icon === "string" ? icon : ""}
          firstMessage={errorMessage}
          secondMessage={secondaryMessage}
        >
          {errorChildren}
        </SearchResultsNotFound>
      );
    } else if (showLoading) {
      cover = loadingElement;
    }

    if (keepMounted) {
      return (
        <>
          {cover}
          <div className={cover ? "hidden" : "contents"}>{children}</div>
        </>
      );
    }
    return cover ?? children;
  },
);

LoadingElement.displayName = "LoadingElement";

interface SetLoadingOnResizeProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export const SetLoadingOnResize = forwardRef<HTMLDivElement, SetLoadingOnResizeProps>(
  ({ children, ...rootProps }, ref) => {
    const isResizingGridElement = useShallowThemeStore(
      (state) => state.isResizingGridElement,
    );
    const widgetRef = useWidgetContext()?.widgetRef;

    const widgetId = widgetRef?.current?.id;
    const isResizing = isResizingGridElement === widgetId;
    const { className = "relative h-full w-full", ...props } = rootProps;

    return (
      <>
        {isResizing ? <LoadingElement /> : null}
        <div className={cn(className, { hidden: isResizing })} ref={ref} {...props}>
          {children}
        </div>
      </>
    );
  },
);

SetLoadingOnResize.displayName = "LoadingOnResize";

export function HideOnResize({ children }: { children: ReactNode }) {
  const isResizingGridElement = useShallowThemeStore(
    (state) => state.isResizingGridElement,
  );
  const widgetRef = useWidgetContext()?.widgetRef;

  return isResizingGridElement === widgetRef?.current?.id ? null : children;
}

interface CopilotOnResizeProps extends ChildrenProps {
  as?: "div" | "main";
  className?: string;
  id?: string;
  rootComponent?: ComponentType<ChildrenProps>;
}

const CopilotOnResize = forwardRef<HTMLDivElement, CopilotOnResizeProps>(
  (props, ref) => {
    const {
      children,
      id,
      className = "relative h-full w-full",
      as: Component = "div",
      rootComponent: RootComponent,
    } = props;

    const isDragging = useShallowStreamingStore((state) => state.isDragging);
    const childrenMemo = useMemo(() => children, [children]);

    const element = (
      <Component ref={ref} id={id} className={cn(className, { hidden: isDragging })}>
        {childrenMemo}
      </Component>
    );

    return (
      <>
        {isDragging ? <LoadingElement /> : null}
        {RootComponent ? <RootComponent>{element}</RootComponent> : element}
      </>
    );
  },
);

CopilotOnResize.displayName = "CopilotSetLoadingOnResize";
export const CopilotSetLoadingOnResize = CopilotOnResize;

export default SetLoadingOnResize;
