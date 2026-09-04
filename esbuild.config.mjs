import esbuild from "esbuild";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { builtinModules } from "node:module";

const production = process.argv[2] === "production";
const helperBinaryPlugin = {
  name: "calendar-helper-binary",
  setup(build) {
    build.onResolve({ filter: /^calendar-helper-binary$/ }, () => ({
      path: "calendar-helper-binary",
      namespace: "calendar-helper",
    }));
    build.onLoad({ filter: /.*/, namespace: "calendar-helper" }, async () => {
      const helper = await readFile(new URL("./runtime/calendar-helper", import.meta.url));
      return {
        contents: `export default ${JSON.stringify(helper.toString("base64"))};`,
        loader: "js",
      };
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    ...builtinModules,
    ...builtinModules.map((moduleName) => `node:${moduleName}`),
  ],
  format: "cjs",
  platform: "node",
  target: "es2022",
  treeShaking: true,
  plugins: [helperBinaryPlugin],
  minify: production,
  sourcemap: production ? false : "inline",
  outfile: "main.js",
  logLevel: "info",
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
