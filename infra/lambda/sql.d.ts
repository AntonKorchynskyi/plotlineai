/** SQL files import as their text: esbuild's text loader in the bundles, vitest.config.ts in tests. */
declare module "*.sql" {
  const text: string;
  export default text;
}
