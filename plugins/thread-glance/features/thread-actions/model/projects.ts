// The Project ▸ dialogs' rules: the limits of the fields, and when a typed
// name confirms a removal. Pure.

/** The longest project name Rename project accepts. */
export const MAX_PROJECT_NAME_LENGTH = 500;
/** The longest folder path Add local path accepts. */
export const MAX_LOCAL_PATH_LENGTH = 4_096;

/** Why `name` cannot be a project's name, or null. */
export function projectNameError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Enter a name.";
  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) return `Use at most ${MAX_PROJECT_NAME_LENGTH} characters.`;
  return null;
}

/** Why `path` cannot be added as a local path, or null. */
export function localPathError(path: string): string | null {
  const trimmed = path.trim();
  if (trimmed === "") return "Enter a folder.";
  if (trimmed.length > MAX_LOCAL_PATH_LENGTH) return `Use at most ${MAX_LOCAL_PATH_LENGTH.toLocaleString("en-US")} characters.`;
  return null;
}

/** Whether `typed` is exactly the project's name, which Remove project needs. */
export function confirmsRemoval(typed: string, projectName: string): boolean {
  return typed === projectName;
}
