import { type SVGProps, forwardRef, memo, useMemo } from "react";
import { twMerge } from "tailwind-merge";
import { VERSION } from "~/constants";

const allIcons = [
  "_", // Placeholder for no icon
  "user-icon",
  "grid-01",
  "refresh-right",
  "clipboard-check",
  "chevron-down",
  "chevron-right",
  "log-out-01",
  "checkmark-icon",
  "info-outline-circle",
] as const;

type IconId = (typeof allIcons)[number];

const IconBase = forwardRef<SVGElement, { id: IconId } & SVGProps<SVGSVGElement>>(
  (props) => {
    const { id } = props;
    const defaultClass = "w-4 h-4";
    return useMemo(
      () => (
        <svg {...props} className={twMerge(defaultClass, props.className)}>
          <use href={`/assets/icons/sprite.svg?v=${VERSION}#${id}`} />
        </svg>
      ),
      [props, id],
    );
  },
);

IconBase.displayName = "Icon";

const Icon = memo(IconBase);

export default Icon;
