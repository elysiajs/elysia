import { Elysia, t } from '../src'


const app = new Elysia()
	.get('/', ({ error }) => {
		return error(418, 'ヒッフッ↑　ヒ↓フ→ミッ↑')
	}, {
		response: {
			200: t.Number(),
			418: t.Literal('ヒッフッ↑　ヒ↓フ→ミッ↑')
		}
	})