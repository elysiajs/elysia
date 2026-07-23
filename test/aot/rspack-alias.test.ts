import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'

import { aot } from '../../src/plugin/aot/rspack'

const APP = resolve(import.meta.dir, 'fixtures/direct-mount-app.ts')
const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')

describe('AOT Rspack alias ownership', () => {
	it('preserves a user-owned elysia/type alias', async () => {
		let beforeCompile: () => Promise<void> = async () => {}
		let afterCompile: () => Promise<void> = async () => {}
		const aliases: Record<string, string> = {
			'elysia/type$': '/user/type-entry.ts'
		}
		const compiler = {
			options: {
				module: { rules: [] },
				resolve: { alias: aliases }
			},
			hooks: {
				beforeCompile: {
					tapPromise(_name: string, callback: () => Promise<void>) {
						beforeCompile = callback
					}
				},
				afterCompile: {
					tapPromise(_name: string, callback: () => Promise<void>) {
						afterCompile = callback
					}
				}
			}
		}

		aot(APP, { registerFrom: REGISTER_FROM }).apply(compiler)
		await beforeCompile()
		try {
			expect(aliases['elysia/type$']).toBe('/user/type-entry.ts')
			expect(aliases['elysia/compiled$']).toBeString()
		} finally {
			await afterCompile().catch((error) => {
				if (!String(error).includes('never appeared in the Vite module graph'))
					throw error
			})
		}
	})
})
