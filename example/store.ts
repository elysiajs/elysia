import KingWorld from '../src'

new KingWorld<{
	store: {
		d: string
	}
	request: {}
}>()
	.get('/', (a, store) => {})
	.state('a', 'a')
	.state('b', 'b')
	.ref('c', async () => 'c')
	.get<{
        params: {
            a: number
            c: number
        }
    }>('/awd/:c/:a', ({ params }, store) => {
		store.c
	})
