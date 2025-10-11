// app-context.ts
import { Elysia } from '../src'

const app = new Elysia()
	.derive(() => ({
		derivedValue: 'I come from derive'
	}))
	.onError(({ error, code, derivedValue }) => {
		if (code === 'NOT_FOUND') {
			// string | undefined
			derivedValue
		}

		if(code === "PARSE") {
			// undefined
			derivedValue
		}

		if(code === "UNKNOWN") {
			// string | undefined
			derivedValue
		}
	})
