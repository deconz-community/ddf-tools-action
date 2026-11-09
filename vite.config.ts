import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    // DDF fixtures: their exact content is part of the bundle hash
    ignorePatterns: ["tests/**"],
  },
  lint: {
    plugins: ["oxc", "typescript", "unicorn", "import"],
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
    categories: {
      correctness: "warn",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    env: {
      builtin: true,
      es2026: true,
      node: true,
    },
    ignorePatterns: [
      "**/node_modules",
      "**/dist",
      "**/coverage",
      "**/*.log",
      "**/.changeset",
      "**/CHANGELOG*.md",
      "**/LICENSE*",
      "**/pnpm-lock.yaml",
      "**/.claude",
      "**/.agents",
      ".history",
      ".vscode",
      "tests",
    ],
  },
  // GitHub Actions runs `dist/index.mjs` as is, without installing dependencies,
  // so the action must be bundled into that single file.
  pack: {
    entry: ["index.ts"],
    format: "esm",
    platform: "node",
    target: "node24",
    clean: true,
    dts: false,
    alias: {
      // The default UMD build hides its `require` calls from the bundler
      "jsonc-parser": "jsonc-parser/lib/esm/main.js",
    },
    deps: {
      // Bundle every dependency
      alwaysBundle: [/.*/],
      onlyBundle: false,
    },
    outputOptions: {
      // A single output file: the release commit only contains `action.yml` and `dist/index.mjs`
      codeSplitting: false,
    },
  },
});
