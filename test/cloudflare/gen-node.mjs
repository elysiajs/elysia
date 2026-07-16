// Generate under Node so the manifest uses Headers APIs supported by workerd.
import { generateCompiledModule } from '../../dist/plugin/aot/core.mjs'
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
