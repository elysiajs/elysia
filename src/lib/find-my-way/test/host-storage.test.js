const acceptHostStrategy = require('../lib/strategies/accept-host')

const t = require('tap')

t.test('can get hosts by exact matches', async (t) => {
  const storage = acceptHostStrategy.storage()
  t.equal(storage.get('fastify.io'), undefined)
  storage.set('fastify.io', true)
  t.equal(storage.get('fastify.io'), true)
})

t.test('can get hosts by regexp matches', async (t) => {
  const storage = acceptHostStrategy.storage()
  t.equal(storage.get('fastify.io'), undefined)
  storage.set(/.+fastify\.io/, true)
  t.equal(storage.get('foo.fastify.io'), true)
  t.equal(storage.get('bar.fastify.io'), true)
})

t.test('exact host matches take precendence over regexp matches', async (t) => {
  const storage = acceptHostStrategy.storage()
  storage.set(/.+fastify\.io/, 'wildcard')
  storage.set('auth.fastify.io', 'exact')
  t.equal(storage.get('foo.fastify.io'), 'wildcard')
  t.equal(storage.get('bar.fastify.io'), 'wildcard')
  t.equal(storage.get('auth.fastify.io'), 'exact')
})
