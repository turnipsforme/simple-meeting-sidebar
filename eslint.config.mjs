import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
  globalIgnores([
    "node_modules",
    "main.js",
    "release",
    "runtime",
    "tests",
    "esbuild.config.mjs",
    "eslint.config.mjs",
    "package.json",
    "package-lock.json",
    "versions.json",
  ]),
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".json"],
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", {
        brands: [
          "Simple Meeting Sidebar",
          "Apple",
          "Google Meet",
          "Mac",
          "Advanced URI",
          "#Person",
          "Wren",
          "Dana Smith",
          "Obsidian",
        ],
        acronyms: ["URI"],
      }],
    },
  },
);
