import { Elysia, t } from '../src'

const app = new Elysia({ precompile: true })
	.get('A', "A")
	.get('B', Bun.file("test/kyuukurarin.mp4"))
	.compile()
	.listen(3000)

// app.handle(new Request('http://localhost'))
// 	.then((x) => x.headers.getSetCookie())
// 	.then(console.log)
