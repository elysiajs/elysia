// Verify the frozen Worker validates requests under workerd without runtime eval.
export {} // module scope (top-level await)

const PORT = process.argv[2] ?? '8787'
const EXTRA = process.argv.slice(3)

const log: string[] = []
const proc = Bun.spawn({
	cmd: ['bunx', 'wrangler', 'dev', '--port', PORT, '--local', ...EXTRA],
	stdout: 'pipe',
	stderr: 'pipe'
})
const drain = async (s: ReadableStream) => {
	for await (const chunk of s) log.push(new TextDecoder().decode(chunk))
}
drain(proc.stdout)
drain(proc.stderr)

const base = `http://localhost:${PORT}`
const deadline = Date.now() + 40_000
let lastErr = ''

const fail = async (msg: string) => {
	console.log(`❌ ${msg}`)
	console.log('\n--- wrangler output ---\n' + log.join(''))
	proc.kill('SIGKILL')
	process.exit(1)
}

while (Date.now() < deadline) {
	await Bun.sleep(1000)
	try {
		const home = await fetch(base)
		if (!home.ok) {
			lastErr = `GET / → ${home.status}`
			continue
		}
		const homeText = await home.text()
		if (homeText !== 'Elysia frozen on Cloudflare Worker!') {
			await fail(`GET / wrong body: ${JSON.stringify(homeText)}`)
		}

		const echo = await fetch(`${base}/echo`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ n: 5 })
		})
		const echoJson = await echo.json().catch(() => null)
		if (echo.status !== 200 || (echoJson as any)?.n !== 5) {
			await fail(
				`POST /echo → ${echo.status} ${JSON.stringify(echoJson)}`
			)
		}

		const bad = await fetch(`${base}/echo`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ n: 'not-a-number' })
		})
		if (bad.status !== 422) {
			await fail(`POST /echo invalid → ${bad.status} (expected 422)`)
		}

		console.log(
			'✅ Frozen Elysia runs on workerd — validated route served, no EvalError'
		)
		console.log(
			'   GET /            → 200 "Elysia frozen on Cloudflare Worker!"'
		)
		console.log(
			'   POST /echo {n:5} → 200 {"n":5}  (frozen check + handler, no eval)'
		)
		console.log(
			'   POST /echo bad   → 422          (frozen validator rejects)'
		)
		proc.kill('SIGKILL')
		process.exit(0)
	} catch (e) {
		lastErr = String(e)
	}
}

await fail(`timed out waiting for worker (last: ${lastErr})`)
