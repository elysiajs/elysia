export function integerArgument(name: string, fallback: number) {
	const value = process.argv
		.find((argument) => argument.startsWith(`--${name}=`))
		?.slice(name.length + 3)
	const parsed = value === undefined ? fallback : Number(value)
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
