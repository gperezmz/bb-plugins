import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BRAND_ARTWORK, BrandDrawing } from "./brand-logos";
import { GITHUB_LOGO, SERVICE_NAMES, type Service } from "./icons";
import { TONE_TEXT, type Tone } from "./tones";

/**
 * The 14px box every icon and logo is drawn in. With `label` it is an image with that accessible name; without one it
 * is hidden from assistive technology, for a drawing beside words that say the same.
 */
function IconBox({ label, logo, className, children }: { label?: string; logo?: Service; className?: string; children: ReactNode }) {
  return (
    <span data-logo={logo} role={label === undefined ? undefined : "img"} aria-label={label} aria-hidden={label === undefined ? true : undefined} className={cn("inline-flex size-3.5 shrink-0 items-center", className)}>
      {children}
    </span>
  );
}

/**
 * One icon, drawn by bb in the current text colour or in `tone`'s. With `label` it is an image with that accessible
 * name; without one it is hidden from assistive technology, for an icon beside words that say the same.
 */
export function Glyph({ name, tone, label, spin = false, className }: { name: string; tone?: Tone; label?: string; spin?: boolean; className?: string }) {
  return (
    <IconBox label={label} className={cn(tone !== undefined && TONE_TEXT[tone], spin && "motion-safe:animate-spin", className)}>
      <Icon name={name} className="size-full" aria-hidden />
    </IconBox>
  );
}

/**
 * A service's logo, whose accessible name is the service's name unless `decorative`, for where the words beside it
 * already name the service. GitHub's is drawn by bb in the text colour; the others are their brands' own artwork.
 */
export function ServiceLogo({ service, decorative = false, className }: { service: Service; decorative?: boolean; className?: string }) {
  const label = decorative ? undefined : SERVICE_NAMES[service];
  if (service === "github") return <Glyph name={GITHUB_LOGO} label={label} className={className} />;
  return (
    <IconBox label={label} logo={service} className={className}>
      <BrandDrawing artwork={BRAND_ARTWORK[service]} />
    </IconBox>
  );
}
