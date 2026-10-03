import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      // The Lambda bundles import SQL files as text (esbuild --loader:.sql=text); do the same here.
      name: "sql-as-text",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith(".sql")) return { code: `export default ${JSON.stringify(code)};`, map: null };
      },
    },
  ],
});
