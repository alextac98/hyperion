import { pathToFileURL } from "node:url";

const requirements = {
  darwin: [
    "MACOS_CERTIFICATE",
    "MACOS_CERTIFICATE_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
  ],
};

export function signingPlan(platform, env) {
  if (!["darwin", "win32", "linux"].includes(platform)) {
    throw new Error(`Unsupported release platform: ${platform}`);
  }
  const required = requirements[platform] ?? [];
  const missing = required.filter((key) => !env[key]?.trim());
  const signed = required.length > 0 && missing.length === 0;
  const environment = { ...env };
  // Ignore incomplete credentials and ambient signing identities in fallback mode.
  for (const key of [
    ...Object.values(requirements).flat(),
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "CSC_NAME",
    "WIN_CSC_LINK",
    "WIN_CSC_KEY_PASSWORD",
    "APPLE_API_KEY",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER",
    "APPLE_KEYCHAIN",
    "APPLE_KEYCHAIN_PROFILE",
  ])
    delete environment[key];
  environment.CSC_IDENTITY_AUTO_DISCOVERY = signed ? "true" : "false";
  const config = {
    extends: "./electron-builder.yml",
    forceCodeSigning: signed,
  };
  if (platform === "darwin") {
    config.mac = signed
      ? { hardenedRuntime: true, notarize: true }
      : { identity: "-", hardenedRuntime: false, notarize: false };
    if (signed) {
      environment.CSC_LINK = env.MACOS_CERTIFICATE;
      environment.CSC_KEY_PASSWORD = env.MACOS_CERTIFICATE_PASSWORD;
      for (const key of requirements.darwin.slice(2))
        environment[key] = env[key];
    }
  }
  const warning = missing.length
    ? `macOS: missing ${missing.join(", ")}. Continuing with ad-hoc signing and without notarization.`
    : undefined;
  return { config, environment, signed, warning };
}

// Report success only after the actual signing/notarization build succeeds.
export async function runBuild(plan, build, log = console.log) {
  if (plan.warning) log(`::warning::${plan.warning}`);
  else if (plan.signed) log("Signing credentials present; signing enabled.");
  await build(plan.config);
  log(plan.signed ? "Signed package build passed." : "Package build passed.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const arch = process.argv[2];
  if (!["x64", "arm64"].includes(arch))
    throw new Error(`Unsupported architecture: ${arch}`);
  const plan = signingPlan(process.platform, process.env);
  for (const key of Object.keys(process.env)) {
    if (!(key in plan.environment)) delete process.env[key];
  }
  Object.assign(process.env, plan.environment);
  const { build, Platform, Arch } = await import("electron-builder");
  const platform = {
    darwin: Platform.MAC,
    win32: Platform.WINDOWS,
    linux: Platform.LINUX,
  }[process.platform];
  await runBuild(plan, (config) =>
    build({
      targets: platform.createTarget(undefined, Arch[arch]),
      config,
      publish: "never",
    }),
  );
}
