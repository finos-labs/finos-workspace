import BrandedLogo from "~/components/General/BrandedLogo";
import { getConfig } from "~/lib/runtimeConfig";
import { useShallowThemeStore } from "~/lib/state/theme";
import { cn } from "~/lib/utils";

export default function NoItems() {
  const theme = useShallowThemeStore((state) => state.theme);
  const { leftSidebarLogo, leftSidebarLogoDark, name } = getConfig().whiteLabel;

  return (
    // The page background comes from the store, not `dark:`: the `dark` class lands on
    // <html> only after the first render, and the body fades into it under the loader.
    <div
      className={cn(
        "w-screen h-screen overflow-hidden flex items-center justify-center",
        theme === "dark" ? "bg-dark-900" : "bg-white",
      )}
    >
      <div className="flex flex-col gap-1 items-center">
        {leftSidebarLogo ? (
          <img
            className="w-[200px] object-contain opacity-50"
            src={
              theme === "dark" && leftSidebarLogoDark
                ? leftSidebarLogoDark
                : leftSidebarLogo
            }
            alt={name || "Workspace"}
          />
        ) : (
          <BrandedLogo
            className={cn(
              "h-auto w-[200px]",
              theme === "dark" ? "text-white/50" : "text-[#071820]/50",
            )}
          />
        )}
        <p className="subtitle-sm-bold mt-2 text-light-300 dark:text-dark-700">
          Loading
          <span className="inline-flex gap-0.5 ml-0.5 items-end pb-0.5">
            <span className="size-[3px] bg-current rounded-full animate-pulse" />
            <span className="size-[3px] bg-current rounded-full animate-pulse [animation-delay:200ms]" />
            <span className="size-[3px] bg-current rounded-full animate-pulse [animation-delay:400ms]" />
          </span>
        </p>
      </div>
    </div>
  );
}
