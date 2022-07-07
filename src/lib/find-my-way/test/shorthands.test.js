'use strict'

const http = require('http')
const t = require('tap')
const test = t.test
const FindMyWay = require('../')

t.test('should support shorthand', t => {
  t.plan(http.METHODS.length)

  for (var i in http.METHODS) {
    const m = http.METHODS[i]
    const methodName = m.toLowerCase()

    t.test('`.' + methodName + '`', t => {
      t.plan(1)
      const findMyWay = FindMyWay()

      findMyWay[methodName]('/test', () => {
        t.ok('inside the handler')
      })

      findMyWay.lookup({ method: m, url: '/test', headers: {} }, null)
    })
  }
})

test('should support `.all` shorthand', t => {
  t.plan(11)
  const findMyWay = FindMyWay()

  findMyWay.all('/test', () => {
    t.ok('inside the handler')
  })

  findMyWay.lookup({ method: 'GET', url: '/test', headers: {} }, null)
  findMyWay.lookup({ method: 'DELETE', url: '/test', headers: {} }, null)
  findMyWay.lookup({ method: 'HEAD', url: '/test', headers: {} }, null)
  findMyWay.lookup({ method: 'PATCH', url: '/test', headers: {} }, null)
  findMyWay.lookup({ method: 'POST', url: '/test', headers: {} }, null)
  findMyWay.lookup({ method: 'PUT', url: '/test', headers: {} }, null)
  findMyWay.lookup({ method: 'OPTIONS', url: '/test', headers: {} }, null)
  findMyWay.lookup({ method: 'TRACE', url: '/test', headers: {} }, null)
  findMyWay.lookup({ method: 'CONNECT', url: '/test', headers: {} }, null)
  findMyWay.lookup({ method: 'COPY', url: '/test', headers: {} }, null)
  findMyWay.lookup({ method: 'SUBSCRIBE', url: '/test', headers: {} }, null)
})
