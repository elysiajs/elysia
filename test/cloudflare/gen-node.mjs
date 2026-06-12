// Generate the frozen manifest under NODE for a workerd deploy.
//
// The handler header codegen is a BUILD-time decision (`hasHeaderShorthand` —
// Bun's `Headers.toJSON()` vs the standard `Object.fromEntries`). Generating under
// Bun would bake `toJSON()`, which workerd lacks → crash. Node, like workerd, has
// no `Headers.toJSON`, so a Node-generated manifest bakes `Object.fromEntries` and
// runs on workerd. (`setImmediate` is a runtime check in the codegen, so it's
// already portable regardless of where this runs.)
import { generateCompiledModule } from '../../dist/plugin/core.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const entry = resolve(here, 'src/app.mjs')
const source = await generateCompiledModule(entry, { registerFrom: 'elysia' })
writeFileSync(resolve(here, 'src/manifest.generated.js'), source)
console.log(
	`wrote manifest under Node (isBun=${typeof Bun !== 'undefined'}) — ${source.length} bytes`
)
