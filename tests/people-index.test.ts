import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import type { App } from "obsidian";

// Exercise the real index without loading the desktop app.
test("ignored people cannot return through titles or aliases, and invalidation updates matches", async () => {
  const bundled = await build({
    entryPoints: ["src/people-index.ts"], bundle: true, platform: "node", format: "cjs", write: false,
    plugins: [{ name: "obsidian-test", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents:
        "export class TFile {} export function getAllTags(cache) { return cache.tags; }" }));
    } }],
  });
  const module = { exports: {} as typeof import("../src/people-index") };
  new Function("module", "exports", bundled.outputFiles[0]!.text)(module, module.exports);
  const files = [
    { path: "People/Wren.md", basename: "Wren", aliases: ["Bird"] },
    { path: "People/Dana Smith.md", basename: "Dana Smith", aliases: ["D"] },
    { path: "People/Dana Jones.md", basename: "Dana Jones", aliases: [] },
  ];
  const app = {
    vault: { getMarkdownFiles: () => files },
    metadataCache: { getFileCache: (file: typeof files[number]) => ({
      tags: ["#Person"], frontmatter: { aliases: file.aliases },
    }) },
  } as unknown as App;
  let ignored = "Wren, Dana Smith";
  const index = new module.exports.PeopleIndex(app, () => "People", () => true, () => ignored);
  assert.equal(index.find("Meeting with Wren", ["Wren"]), null);
  assert.equal(index.find("Meeting with Bird"), null);
  assert.equal(index.find("Meeting with Dana Smith"), null);
  assert.equal(index.find("Meeting with D"), null);
  assert.equal(index.find("Meeting with Dana Jones")?.file.path, "People/Dana Jones.md");
  assert.equal(index.find("Wren and Dana Jones")?.file.path, "People/Dana Jones.md");
  ignored = ""; index.invalidate();
  assert.equal(index.find("Meeting with Bird")?.file.path, "People/Wren.md");
});
