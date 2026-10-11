// How the browser asks the server for a project's icon. Nothing here imports
// the SDK, so the app bundle can use it.

/** The plugin's id, which bb puts in the path of its HTTP routes. */
export const PLUGIN_ID = "thread-glance";

/** The route the server registers, relative to the plugin's HTTP root. */
export const PROJECT_ICON_ROUTE = "/project-icon";

/** The most an icon, uploaded or found in a project, may weigh. */
export const MAX_ICON_BYTES = 1_048_576;

/** The image types an icon may be, as the upload refusal names them. */
export const ICON_TYPES_LABEL = "SVG, PNG, ICO, JPEG, GIF, AVIF or WebP";

/**
 * The URL the browser reads a project's icon from. bb mounts the route under
 * `/api/v1/plugins/<id>/http`, and a same-origin request passes bb's local
 * auth. The browser asks for it once per page load, so `uploadedAt`, the
 * upload time of an uploaded icon, is what makes a new upload or its removal
 * be asked for again; a project that uses its favicon passes none, and a
 * favicon that changes shows after the page next loads.
 */
export function projectIconUrl(projectId: string, uploadedAt?: number): string {
  const query = new URLSearchParams({ project: projectId });
  if (uploadedAt !== undefined) query.set("v", String(uploadedAt));
  return `/api/v1/plugins/${PLUGIN_ID}/http${PROJECT_ICON_ROUTE}?${query}`;
}
