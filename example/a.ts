import { Elysia, t } from '../src/2'

const app = new Elysia().get('/', ({ query }) => query ?? {}).listen(3000)

app.handle('/?name=a')
	.then((x) => x.text())
	.then(console.log)
