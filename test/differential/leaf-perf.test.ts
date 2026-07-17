import { describe, expect, it } from 'bun:test'

const indexUrl = new URL('../../src/index.ts', import.meta.url).href

function run(script: string, env: Record<string, string>) {
	const child = Bun.spawnSync({
		cmd: [process.execPath, '-e', script],
		env: { ...process.env, ...env },
		stdout: 'pipe',
		stderr: 'pipe'
	})
	if (child.exitCode !== 0)
		throw new Error(new TextDecoder().decode(child.stderr))

	return JSON.parse(new TextDecoder().decode(child.stdout))
}

describe('crypto provider differential', () => {
	it('keeps signed-cookie responses byte-identical with Bun HMAC enabled', () => {
		const script = `
			const { createHmac } = await import('node:crypto')
			const { Elysia, t } = await import(${JSON.stringify(indexUrl)})
			const secret = 'd2-cookie-secret'
			const value = 'd2-session-value'
			const signed = value + '.' + createHmac('sha256', secret).update(value).digest('base64').replace(/=+$/, '')
			const app = new Elysia().get('/', {
				cookie: t.Cookie({ session: t.String() }, { secrets: secret, sign: ['session'] })
			}, ({ cookie }) => {
				const current = cookie.session.value
				cookie.session.value = current
				return current
			})
			const response = await app.handle(new Request('http://localhost/', {
				headers: { cookie: 'session=' + encodeURIComponent(signed) }
			}))
			console.log(JSON.stringify({
				status: response.status,
				body: await response.text(),
				cookie: response.headers.get('set-cookie')
			}))
		`
		const node = run(script, {
			ELYSIA_EXPERIMENTAL_BUN_CRYPTO_HASHER: '0'
		})
		const bun = run(script, {
			ELYSIA_EXPERIMENTAL_BUN_CRYPTO_HASHER: '1'
		})

		expect(bun).toEqual(node)
	})
})
