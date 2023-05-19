// Using navitve Bun http server
Bun.serve({
	port: 3000,
	async fetch(request) {
		return new Response('')
	}
})

const transpiler = new Bun.Transpiler({
	"inline": true
})

const code = transpiler.transformSync(`
  function averylongfunctioname(param) {
	return param
  }
`)

console.log(code)