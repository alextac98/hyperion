type FeedbackSystem = {
  version: string;
  platform: NodeJS.Platform;
  systemVersion: string;
  arch: string;
};

const osNames: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

// Keep the handoff short enough for shell.openExternal on Windows. These are
// system values supplied by the main process, never page or vault metadata.
function systemValue(value: string) {
  return value.replace(/[\r\n]/g, " ").slice(0, 48);
}

export function feedbackIssueUrl(system: FeedbackSystem) {
  const os = osNames[system.platform] ?? system.platform;
  const body = `## What happened or what would you like?

<!-- Describe the problem or idea. You can attach screenshots here. -->

## What did you expect?


## Steps to reproduce (optional)

<!-- For bugs, list the steps that lead to the problem. -->

## System information

- Hyperion: ${systemValue(system.version)}
- OS: ${os} ${systemValue(system.systemVersion)}
- Architecture: ${systemValue(system.arch)}
`;
  const url = new URL("https://github.com/alextac98/hyperion/issues/new");
  url.searchParams.set("template", "feedback.md");
  url.searchParams.set("body", body);
  return url.toString();
}
