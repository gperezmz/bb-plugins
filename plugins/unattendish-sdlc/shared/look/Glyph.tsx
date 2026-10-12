import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
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
 * A service's logo, whose accessible name is the service's name unless `decorative`; the service's name in small muted
 * type for a service with no logo to show.
 */
export function ServiceLogo({ service, decorative = false, className }: { service: Service; decorative?: boolean; className?: string }) {
  const logo = SERVICE_LOGOS[service];
  if (logo === undefined) return <span className={cn("shrink-0 text-xs text-muted-foreground", className)}>{SERVICE_NAMES[service]}</span>;
  return <Glyph name={logo} label={decorative ? undefined : SERVICE_NAMES[service]} className={className} />;
}
