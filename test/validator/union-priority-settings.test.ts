import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const entry = JSON.stringify(resolve(root, 'src/index.ts'))
const valueOps = JSON.stringify(resolve(root, 'src/type/typebox-value.ts'))

// `Settings` is process-global and each TypeBox leaf latches once, so every arm
// needs its own process
function run(script: string) {
	const proc = Bun.spawnSync({
		cmd: [process.execPath, '-e', script],
		cwd: root,
		stdout: 'pipe',
		stderr: 'pipe'
	})

	if (proc.exitCode !== 0)
		throw new Error(
			`child exited ${proc.exitCode}\n${proc.stderr.toString()}`
		)

	return proc.stdout.toString().trim()
}

// First member matches `{ name, age }` too, so declaration order decides
// whether `age` survives. TypeBox's default (`unionPrioritySort: true`)
// reorders variants narrowest-to-broadest and would keep it
const schema =
	`const schema = t.Union([\n` +
	`	t.Object({ name: t.String() }),\n` +
	`	t.Object({ name: t.String(), age: t.Number() })\n` +
	`])\n`

/**
 * Elysia turns `unionPrioritySort` off so union decoding follows declaration
 * order. The setting lives in `typebox/system`, which is only reachable through
 * the deferred `typebox-type` leaf — but the ops that READ it live in the
 * separately deferred `typebox-value` leaf, and an app whose schemas are
 * built from Elysia-owned builders reaches the value ops without ever touching
 * the type leaf. Without the cross-leaf `ensureTypeSettings()` the default
 * would silently never be applied for exactly that (modal) shape of app.
 */
describe('unionPrioritySort default across the two TypeBox leaves', () => {
	it('applies declaration order for a schema that never loads the type leaf', () => {
		const out = run(
			`const { t } = await import(${entry})\n` +
				`const { Clean } = await import(${valueOps})\n` +
				schema +
				`console.log(JSON.stringify(Clean(schema, { name: 'x', age: 1 })))`
		)

		expect(JSON.parse(out)).toEqual({ name: 'x' })
	})

	/**
	 * The control arm: proves the assertion above can fail, and pins the
	 * ordering contract the eager `setupTypebox()` used to give — Elysia's
	 * default is applied on first materialization, so a user's explicit
	 * `Set` lands after it and is never clobbered by a later leaf load
	 */
	it('lets an explicit TypeSystem.Settings.Set win over the default', () => {
		const out = run(
			`const { t, TypeSystem } = await import(${entry})\n` +
				`TypeSystem.Settings.Set({ unionPrioritySort: true })\n` +
				`const { Clean } = await import(${valueOps})\n` +
				schema +
				`console.log(JSON.stringify(Clean(schema, { name: 'x', age: 1 })))`
		)

		expect(JSON.parse(out)).toEqual({ name: 'x', age: 1 })
	})
})
