import { Elysia } from '../src'

const app = new Elysia()
	.get('/', () => 'Hello Elysia')
	// .fn({
	//     mirror: async <T extends string>(value: T) => {
	//         if (value === 'false') throw new Error("Value can't be false")

	//         return value
	//     }
	// })
	.listen(8080)
