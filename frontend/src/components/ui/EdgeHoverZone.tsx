import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";

interface EdgeHoverZoneProps {
  side: "left" | "right";
  onHoverChange: (isHovered: boolean) => void;
}

export const EdgeHoverZone = memo(({ side, onHoverChange }: EdgeHoverZoneProps) => {
  const [isPointerDevice, setIsPointerDevice] = useState(true);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(pointer: fine)");
    setIsPointerDevice(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setIsPointerDevice(e.matches);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    onHoverChange(true);
  }, [side, onHoverChange]);

  const handleMouseLeave = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      onHoverChange(false);
    }, 200);
  }, [side, onHoverChange]);

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  if (!isPointerDevice) {
    return null;
  }

  const isLeft = side === "left";

  return (
    <div
      className={cn(
        "fixed top-0 bottom-0 z-40 pointer-events-auto",
        isLeft ? "left-[10px] w-[10px]" : "right-[10px] w-[10px]",
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    />
  );
});

EdgeHoverZone.displayName = "EdgeHoverZone";
