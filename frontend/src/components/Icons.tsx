import type { SVGProps } from "react";

export const DecreaseFontSizeIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} fill="none" {...props}>
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M10.667 6h4M5.333 4.667l-4 8.666M5.333 4.667l4 8.666M3 10h4.667"
    />
  </svg>
);

export const IncreaseFontSizeIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} fill="none" {...props}>
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M12.667 4v4M10.667 6h4M6 2.667 1.333 13.333M6 2.667l4.667 10.666M3.333 9.333h5.334"
    />
  </svg>
);
