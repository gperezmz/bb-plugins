// What a tool check may run. A tool check runs on every machine without
// approval, so it must not be able to run code: only a version flag, and
// never through a program that launches other programs or fetches packages.
// Anything else belongs in `checks`, which the engineer approves.

/**
 * Flags any tool may be asked for. `-v` is left out (some tools read it as
 * "verbose" and run), and so is `-version`: getopt-style programs read it as
 * `-v -e -r …`. JVM tools, which do use `-version`, are listed below.
 */
const VERSION_FLAGS: readonly (readonly string[])[] = [["--version"], ["-V"]];
const SINGLE_DASH_VERSION_TOOLS = new Set(["java", "javac", "jshell", "kotlin", "kotlinc", "scala", "scalac", "clojure", "groovy"]);

/** `<bin> version` subcommands, only for tools where that just prints a version. */
const VERSION_SUBCOMMANDS: readonly (readonly string[])[] = [["version"], ["version", "--client"], ["version", "--short"]];
const SUBCOMMAND_TOOLS = new Set([
  "go", "kubectl", "docker", "podman", "helm", "terraform", "tofu", "oc", "istioctl", "flux", "argocd",
  "kustomize", "pulumi", "gcloud", "az", "hugo", "k9s", "kind", "minikube", "skaffold", "vault", "consul", "nomad",
]);

/**
 * Programs that run other programs or install packages from their arguments
 * (`env`, `npx`, `sudo`…). Never allowed as a tool check, whatever the args.
 */
export const LAUNCHERS = new Set([
  "env", "npx", "pnpx", "bunx", "uvx", "pipx", "dlx", "sudo", "doas", "su", "runuser", "pkexec", "run0", "sg", "newgrp",
  "systemd-run", "machinectl", "nsenter", "unshare", "bwrap", "firejail", "chroot", "fakeroot", "proot",
  "xargs", "parallel", "timeout", "nice", "renice", "ionice", "chrt", "taskset", "cpulimit", "nohup", "setsid",
  "stdbuf", "flock", "watch", "time", "exec", "command", "builtin", "eval", "busybox", "toybox",
  "strace", "ltrace", "gdb", "lldb", "valgrind", "perf", "script", "expect", "screen", "tmux",
  "ssh", "ssh-agent", "dbus-launch", "dbus-run-session", "caffeinate", "arch", "open", "xdg-open", "start",
  "osascript", "launchctl", "at", "batch", "crontab",
]);

/**
 * The deny list is a second line: the version flags themselves print a
 * version and exit in the programs that honour them. Names compare
 * case-insensitively, since macOS finds `Sudo` as `sudo`.
 */
export function isVersionProbe(rawBin: string, args: readonly string[]): boolean {
  const bin = rawBin.toLowerCase();
  if (LAUNCHERS.has(bin)) return false;
  const matches = (list: readonly (readonly string[])[]) =>
    list.some((probe) => probe.length === args.length && probe.every((arg, index) => arg === args[index]));
  return (
    matches(VERSION_FLAGS) ||
    (SINGLE_DASH_VERSION_TOOLS.has(bin) && matches([["-version"]])) ||
    (SUBCOMMAND_TOOLS.has(bin) && matches(VERSION_SUBCOMMANDS))
  );
}

export const VERSION_PROBE_HINT =
  "a tool check runs a version flag only: --version or -V (and -version for JVM tools, `version` for tools such as go, kubectl or docker), never through env, npx, sudo or another launcher. Use a team check for anything else.";
