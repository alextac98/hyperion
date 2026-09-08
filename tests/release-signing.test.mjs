import assert from "node:assert/strict";
import { test } from "node:test";
import { signingPlan, runBuild } from "../scripts/build-release.mjs";

const credentials = {
  MACOS_CERTIFICATE: "certificate-secret",
  MACOS_CERTIFICATE_PASSWORD: "password-secret",
  APPLE_ID: "apple-id-secret",
  APPLE_APP_SPECIFIC_PASSWORD: "app-password-secret",
  APPLE_TEAM_ID: "team-secret",
};

test("missing or partial Mac credentials warn and cannot accidentally sign or notarize", () => {
  for (const missing of Object.keys(credentials)) {
    const env = {
      ...credentials,
      [missing]: "",
      CSC_LINK: "ambient",
      WIN_CSC_LINK: "ambient",
      APPLE_API_KEY: "ambient",
      PATH: "keep",
    };
    const plan = signingPlan("darwin", env);
    assert.equal(plan.signed, false);
    assert(plan.warning.includes(missing));
    assert.deepEqual(plan.config.mac, {
      identity: "-",
      hardenedRuntime: false,
      notarize: false,
    });
    assert.equal(plan.environment.CSC_LINK, undefined);
    assert.equal(plan.environment.WIN_CSC_LINK, undefined);
    assert.equal(plan.environment.APPLE_API_KEY, undefined);
    assert.equal(plan.environment.APPLE_ID, undefined);
    assert.equal(plan.environment.PATH, "keep");
    for (const secret of Object.values(credentials))
      assert(!plan.warning.includes(secret));
  }
  assert(signingPlan("darwin", {}).warning);
});

test("complete Mac credentials enable required signing and notarization without a warning", () => {
  const plan = signingPlan("darwin", credentials);
  assert.equal(plan.signed, true);
  assert.equal(plan.warning, undefined);
  assert.equal(plan.config.forceCodeSigning, true);
  assert.deepEqual(plan.config.mac, { hardenedRuntime: true, notarize: true });
  assert.equal(plan.environment.CSC_LINK, credentials.MACOS_CERTIFICATE);
  assert.equal(
    plan.environment.CSC_KEY_PASSWORD,
    credentials.MACOS_CERTIFICATE_PASSWORD,
  );
  assert.equal(plan.environment.APPLE_TEAM_ID, credentials.APPLE_TEAM_ID);
});

test("Windows and Linux build normally without signing credentials or warnings", async () => {
  for (const platform of ["win32", "linux"]) {
    const plan = signingPlan(platform, {
      ...credentials,
      CSC_LINK: "ambient",
      WIN_CSC_LINK: "ambient",
    });
    assert.equal(plan.signed, false);
    assert.equal(plan.warning, undefined);
    assert.equal(plan.environment.CSC_LINK, undefined);
    assert.equal(plan.environment.WIN_CSC_LINK, undefined);
    assert.equal(plan.environment.CSC_IDENTITY_AUTO_DISCOVERY, "false");
    const logs = [];
    await runBuild(
      plan,
      async () => {},
      (message) => logs.push(message),
    );
    assert.deepEqual(logs, ["Package build passed."]);
  }
});

test("unsigned Mac fallback warns but succeeds; configured signing failures propagate", async () => {
  const logs = [];
  await runBuild(
    signingPlan("darwin", {}),
    async () => {},
    (message) => logs.push(message),
  );
  assert(logs[0].startsWith("::warning::macOS:"));
  assert.equal(logs.at(-1), "Package build passed.");
  logs.length = 0;
  await assert.rejects(
    runBuild(
      signingPlan("darwin", credentials),
      async () => {
        throw new Error("Signing failed");
      },
      (message) => logs.push(message),
    ),
    /Signing failed/,
  );
  assert(!logs.some((message) => message.includes("passed")));
  logs.length = 0;
  await runBuild(
    signingPlan("darwin", credentials),
    async () => {},
    (message) => logs.push(message),
  );
  assert.equal(logs.at(-1), "Signed package build passed.");
});
