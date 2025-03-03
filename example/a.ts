import { Elysia, t } from '../src'
import { sucrose } from '../src/sucrose'

const plugin = new Elysia().derive(({ headers: { authorization } }) => {
	return {
		get auth() {
			return authorization
		}
	}
})

const a = new WeakMap()

const b = () => { }
const c = () => { }
