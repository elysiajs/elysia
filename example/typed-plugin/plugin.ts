import { app as App } from './index'

export default function plugin(app: typeof App) {
	return app.get('/counter', ({ store: { counter } }) => counter)
}
