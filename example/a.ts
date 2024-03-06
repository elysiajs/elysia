import { Elysia } from '../src'

const sessionName = 'user'

const app = new Elysia({
	cookie: {
		path: '/'
	}
})
	.get('/a', ({ cookie: { session } }) => {
		return session.value = 'abc'
	})
	.get('/b', ({ cookie: { session }, set }) => {
		const value = session.value

		session.remove()

		return 'v:' + value
	})
	.listen(3000)

// fetch('http://localhost:3000/a')
// 	.then((x) => x.text())
// 	.then(console.log)
