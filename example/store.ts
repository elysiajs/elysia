import KingWorld from '../src'

new KingWorld<{
	store: {
		d: string
	}
	request: {}
}>()
	.get('/', () => {})
	.state('a', 'a')
	.state('b', 'b')
	.get<{
		params: {
			a: number
			c: number
		}
	}>('/awd/:c/:a', ({ params, store: { b } }) => b)
