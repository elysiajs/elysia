import { Elysia, t } from '../src'

const app = new Elysia()
	.get(
		'/',
		async function* () {
			yield 'a'
			await Bun.sleep(10)
			throw new Error('My Dummy Error')
			yield 'b'
		},
		{
			error({ error }) {
				return 'handled'
			}
		}
	)
	.listen(3000)
