import KingWorld from '../src'

/**
 * Example of handle single static file
 * 
 * For more advavnce use-case, eg. folder
 * @see https://github.com/saltyaom/kingworld-static
 */
new KingWorld()
	.get('/tako', () => Bun.file('./example/takodachi.png'))
	.listen(8080)
