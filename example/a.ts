import { Elysia } from '../src'

const plugin = <T extends 'global' | 'plugin'>(scope: T) => new Elysia()
	.beforeHandle(scope, () => { })

const app = new Elysia()
	.get('/', () => {})
