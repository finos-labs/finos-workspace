export function loadStylesheet(href: string): Promise<void> {
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener(
      "error",
      () => {
        console.error(`The stylesheet ${href} did not load`);
        resolve();
      },
      { once: true },
    );
    document.head.appendChild(link);
  });
}
