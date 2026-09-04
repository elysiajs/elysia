import { parentPort, workerData } from 'node:worker_threads'

import { generateCompiledArtifacts, type ElysiaAotOptions } from './core'
import type { AotModuleCondition } from './source'

const port = parentPort

if (!port) throw new Error('[elysia-aot] worker requires a parent port')

const { file, options, moduleCondition } = workerData as {
	file: string
	options?: ElysiaAotOptions
	moduleCondition: AotModuleCondition
}

generateCompiledArtifacts(file, options, moduleCondition).then(
	(artifacts) => port.postMessage({ ok: true, artifacts }),
	(error: unknown) => {
		const failure =
			error instanceof Error
				? {
						name: error.name,
						message: error.message,
						stack: error.stack
					}
				: { name: 'Error', message: String(error) }

		port.postMessage({ ok: false, error: failure })
	}
)
