import { Elysia } from '../src'

class Group {
	constructor(
		public prefix: string,
		public group: (app: Elysia) => Elysia<any>
	) {}

	getPrefix() {
		return this.prefix
	}

	getGroup() {
		return this.group
	}
}

const group = new Group('/games', (app) => app.get('/blue-archive', () => '😭'))

const app = new Elysia()
	.all('/', () => 'Hi')
	.group(group.getPrefix(), group.getGroup())
	.listen(3000)

// console.log({
//     routes: app.routes,
//     handler: app.staticRouter
// })

console.log('Server is running on port 3000.')
