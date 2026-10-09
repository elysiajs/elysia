import { parseArgs } from 'node:util'

export function integerArgument(name: string, fallback: number) {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: { [name]: { type: 'string' } },
		allowPositionals: true,
		strict: false
	})
	const value = values[name]
	const parsed = typeof value === 'string' ? Number(value) : fallback
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function tryListen(app: any) {
	try {
		app.listen(0)
		return true
	} catch {
		try {
			app.listen(40_000 + (process.pid % 10_000))
			return true
		} catch {
			return false
		}
	}
}
