import KingWorld from '../src'

new KingWorld().get('/', () => 'Hi').listen(8080)

console.log('🦊 KINGWORLD is running at :8080')
