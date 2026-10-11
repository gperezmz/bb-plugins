// A project's mark: its icon (an upload, else the favicon the server finds),
// or its monogram while there is none, it has not loaded, or it failed. The
// monogram is the first meaningful word's letter on a tile; with project
// colours on the tile takes the project colour at 20 %.
import { useEffect, useReducer } from "react";
import { projectIconUrl } from "@/shared/project-icon";
import { cn } from "@/lib/utils";
import { MONOGRAM_ALPHA, withAlpha, type ProjectColour } from "../model/project-colour";
import { MONOGRAM_TILE_COLOURS, monogramLetter, monogramTile } from "../model/monogram";
import { useAppearance } from "../sync/hooks";
import { iconHealth } from "./icon-health";

/** Icon URLs that have loaded once in this window; they draw at once on later rows. */
const loadedUrls = new Map<string, string>();

function attemptUrl(src: string, attempt: number): string {
  return attempt === 0 ? src : `${src}&attempt=${attempt}`;
}

/** The letter tile of a project without an icon. */
export function ProjectMonogram({ name, colour, className }: { name: string; colour: ProjectColour | null; className?: string }) {
  const tile = colour?.fill ?? MONOGRAM_TILE_COLOURS[monogramTile(name)]!;
  return (
    <span
      aria-hidden
      data-monogram=""
      style={{ backgroundColor: withAlpha(tile, MONOGRAM_ALPHA), color: colour?.text }}
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] text-[8px] font-semibold leading-none",
        colour === null && "text-muted-foreground",
        className,
      )}
    >
      {monogramLetter(name)}
    </span>
  );
}

/**
 * The project's mark. `colour` is its project colour while colours are on
 * (see `useProjectColour`), else null.
 */
export function ProjectMark({ projectId, name, colour, className }: { projectId: string; name: string; colour: ProjectColour | null; className?: string }) {
  const upload = useAppearance().icons[projectId];
  const src = projectIconUrl(projectId, upload?.updatedAt);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const now = Date.now();
  const retryAt = iconHealth.retryAt(projectId, now);
  useEffect(() => {
    if (retryAt === null) return;
    const timer = setTimeout(rerender, Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [retryAt]);
  const attempt = iconHealth.attempt(projectId);
  const failed = (failedAttempt: number) => {
    loadedUrls.delete(src);
    iconHealth.failed(projectId, failedAttempt, Date.now());
    rerender();
  };
  const fallback = <ProjectMonogram name={name} colour={colour} className={className} />;
  if (retryAt !== null) return fallback;
  const loaded = loadedUrls.get(src);
  if (loaded !== undefined) {
    return <img src={loaded} alt="" data-project-icon="" className={cn("size-3.5 shrink-0 rounded-sm object-contain", className)} onError={() => failed(0)} />;
  }
  const url = attemptUrl(src, attempt);
  // The monogram stands in until the image has loaded, so a missing icon never shows a broken one.
  return (
    <span aria-hidden className={cn("relative inline-flex size-3.5 shrink-0", className)}>
      {fallback}
      <img
        src={url}
        alt=""
        className="hidden"
        onLoad={() => {
          iconHealth.loaded(projectId);
          loadedUrls.set(src, url);
          rerender();
        }}
        onError={() => failed(attempt)}
      />
    </span>
  );
}

/** A project's name in its colour (readable on the theme), muted while colours are off. */
export function ProjectName({ name, colour, className }: { name: string; colour: ProjectColour | null; className?: string }) {
  return (
    <span style={colour === null ? undefined : { color: colour.text }} data-project-name="" className={cn(colour === null && "text-muted-foreground", className)}>
      {name}
    </span>
  );
}

/** A 2 px bar at a row's left edge in the project colour; its row must be `relative`. */
export function ProjectStripe({ colour }: { colour: ProjectColour | null }) {
  if (colour === null) return null;
  return <span aria-hidden data-project-stripe="" style={{ backgroundColor: colour.fill }} className="pointer-events-none absolute inset-y-1.5 left-0 w-0.5 rounded-full" />;
}
