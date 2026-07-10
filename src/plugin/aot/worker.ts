import { parentPort, workerData } from 'node:worker_threads'

import { generateCompiledArtifacts, type ElysiaAotOptions } from './core'

const port = parentPort

if (!port) throw new Error('[elysia-aot] worker requires a parent port')

const { file, options } = workerData as {
	file: string
	options?: ElysiaAotOptions
}

generateCompiledArtifacts(file, options).then(
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
