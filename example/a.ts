import { Elysia, t } from '../src'

const main = new Elysia().get('/', () => 'a', {
	response: { 200: t.Number({
		default: () => 'a'
	}), 500: t.String() }
})

type A = (typeof main)['_routes']['index']['get']['response']
