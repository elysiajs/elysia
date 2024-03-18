import { Elysia } from '../src'

const child = new Elysia()
	// ? This is only in local
	.derive(() => ({
		hello: 'world'
	}))
	/**
	 * ? Since hello is only in local
	 * ? It might not be available in global
	 * 
	 **/ 
	.mapDerive(({ hello }) => ({
		hello
	}))
	.get('/child', ({ hello }) => hello)
