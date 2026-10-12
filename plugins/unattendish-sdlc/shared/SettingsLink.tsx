import { experimental_usePluginId, UrlLink } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";

/**
 * A link to this plugin's settings section. bb gives a page no call that opens it, so this is
 * a link to the plugin's detail page in Extensions, where `settingsSection` slots render.
 */
export function SettingsLink({ children, className }: { children: string; className?: string }) {
  const pluginId = experimental_usePluginId();
  return (
    <UrlLink
      href={`/extensions/plugins/${pluginId}`}
      className={cn("text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground", className)}
    >
      {children}
    </UrlLink>
  );
}
