import { getConfig } from "~/lib/runtimeConfig";
import { useShallowThemeStore } from "~/lib/state/theme";
import { cn } from "~/lib/utils";

const HEAD = "M147.222,17.667V0h-17.333v17.595H147.222Z";
const LEFT_WING =
  "M129.889,17.595H0v52h17.444v-.056h95.111v17.306H16.889v52.278h113.111V17.667ZM112.556,121.623H34.333v-17.278h78.222v17.278ZM112.556,52.04H17.444v-16.444h95.111v16.444Z";
const RIGHT_WING =
  "M147.167,17.72v121.528h113.111v-52.278h-95.667v-17.306h95.111v.056h17.444V17.72h-130ZM242.833,104.47v17.278h-78.222v-17.278h78.222ZM259.722,52.165h-95.111v-16.444h95.111v16.444Z";

interface BrandedLogoProps {
  className?: string;
  animate?: boolean;
}

export default function BrandedLogo({ className, animate = true }: BrandedLogoProps) {
  const theme = useShallowThemeStore((state) => state.theme);
  const { leftSidebarLogo, leftSidebarLogoDark, name } = getConfig().whiteLabel;

  if (leftSidebarLogo) {
    return (
      <img
        className={cn(
          "max-w-[200px] w-full max-h-full object-contain",
          animate && "logo-fade",
          className,
        )}
        src={
          theme === "dark" && leftSidebarLogoDark
            ? leftSidebarLogoDark
            : leftSidebarLogo
        }
        alt={name || "FINOS Workspace"}
      />
    );
  }

  return (
    <div
      className={cn("logo-stage h-auto w-[100px] text-main-50", className)}
      aria-hidden
    >
      <div className="logo-depth">
        <div className={cn("logo-wing", animate && "logo-wing-left")}>
          <svg viewBox="0 0 277.167 139.248" className="h-full w-full overflow-visible">
            <path fill="currentColor" d={LEFT_WING} />
          </svg>
        </div>
        <div className={cn("logo-wing", animate && "logo-wing-right")}>
          <svg viewBox="0 0 277.167 139.248" className="h-full w-full overflow-visible">
            <path fill="currentColor" d={RIGHT_WING} />
          </svg>
        </div>
        <svg viewBox="0 0 277.167 139.248" className="logo-head">
          <path fill="currentColor" d={HEAD} />
        </svg>
      </div>
    </div>
  );
}
