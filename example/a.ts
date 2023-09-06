import { Elysia } from '../src'

new Elysia().get('/', ({ cookie }) => {
	// Get
	cookie.name

	// Set
	cookie.name = 'Noa'

	// Set Multiple
	cookie.name = [...cookie.name, 'Noa']

	// Remove Cookie
	delete cookie.name
})
