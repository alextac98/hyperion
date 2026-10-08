import assert from "node:assert/strict";
import test from "node:test";
import { capturePage } from "./capture-page.mjs";

test("a transient compositor failure still produces a screenshot", async () => {
  const screenshot = {};
  let attempts = 0;
  const image = await capturePage({
    async capturePage() {
      if (attempts++ === 0) throw new Error("UnknownVizError");
      return screenshot;
    },
  });
  assert.equal(image, screenshot);
});

test("persistent compositor failures fail the test", async () => {
  const error = new Error("UnknownVizError");
  let attempts = 0;
  await assert.rejects(
    capturePage({
      async capturePage() {
        attempts++;
        throw error;
      },
    }),
    (cause) => cause === error,
  );
  assert.equal(attempts, 3);
});

test("other screenshot failures are reported immediately", async () => {
  const error = new Error("WebContents was destroyed");
  let attempts = 0;
  await assert.rejects(
    capturePage({
      async capturePage() {
        attempts++;
        throw error;
      },
    }),
    (cause) => cause === error,
  );
  assert.equal(attempts, 1);
});
