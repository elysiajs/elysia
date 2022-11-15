import { KingWorld } from '../src'

const kingWorld = new KingWorld()

kingWorld
	.get('/aa', () => 'route 1')
	.get('/ab', () => 'route 2')
	.get('/hello', () => 'A')
	.listen(3000)

// const response = await kingWorld.handle(new Request('/ab'))
// const text = await response.text()
// console.log(text)

// @ts-ignore
// console.log(kingWorld.routes)
console.log(kingWorld.router.find('/ab'))
