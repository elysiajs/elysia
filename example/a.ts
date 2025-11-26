import { Elysia, t } from '../src'
import z from 'zod'

const app = new Elysia()
	.get('/', () => 'hello world', {
		body: t.Object({
			file: t.File({
				type: 'image'
			})
		})
	})
