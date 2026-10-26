let stylesInjected = false;

function injectHighlightStyles() {
  if (stylesInjected) return;

  const style = document.createElement("style");
  style.id = "widget-highlight-styles";
  style.textContent = `
    .widget-highlight {
      outline: 2px solid var(--color-main-100);
      transition: outline-color 1.3s ease-out;
    }

    .widget-highlight.fade-out {
      outline-color: transparent;
    }

    @keyframes outline-fade-out {
      0% { outline-color: var(--color-main-100); }
      30% { outline-color: color-mix(in srgb, var(--color-main-100) 70%, transparent); }
      60% { outline-color: color-mix(in srgb, var(--color-main-100) 40%, transparent); }
      85% { outline-color: color-mix(in srgb, var(--color-main-100) 10%, transparent); }
      100% { outline-color: transparent; }
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

function waitForElement(
  elementId: string,
  maxAttempts = 10,
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    let attempts = 0;

    function check() {
      const element = document.getElementById(elementId);
      if (element || attempts >= maxAttempts) {
        resolve(element);
        return;
      }

      attempts++;
      requestAnimationFrame(check);
    }

    check();
  });
}

function waitForScrollCompletion(element: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    let scrollTimeout: NodeJS.Timeout;

    function onScroll() {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        element.removeEventListener("scroll", onScroll);
        resolve();
      }, 100);
    }

    const scrollContainer =
      element.closest("[data-scroll-container]") ||
      element.closest(".overflow-auto") ||
      window;

    if (scrollContainer === window) {
      window.addEventListener("scroll", onScroll, { passive: true });
    } else {
      (scrollContainer as HTMLElement).addEventListener("scroll", onScroll, {
        passive: true,
      });
    }

    setTimeout(() => {
      if (scrollContainer === window) {
        window.removeEventListener("scroll", onScroll);
      } else {
        (scrollContainer as HTMLElement).removeEventListener("scroll", onScroll);
      }
      resolve();
    }, 1000);
  });
}

async function highlightElement(element: HTMLElement): Promise<void> {
  injectHighlightStyles();

  element.classList.add("widget-highlight");

  await new Promise((resolve) => requestAnimationFrame(resolve));

  element.style.animation = "outline-fade-out 1.3s ease-out forwards";

  setTimeout(() => {
    element.classList.remove("widget-highlight");
    element.style.animation = "";
  }, 1300);
}

export interface ScrollToWidgetOptions {
  waitForLayout?: boolean;
  layoutDelay?: number;
}

export async function scrollToAndHighlightWidget(
  widgetId: string,
  options: ScrollToWidgetOptions = {},
): Promise<void> {
  const { waitForLayout = false, layoutDelay = 300 } = options;

  try {
    if (waitForLayout) {
      await new Promise((resolve) => setTimeout(resolve, layoutDelay));
    }

    const element = await waitForElement(widgetId);
    if (!element) {
      console.warn(`Widget element with ID "${widgetId}" not found`);
      return;
    }

    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });

    await waitForScrollCompletion(element);

    await highlightElement(element);
  } catch (error) {
    console.error("Error in scrollToAndHighlightWidget:", error);
  }
}
