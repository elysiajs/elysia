import { t } from '../src'
import { Elysia } from '../src/base'

class Dependency {
	doThing() {
		return 'Hi!'
	}
}

class Service {
	constructor(protected dependency: Dependency) {}

	doSomething() {
		return this.dependency.doThing()
	}
}

new Elysia()
	.decorate({
		dependency: new Dependency()
	})
	.decorate((rest) => ({
		...rest,
		service: new Service(rest.dependency)
	}))
	// use derive for per request instances
	.derive(({ dependency }) => ({
		service: new Service(dependency)
	}))
	.get(
		'/',
		{
			response: {
				418: t.Literal('a')
			}
		},
		({ service, status }) => service.doSomething()
	)
	.listen(3000)
