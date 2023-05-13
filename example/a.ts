import { Elysia, t } from '../src'

const app = new Elysia()
	// ! set model using label
	.model('string', t.String())
	.model({
		number: t.Number()
	})
	.state('visitor', 1)
	// ! set model using object
	.state({
		multiple: 'value',
		are: 'now supported!'
	})
	.decorate('visitor', 1)
	// ! set model using object
	.decorate({
		name: 'world',
		number: 2
	})
	// ! state, decorate, now support literal
	.get('/', ({ name, number, body }) => number, {
		body: 'number',
		response: t.Literal(2)
	})
	.get('/here', (context) => {})
