import { Elysia, t, error } from '../src'
import { post, req } from '../test/utils'

await fetch('http://localhost:3000', {
	signal: AbortSignal.timeout(25)
})
	.then((x) => x.text())
	.catch(() => {})

fetch('http://localhost:3000')
	.then((x) => x.text())
	.then(console.log)
