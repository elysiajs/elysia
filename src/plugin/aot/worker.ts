import { parentPort, workerData } from 'node:worker_threads'

import { generateCompiledArtifacts, type ElysiaAotOptions } from './core'
import type { AotModuleCondition } from './source'

const port = parentPort

if (!port && !process.send)
	throw new Error('[elysia-aot] capture requires a parent channel')

const { file, options, moduleCondition } = (
	port ? workerData : JSON.parse(process.argv[2])
) as {
	file: string
	options?: ElysiaAotOptions
	moduleCondition: AotModuleCondition
}

const send = (message: unknown) =>
	port ? port.postMessage(message) : process.send!(message)

generateCompiledArtifacts(file, options, moduleCondition).then(
	(artifacts) => send({ ok: true, artifacts }),
	(error: unknown) => {
		const failure =
			error instanceof Error
				? {
						name: error.name,
						message: error.message,
						stack: error.stack
					}
				: { name: 'Error', message: String(error) }

		send({ ok: false, error: failure })
	}
)
