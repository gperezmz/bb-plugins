// The host's own icon set, rendered by bb (`experimental_Icon`), so the
// plugin bundles no icon library and matches bb's glyphs exactly.
import type { CSSProperties } from "react";
import { experimental_Icon } from "@get-bb/plugin-sdk/app";
import { cn } from "../../lib/utils";

export type IconName = string;

export interface IconProps {
  name: IconName;
  fallback?: string;
  className?: string;
  style?: CSSProperties;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
}

export function Icon({ name, fallback = "Circle", className, ...props }: IconProps) {
  const HostIcon = experimental_Icon;
  return (
    <span data-icon-root className={cn("inline-flex size-4 shrink-0 items-center justify-center", className)}>
      <HostIcon name={name} fallback={fallback} className="size-full" {...props} />
    </span>
  );
}
