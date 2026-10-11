// The thread actions feature's public API: the registration of Thread Glance's
// actions in bb's thread menu, the dialogs they open, and the typed-name
// confirmation the settings page's Project management reuses.
export { registerThreadActions } from "./registrations";
export { ThreadActionDialogs } from "./components/ThreadActionDialogs";
export { removeProject, RemoveProjectConfirmation, REMOVE_WARNING, type RemoveProjectConfirmationProps } from "./components/RemoveProject";
