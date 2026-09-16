import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const result = await build({
  stdin: {
    contents: `
  export * from './blocks/registry.ts';
  export * from './blocks/document.ts';
  export * from './blocks/retired.ts';
  export * from './blocks/rating/definition.ts';
  export { remapDocument, restoreDocument, documentMetadata, assetReferences } from './electron/data-format.ts';
  export { pageChanges } from './app/lib/page-diff.ts';
  export * as Y from 'yjs';
`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const {
  removeRetiredBlocks,
  retiredBlockFlavours,
  Y,
  createBlockRegistry,
  ratingDefinition,
  blockRegistry,
  projectBlock,
  readBlock,
  readDocumentMetadata,
  migrateBlocks,
  remapDocument,
  restoreDocument,
  documentMetadata,
  assetReferences,
  pageChanges,
  isBlockAvailable,
} = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
const encoded = (doc) =>
  Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
function fixture(flavour = "hyperion:rating", version = 1) {
  const doc = new Y.Doc();
  const blocks = doc.getMap("blocks");
  blocks.set(
    "root",
    new Y.Map([
      ["sys:flavour", "affine:page"],
      ["prop:title", new Y.Text("Review")],
      ["sys:children", Y.Array.from(["rating"])],
    ]),
  );
  blocks.set(
    "rating",
    new Y.Map([
      ["sys:id", "rating"],
      ["sys:flavour", flavour],
      ["sys:version", version],
      ["sys:children", Y.Array.from([])],
      ["prop:label", "Book"],
      ["prop:value", 4],
    ]),
  );
  return doc;
}

test("registry rejects collisions, malformed IDs, versions and defaults", () => {
  assert.throws(
    () => createBlockRegistry([ratingDefinition, ratingDefinition]),
    /Duplicate/,
  );
  assert.throws(
    () => createBlockRegistry([{ ...ratingDefinition, flavour: "rating" }]),
    /Invalid block ID/,
  );
  assert.throws(
    () => createBlockRegistry([{ ...ratingDefinition, version: 0 }]),
    /version/,
  );
  assert.throws(
    () =>
      createBlockRegistry([
        { ...ratingDefinition, defaults: () => ({ value: 8 }) },
      ]),
    /defaults/,
  );
});

test("rating projects identically for live metadata, persisted history and diffs", () => {
  const doc = fixture();
  const note = { title: "Review", body: "", tags: [], icon: null };
  const before = { note, document: encoded(doc) };
  assert.deepEqual(readDocumentMetadata(doc.getMap("blocks")), {
    title: "Review",
    body: "Book: 4/5",
  });
  assert.deepEqual(
    documentMetadata(Y.encodeStateAsUpdate(doc)),
    readDocumentMetadata(doc.getMap("blocks")),
  );
  doc.getMap("blocks").get("rating").set("prop:value", 2);
  assert.ok(
    pageChanges(before, { note, document: encoded(doc) }).some(
      (change) =>
        change.label === "Rating" &&
        change.before === "Book: 4/5" &&
        change.after === "Book: 2/5",
    ),
  );
  doc.destroy();
});

test("unavailable and future blocks are not migrated, coerced or dropped", () => {
  for (const [flavour, version] of [
    ["other:widget", 1],
    ["hyperion:rating", 99],
  ]) {
    const doc = fixture(flavour, version);
    const blocks = doc.getMap("blocks");
    const before = encoded(doc);
    migrateBlocks(blocks);
    assert.equal(encoded(doc), before);
    assert.equal(
      isBlockAvailable(readBlock("rating", blocks.get("rating"))),
      false,
    );
    assert.equal(
      isBlockAvailable(readBlock("rating", blocks.get("rating")), new Map()),
      false,
    );
    doc.destroy();
  }
});

test("ordered migrations are atomic, idempotent and preserve extra properties", () => {
  const doc = fixture();
  const blocks = doc.getMap("blocks");
  const rating = blocks.get("rating");
  rating.set("prop:extra", { keep: true });
  const upgraded = {
    ...ratingDefinition,
    version: 3,
    migrations: {
      1: (props) => ({ ...props, value: props.value + 1 }),
      2: (props) => ({ ...props, label: "Updated" }),
    },
  };
  const registry = createBlockRegistry([upgraded]);
  migrateBlocks(blocks, registry);
  assert.equal(rating.get("sys:version"), 3);
  assert.equal(rating.get("prop:value"), 5);
  assert.deepEqual(rating.get("prop:extra"), { keep: true });
  const before = encoded(doc);
  migrateBlocks(blocks, registry);
  assert.equal(encoded(doc), before);
  const failed = fixture();
  const second = new Y.Map([
    ["sys:flavour", "other:bad"],
    ["sys:version", 1],
  ]);
  failed.getMap("blocks").set("bad", second);
  const failingRegistry = createBlockRegistry([
    upgraded,
    {
      ...ratingDefinition,
      flavour: "other:bad",
      version: 2,
      migrations: {
        1: () => {
          throw new Error("Failed conversion");
        },
      },
    },
  ]);
  const unchanged = encoded(failed);
  assert.throws(
    () => migrateBlocks(failed.getMap("blocks"), failingRegistry),
    /Failed conversion/,
  );
  assert.equal(encoded(failed), unchanged);
  doc.destroy();
  failed.destroy();
});

test("missing migrations and unsupported rich values leave original data intact", () => {
  const doc = fixture();
  const blocks = doc.getMap("blocks");
  const registry = createBlockRegistry([{ ...ratingDefinition, version: 2 }]);
  const before = encoded(doc);
  assert.throws(() => migrateBlocks(blocks, registry), /Missing migration/);
  assert.equal(encoded(doc), before);
  blocks.get("rating").set("prop:rich", new Y.Text("Keep formatting"));
  const richBefore = encoded(doc);
  assert.throws(
    () => migrateBlocks(blocks, registry),
    /Unsupported block migration/,
  );
  assert.equal(encoded(doc), richBefore);
  doc.destroy();
});

test("custom and unavailable blocks remap explicit references without changing ordinary strings", () => {
  for (const flavour of ["hyperion:rating", "third-party:widget"]) {
    const doc = fixture(flavour);
    const rating = doc.getMap("blocks").get("rating");
    rating.set("prop:label", "old-page");
    rating.set("prop:references", {
      pages: { related: "old-page" },
      assets: { cover: "asset-key" },
      future: { keep: true },
    });
    const target = new Y.Doc();
    Y.applyUpdate(
      target,
      Buffer.from(
        remapDocument(encoded(doc), new Map([["old-page", "new-page"]])),
        "base64",
      ),
    );
    const props = target.getMap("blocks").get("rating");
    assert.equal(props.get("prop:label"), "old-page");
    assert.deepEqual(props.get("prop:references"), {
      pages: { related: "new-page" },
      assets: { cover: "asset-key" },
      future: { keep: true },
    });
    assert.deepEqual(assetReferences(Y.encodeStateAsUpdate(target)), [
      "asset-key",
    ]);
    doc.destroy();
    target.destroy();
  }
});

test("restore preserves unknown properties, formatting and children", () => {
  const doc = fixture("third-party:widget");
  const blocks = doc.getMap("blocks");
  const text = new Y.Text();
  text.insert(0, "Nested text", { bold: true });
  blocks
    .get("rating")
    .set(
      "prop:opaque",
      new Y.Map([["details", Y.Array.from([text, { future: true }])]]),
    );
  blocks.get("rating").get("sys:children").insert(0, ["child"]);
  blocks.set(
    "child",
    new Y.Map([
      ["sys:flavour", "affine:paragraph"],
      ["prop:text", new Y.Text("Child")],
    ]),
  );
  const historical = Y.encodeStateAsUpdate(doc);
  const expected = blocks.toJSON();
  blocks.get("rating").set("prop:value", 1);
  const restored = new Y.Doc();
  Y.applyUpdate(
    restored,
    restoreDocument(Y.encodeStateAsUpdate(doc), historical),
  );
  assert.deepEqual(restored.getMap("blocks").toJSON(), expected);
  assert.deepEqual(
    restored
      .getMap("blocks")
      .get("rating")
      .get("prop:opaque")
      .get("details")
      .get(0)
      .toDelta(),
    [{ insert: "Nested text", attributes: { bold: true } }],
  );
  doc.destroy();
  restored.destroy();
});

test("projection keeps standard outline behavior and invalid ratings unavailable", () => {
  assert.deepEqual(
    projectBlock({
      id: "heading",
      flavour: "affine:paragraph",
      version: 1,
      props: { type: "h2", text: "Heading" },
      children: [],
    }).outline,
    { title: "Heading", level: 2 },
  );
  assert.equal(
    blockRegistry
      .get("hyperion:rating")
      .validate({ label: "Rating", value: 6 }),
    false,
  );
});

function retiredFixture() {
  const doc = fixture("third-party:widget");
  const blocks = doc.getMap("blocks");
  const block = (flavour, props = {}, children = []) =>
    new Y.Map([
      ["sys:flavour", flavour],
      ["sys:children", Y.Array.from(children)],
      ...Object.entries(props).map(([key, value]) => ["prop:" + key, value]),
    ]);
  for (const flavour of retiredBlockFlavours)
    blocks.set(flavour, block(flavour));
  blocks.set(
    "mixed",
    block(
      "affine:database",
      {
        views: Y.Array.from([
          new Y.Map([["mode", "kanban"]]),
          new Y.Map([["mode", "table"]]),
        ]),
      },
      ["row"],
    ),
  );
  blocks.set(
    "row",
    block("affine:paragraph", { text: new Y.Text("Keep row") }),
  );
  blocks.set(
    "kanban-only",
    block("affine:database", { views: [{ mode: "kanban" }] }, ["deleted-row"]),
  );
  blocks.set(
    "deleted-row",
    block("affine:paragraph", { text: new Y.Text("Remove row") }),
  );
  blocks.set(
    "frame-ref",
    block("affine:surface-ref", {
      reference: "affine:frame",
      refFlavour: "affine:frame",
    }),
  );
  blocks.set(
    "mindmap-ref",
    block("affine:surface-ref", { reference: "map", refFlavour: "mindmap" }),
  );
  const elements = new Y.Map([
    [
      "map",
      new Y.Map([
        ["type", "mindmap"],
        ["children", new Y.Map([["node", { index: "a0" }]])],
      ]),
    ],
    ["node", new Y.Map([["type", "shape"]])],
    ["unrelated", new Y.Map([["type", "shape"]])],
    [
      "connector",
      new Y.Map([
        ["type", "connector"],
        ["source", { id: "node" }],
        ["target", { id: "unrelated" }],
      ]),
    ],
    [
      "group",
      new Y.Map([
        ["type", "group"],
        [
          "children",
          new Y.Map([
            ["node", true],
            ["unrelated", true],
          ]),
        ],
      ]),
    ],
  ]);
  blocks.set(
    "surface",
    block("affine:surface", {
      elements: new Y.Map([
        ["type", "$blocksuite:internal:native$"],
        ["value", elements],
      ]),
    }),
  );
  blocks
    .get("root")
    .get("sys:children")
    .push([
      ...retiredBlockFlavours,
      "mixed",
      "kanban-only",
      "frame-ref",
      "mindmap-ref",
      "surface",
    ]);
  return doc;
}

test("retirement deletes only selected blocks, Kanban-only rows and owned mindmap elements", () => {
  const doc = retiredFixture();
  const blocks = doc.getMap("blocks");
  const unknown = blocks.get("rating").toJSON();
  assert.equal(removeRetiredBlocks(blocks), true);
  for (const id of [
    ...retiredBlockFlavours,
    "kanban-only",
    "deleted-row",
    "frame-ref",
    "mindmap-ref",
  ])
    assert.equal(blocks.has(id), false, id);
  assert.deepEqual(blocks.get("mixed").get("prop:views").toJSON(), [
    { mode: "table" },
  ]);
  assert.equal(blocks.get("row").get("prop:text").toString(), "Keep row");
  assert.deepEqual(blocks.get("rating").toJSON(), unknown);
  const elements = blocks.get("surface").get("prop:elements").get("value");
  assert.deepEqual([...elements.keys()], ["unrelated", "group"]);
  assert.deepEqual(elements.get("group").get("children").toJSON(), {
    unrelated: true,
  });
  assert.ok(
    blocks
      .get("root")
      .get("sys:children")
      .toArray()
      .every((id) => blocks.has(id)),
  );
  const before = encoded(doc);
  assert.equal(removeRetiredBlocks(blocks), false);
  assert.equal(encoded(doc), before);
  doc.destroy();
});

test("import and history restore cannot resurrect retired content", () => {
  const doc = retiredFixture();
  const old = encoded(doc);
  removeRetiredBlocks(doc.getMap("blocks"));
  const expected = doc.getMap("blocks").toJSON();
  for (const data of [
    Buffer.from(remapDocument(old, new Map()), "base64"),
    restoreDocument(Y.encodeStateAsUpdate(doc), Buffer.from(old, "base64")),
  ]) {
    const restored = new Y.Doc();
    Y.applyUpdate(restored, data);
    assert.deepEqual(restored.getMap("blocks").toJSON(), expected);
    restored.destroy();
  }
  doc.destroy();
});

test("reference remapping preserves opaque slots and shared types in unknown blocks", () => {
  const doc = fixture("third-party:widget");
  const refs = new Y.Map([
    [
      "pages",
      new Y.Map([
        ["related", "old-page"],
        ["future", new Y.Text("opaque")],
      ]),
    ],
  ]);
  doc.getMap("blocks").get("rating").set("prop:references", refs);
  const restored = new Y.Doc();
  Y.applyUpdate(
    restored,
    Buffer.from(
      remapDocument(encoded(doc), new Map([["old-page", "new-page"]])),
      "base64",
    ),
  );
  const pages = restored
    .getMap("blocks")
    .get("rating")
    .get("prop:references")
    .get("pages");
  assert.equal(pages.get("related"), "new-page");
  assert.ok(pages.get("future") instanceof Y.Text);
  assert.equal(pages.get("future").toString(), "opaque");
  doc.destroy();
  restored.destroy();
});
