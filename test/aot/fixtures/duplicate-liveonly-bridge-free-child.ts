// Bridge-free app (`elysia/base` + raw TSchema, no `t`) that ALSO has a
// registered + claimed AOT program, so the exact-duplicate loser compiles with
// `liveOnly` — the one route barred from both frozen-validator fallbacks.
import { Elysia } from '../../../src/base'
import { Compiled, createAotFingerprint } from '../../../src/compile/aot'
import { isBridgeLive } from '../../../src/type/bridge'

const query = {
	'~kind': 'Object',
	type: 'object',
	properties: {
		name: { '~kind': 'String', type: 'string' }
	},
	required: ['name']
}

Compiled.register({
	bf: 1,
	fingerprint: createAotFingerprint(),
	handlers: {
		GET: { '/__probe': { a: [], f: () => () => new Response() } }
	}
} as any)

const app = new Elysia()
	.get('/duplicate', { query } as any, () => 'loser')
	.get('/duplicate', { query } as any, () => ({ route: 'winner' }))

// publish: claims the registered program
void app.fetch

const programAlive = Compiled.hasProgram((app as any)['~programId'])

const compile = (index: number) => {
	try {
		app.handler(index, true)
		return { message: '', cause: '' }
	} catch (error) {
		return {
			message: (error as Error)?.message ?? String(error),
			// base.ts wraps once, the reconstruct error is the inner cause
			cause:
				((error as Error)?.cause as Error)?.cause instanceof Error
					? (((error as Error).cause as Error).cause as Error).message
					: ''
		}
	}
}

// index 0 is the duplicate LOSER (the earlier registration) ⇒ `liveOnly`;
// index 1 is the winner ⇒ ordinary bridge-not-initialized path.
// Duplicate losers are not reachable through dispatch, so compile directly.
const loser = compile(0)
const winner = compile(1)

console.log(
	JSON.stringify({
		live: isBridgeLive(),
		programAlive,
		loser,
		winner
	})
)
