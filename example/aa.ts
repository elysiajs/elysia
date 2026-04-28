class ExampleClass {
	constructor(public a: string | number) {
		console.log(a)
	}
}

const example = new ExampleClass("a")

console.log(example.a)
