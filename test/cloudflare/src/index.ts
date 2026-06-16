// Cloudflare Worker entry for the AOT smoke test (`wrangler.jsonc` `main`).
//
// The frozen manifest registers the validators + handlers (it `import { Compiled }
// from 'elysia'` — the same instance the app reads) BEFORE the app boots; then the
// app serves with NO runtime eval. The real esbuild plugin injects this import
// automatically; done by hand here so Wrangler's own bundler handles the workerd
// specifics. The app lives in `./app.mjs` (a manifest-free module so `gen-node.mjs`
// can import + capture it). The header codegen is a build-time decision, so the
// manifest is generated under **Node** (which, like workerd, has no `Headers.toJSON`
// → `Object.fromEntries`); `setImmediate` is a runtime check so it's already portable.
//
// Regenerate the manifest + run the smoke test with `bun run test` (the `test:cf`
// script from the repo root), or `node gen-node.mjs && bun script/smoke.ts`.
import './manifest.generated.js'

export { default } from './app.mjs'
