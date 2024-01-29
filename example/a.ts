type NoInfer<T> = [T][T extends any ? 0 : never]

const a = <T>(a: (a: NoInfer<T>) => T) => {
	return a
}

a((a) => {
	return {
		a: 1,
		b: 2
	}
})
