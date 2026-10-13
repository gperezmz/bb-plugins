import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { BRAND_ARTWORK, BrandLogo } from "./brand-logos";
import { SERVICE_LOGOS, SERVICE_NAMES, type Service } from "./icons";
import { TONE_TEXT, type Tone } from "./tones";

/**
 * One icon, drawn by bb in the current text colour or in `tone`'s. With `label` it is an image with that accessible
 * name; without one it is hidden from assistive technology, for an icon beside words that say the same.
 */
export function Glyph({ name, tone, label, spin = false, className }: { name: string; tone?: Tone; label?: string; spin?: boolean; className?: string }) {
  return (
    <span
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      className={cn("inline-flex size-3.5 shrink-0 items-center", tone !== undefined && TONE_TEXT[tone], spin && "motion-safe:animate-spin", className)}
    >
      <Icon name={name} className="size-full" aria-hidden />
    </span>
  );
}

/**
 * A service's logo, whose accessible name is the service's name unless `decorative`, for where the words beside it
 * already name the service. GitHub's is drawn by bb in the text colour; the others are their brands' own artwork.
 */
export function ServiceLogo({ service, decorative = false, className }: { service: Service; decorative?: boolean; className?: string }) {
  const label = decorative ? undefined : SERVICE_NAMES[service];
  const artwork = BRAND_ARTWORK[service];
  if (artwork !== undefined) return <BrandLogo service={service} artwork={artwork} label={label} className={className} />;
  return <Glyph name={SERVICE_LOGOS[service]!} label={label} className={className} />;
}
