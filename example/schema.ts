import KingWorld from '../src'

new KingWorld().post<{
	body: {
		username: string
		password?: number
	}
	response:
		| {
				hello: string | number
		  }
		| {
				a: 'b'
		  }
}>('/sign-in', () => ({
	hello: 'world'
}))
