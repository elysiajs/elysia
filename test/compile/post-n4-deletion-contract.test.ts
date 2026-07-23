import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')

const removedFiles = [
	'src/compile/handler/jit.ts',
	'src/compile/handler/params.ts',
	'src/compile/handler/program.ts',
	'src/compile/handler/program-plan.ts',
	'src/compile/jit-probe.ts',
	'src/compile/handler/trace-codegen.ts'
] as const

describe('Post-N+4 legacy HTTP deletion', () => {
	it('physically removes the legacy compiler modules', () => {
		expect(
			removedFiles.filter((file) => existsSync(resolve(root, file)))
		).toEqual([])
	})

	it('removes the public-shaped declaration-index compiler entry point', async () => {
		const { Elysia } = await import('../../src')
		const app = new Elysia().get('/', () => 'ok')

		expect('handler' in app).toBeFalse()
	})

	it('retains dynamic source generation only for validator precomputation', () => {
		const generated = [...new Bun.Glob('src/**/*.ts').scanSync({ cwd: root })]
			.flatMap((file) => {
				const source = readFileSync(resolve(root, file), 'utf8')
				return source
					.split('\n')
					.map((line, index) => ({ file, line: index + 1, source: line }))
					.filter(({ source }) =>
						/\b(?:new\s+)?(?:globalThis\.)?Function\s*\(|\beval\s*\(/.test(
							source
						)
					)
			})
			.map(({ file, line }) => `${file}:${line}`)
			.sort()

		expect(generated).toEqual([
			'src/type/validator/default-precompute.ts:410'
		])
	})
})
