import { Responsive, WidthProvider } from "@jose-donato/react-grid-layout";
import {
  type ComponentClass,
  forwardRef,
  memo,
  type PropsWithChildren,
  type Ref,
  useCallback,
  useMemo,
} from "react";
import type { Layout, ResponsiveProps, WidthProviderProps } from "react-grid-layout";
import { useDebouncedCallback } from "use-debounce";
import useIsMobile from "~/hooks/useIsMobile";
import { type GridItem, useTabContext } from "~/lib/contexts/TabContext";
import { useShallowAppStore } from "~/lib/state/app";
import { useShallowThemeStore } from "~/lib/state/theme";
import { cn, saveToLS } from "~/lib/utils";
import DragFileHere from "./AI/DragFileHere";
import { useDragAndDropFiles } from "./GridLayout.hooks";
import Icon from "./Icon";

function setPointerEvents(removeClass = true) {
  const workarea = document.getElementById("workarea");
  if (!workarea) return;
  if (removeClass) {
    workarea.classList.remove("pointer-events-none");
  } else {
    workarea.classList.add("pointer-events-none");
  }
}

interface GridLayoutProps extends PropsWithChildren {
  saveToLocalStorage?: boolean;
  localStorageKey?: string;
  transformScale?: number;
  isDroppable?: boolean;
  isBounded?: boolean;
  draggableHandle?: string;
  rowHeight?: number;
  saveTab?: boolean;
  locked?: boolean;
  extraClassName?: string;
}

export const resizeHandle = (resizeHandle: string, ref: Ref<HTMLElement>) => {
  return (
    <div
      className={cn(
        "absolute m-1 react-resizable-handler rotate-90",
        `react-resizable-handle-${resizeHandle}`,
      )}
      ref={ref as Ref<HTMLDivElement>}
    >
      <Icon id="maximize-01" className="w-3 h-3 text-light-500" />
    </div>
  );
};

