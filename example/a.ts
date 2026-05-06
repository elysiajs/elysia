import { Elysia, t } from '../src'

const app = new Elysia().get('/:id', ({ params }) => params.id)

app.handle('/1')
	.then((x) => x.text())
	.then(console.log)
