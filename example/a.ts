import { Elysia, t } from '../src'

const app = new Elysia()
	.trace({ as: 'global' }, () => {})
	// .onBeforeHandle(() => {})
	.onError(() => {})
	.get('/health', 'OK')
	.listen(3000)
