// A project's mark: its icon (an upload, else the favicon the server finds),
// or its monogram while there is none, it has not loaded, or it failed (see
// `iconLoader`, which asks for each project's icon once). The monogram is the
// first meaningful word's letter on a tile; with project colours on the tile
// takes the project colour at 20 %.
import { useEffect, useSyncExternalStore } from "react";
import { projectIconUrl } from "@/shared/project-icon";
import { cn } from "@/lib/utils";
import { MONOGRAM_ALPHA, withAlpha, type ProjectColour } from "../model/project-colour";
import { MONOGRAM_TILE_COLOURS, monogramLetter, monogramTile } from "../model/monogram";
import { useAppearance } from "../sync/hooks";
import { iconLoader } from "./icon-loader";

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
  useEffect(() => {
    iconLoader.want(projectId, src);
  }, [projectId, src]);
  const url = useSyncExternalStore(iconLoader.subscribe, () => iconLoader.url(projectId, src));
  if (url === null) return <ProjectMonogram name={name} colour={colour} className={className} />;
  return <img src={url} alt="" data-project-icon="" className={cn("size-3.5 shrink-0 rounded-sm object-contain", className)} onLoad={() => iconLoader.drawn(projectId, src)} onError={() => iconLoader.broke(projectId, src)} />;
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
