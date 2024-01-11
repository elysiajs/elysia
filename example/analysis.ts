import { Suite } from 'benchmark'

// import { createApp } from './http'

const run = (suite: Suite) => {
	suite
		// @ts-ignore
		.on('cycle', function (event) {
			console.log(String(event.target))
		})
		.on('complete', function () {
			// @ts-ignore
			console.log('Fastest is ' + this.filter('fastest').map('name'))
		})
		// run async
		.run()
}

// run(
// 	new Suite('Sucrose').add('analysis', () => {
// 		createApp()
// 	})
// )
