import { Elysia, t } from '../src/2'

const app = new Elysia()
	.get('/:id', () => { })

app.handle('/')
	.then((x) => x.text())
	.then(console.log)
