import { Elysia } from '../../../src/base'
import { Compiled } from '../../../src/compile/aot'
import { createContext } from '../../../src/context'
import { isBridgeLive } from '../../../src/type/bridge'

const query = {
	'~kind': 'Object',
	type: 'object',
	properties: {
		name: { '~kind': 'String', type: 'string' }
	},
	required: ['name']
}

const app = new Elysia()
	.get('/duplicate', { query } as any, () => 'loser')
	.get('/duplicate', { query } as any, () => ({ route: 'winner' }))
	.get('/ordinary', { query } as any, () => 'ordinary')

let startup = ''
try {
	void app.fetch
} catch (error) {
	startup = (error as Error).message
}

const Context = createContext(app as any)
const original = Compiled.getValidator
let validatorLookups = 0
Compiled.getValidator = ((...args: Parameters<typeof original>) => {
	validatorLookups++
	return original.apply(Compiled, args)
}) as typeof original

const invoke = async (index: number, path: string) => {
	try {
		return (
			await app.handler(index)(
				new Context(new Request(`http://localhost${path}`))
			)
		).status
	} catch (error) {
		return ((error as Error).cause as Error).message
	}
}

const beforeDuplicate = validatorLookups
const duplicate = await invoke(0, '/duplicate?name=elysia')
const duplicateLookups = validatorLookups - beforeDuplicate

const beforeOrdinary = validatorLookups
const ordinary = await invoke(2, '/ordinary?name=elysia')
const ordinaryLookups = validatorLookups - beforeOrdinary

console.log(
	JSON.stringify({
		live: isBridgeLive(),
		startup,
		duplicate,
		ordinary,
		duplicateLookups,
		ordinaryLookups
	})
)
