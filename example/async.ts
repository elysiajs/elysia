import KingWorld from '../src'

new KingWorld().get('/', async () => await Promise.resolve('Hi')).listen(8080)

console.log('🦊 KINGWORLD is running at :8080')