export const GridLayout = forwardRef<HTMLDivElement, GridLayoutProps>(
  (props, _forwardedRef) => {
    const {
      children,
      saveToLocalStorage = false,
      localStorageKey,
      transformScale = 1,
      isDroppable = false,
      isBounded = false,
      draggableHandle = ".draggable-handle",
      rowHeight = 25,
      saveTab = false,
      locked = false,
      extraClassName = "",
    } = props;

    const ReactGridLayout = useMemo(
      () =>
        WidthProvider(Responsive) as ComponentClass<
          ResponsiveProps & WidthProviderProps
        >,
      [],
    );
    const { currentTab, tabId, layouts, setLayouts, isShared } = useTabContext();

    const isMobile = useIsMobile();

    const { setIsResizingGridElement, gridSnapping, gridCorners } =
      useShallowThemeStore((state) => ({
        gridSnapping: state.gridSnapping,
        gridCorners: state.gridCorners,
        setIsResizingGridElement: state.setIsResizingGridElement,
      }));
    const updateTabWidgetsLayout = useShallowAppStore(
      (state) => state.updateTabWidgetsLayout,
    );

    const { getRootProps, getInputProps, isDragActive } = useDragAndDropFiles(locked);

    const onLayoutChange = useCallback(
      (layout: Layout[]) => {
        setPointerEvents(true);
        if (layout.length === 0) return;
        if (layout[0].i === "empty") return;
        if (tabId && saveTab) {
          updateTabWidgetsLayout(
            tabId,
            layout.map((item) => {
              const newItem = Object.fromEntries(
                Object.entries(item).filter(([, value]) => value !== undefined),
              ) as GridItem;

              if (!newItem.minH) newItem.minH = 4;
              if (!newItem.minW) newItem.minW = 8;
              if (isMobile) newItem.mobileH = newItem.h;
              return newItem;
            }),
            currentTab,
          );
        } else {
          if (saveToLocalStorage && localStorageKey) {
            saveToLS(localStorageKey, "layout", layout);
          }
          setLayouts?.(layout);
        }
      },
      [currentTab, saveTab, tabId, saveToLocalStorage, localStorageKey, isMobile],
    );

    const debouncedOnLayoutChange = useDebouncedCallback(onLayoutChange, 500, {
      leading: true,
      maxWait: 800,
    });

    const memoizedGridProps = useMemo(() => {
      const gridProps = {
        breakpoints: { xl: 1600, lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 },
        cols: { xl: 40, lg: 40, md: 40, sm: 40, xs: 40, xxs: 40 },
        resizeHandle,
        onDragStart: (_layout, _oldItem, newItem, _placeholder, _e, _element) => {
          if (newItem.i === "empty") return;
          const workarea = document.getElementById("workarea");
          if (!workarea) return;
          setPointerEvents(false);
        },
        onDrag: (_layout, oldItem, newItem, _placeholder, e, element) => {
          const workarea = document.getElementById("workarea");

          if (!workarea) return;
          setPointerEvents(false);
          const elementRect = element.getBoundingClientRect();
          const workareaRect = workarea.getBoundingClientRect();
          const scrollSpeed = 40;
          const scrollMargin = 50;
          const scrollThreshold = 80;

          const bottomNeedsScroll =
            elementRect.bottom + scrollMargin >= workareaRect.bottom;
          const topNeedsScroll = elementRect.top - scrollMargin <= workareaRect.top;

          if (bottomNeedsScroll && e.clientY > workareaRect.bottom - scrollThreshold) {
            workarea.scrollTop += scrollSpeed;
          }

          if (topNeedsScroll && e.clientY < scrollThreshold) {
            workarea.scrollTop -= scrollSpeed;
          }

          if (
            elementRect.left <= workareaRect.left ||
            elementRect.right >= workareaRect.right
          ) {
            if (
              elementRect.top <= workareaRect.top ||
              elementRect.bottom >= workareaRect.bottom
            ) {
              newItem = {
                ...newItem,
                x: oldItem.x,
                y: oldItem.y,
              };
            }
          }
        },
        onDragStop: () => setPointerEvents(true),
        onDrop: () => setPointerEvents(true),
        onResizeStart: (_layout, oldItem, newItem, _placeholder, e, element) => {
          setIsResizingGridElement(newItem.i);
          const workarea = document.getElementById("workarea");

          if (!workarea) return;

          const workareaRect = workarea.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          const isRight =
            e.clientX >= workareaRect.right || e.clientX <= elementRect.left;
          const isBottom =
            e.clientY >= workareaRect.bottom || e.clientY <= elementRect.top;

          if (isRight) {
            newItem = {
              ...newItem,
              w: oldItem.w - e.clientX + workareaRect.left,
              x: oldItem.x + e.clientX - workareaRect.left,
            };
          }
          if (isBottom) {
            newItem = {
              ...newItem,
              h: oldItem.h - e.clientY + workareaRect.top,
              y: oldItem.y + e.clientY - workareaRect.top,
            };
          }
        },
        onResize: (_layout, oldItem, newItem, _placeholder, e, element) => {
          const workarea = document.getElementById("workarea");

          if (!workarea) return;
          setPointerEvents(false);

          const workareaRect = workarea.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          const _isLeft =
            e.clientX <= workareaRect.left || e.clientX >= elementRect.right;
          const isRight =
            e.clientX >= workareaRect.right || e.clientX <= elementRect.left;
          const _isTop =
            e.clientY <= workareaRect.top || e.clientY >= elementRect.bottom;
          const isBottom =
            e.clientY >= workareaRect.bottom || e.clientY <= elementRect.top;

          if (isRight) {
            newItem = {
              ...newItem,
              w: oldItem.w + e.clientX - workareaRect.left,
              x: oldItem.x - e.clientX + workareaRect.left,
            };
          } else if (isBottom) {
            newItem = {
              ...newItem,
              h: oldItem.h - e.clientY + workareaRect.top,
              y: oldItem.y + e.clientY - workareaRect.top,
            };
          }
        },
        onResizeStop: () => {
          setIsResizingGridElement("");
          setPointerEvents(true);
        },
      } as const satisfies ResponsiveProps;

      return gridProps;
    }, []);

    const layoutsMemo = useMemo(() => {
      let currentY = 0;
      const mobileLayouts = layouts?.map((item) => {
        const mobileItem = {
          ...item,
          x: 0,
          w: 40,
          y: currentY,
          h: Math.max(item.mobileH || item.h, 8),
        };
        currentY += mobileItem.h;
        return mobileItem;
      });

      return {
        xxs: mobileLayouts,
        xs: mobileLayouts,
        sm: layouts,
        md: layouts,
        lg: layouts,
        xl: layouts,
      };
    }, [layouts]);

    const childrenMemo = useMemo(() => children, [children]);
    const enableResizing = useMemo(
      () => !(locked || isShared) && saveTab,
      [locked, isShared, saveTab],
    );
    const enableDragging = useMemo(
      () => !(locked || isShared || isMobile) && saveTab,
      [locked, isShared, isMobile, saveTab],
    );

    const gridMemo = useMemo(() => {
      return (
        <ReactGridLayout
          resizeHandles={gridCorners}
          autoSize={true}
          draggableHandle={draggableHandle}
          rowHeight={rowHeight}
          onLayoutChange={debouncedOnLayoutChange}
          compactType={gridSnapping === "off" ? null : gridSnapping}
          isBounded={isBounded}
          layouts={layoutsMemo}
          transformScale={transformScale}
          useCSSTransforms={true}
          isDroppable={isDroppable}
          preventCollision={false}
          allowOverlap={false}
          isDraggable={enableDragging}
          isResizable={enableResizing}
          breakpoints={memoizedGridProps.breakpoints}
          cols={memoizedGridProps.cols}
          resizeHandle={memoizedGridProps.resizeHandle}
          onDragStart={memoizedGridProps.onDragStart}
          onDrag={memoizedGridProps.onDrag}
          onDragStop={memoizedGridProps.onDragStop}
          onDrop={memoizedGridProps.onDrop}
          onResizeStart={memoizedGridProps.onResizeStart}
          onResize={memoizedGridProps.onResize}
          onResizeStop={memoizedGridProps.onResizeStop}
          measureBeforeMount={false}
        >
          {childrenMemo}
        </ReactGridLayout>
      );
    }, [
      childrenMemo,
      gridCorners,
      gridSnapping,
      enableResizing,
      enableDragging,
      layoutsMemo,
      memoizedGridProps,
      debouncedOnLayoutChange,
      rowHeight,
    ]);

    return (
      <div
        {...getRootProps()}
        className={cn("relative ml-px min-h-screen", extraClassName, {
          "": isDragActive,
        })}
      >
        <input id="dashboard-file-upload" {...getInputProps()} />
        {isDragActive && (
          <div className="absolute inset-0 z-50 flex items-center justify-center">
            <DragFileHere />
          </div>
        )}
        {gridMemo}
      </div>
    );
  },
);

export default memo(GridLayout);
