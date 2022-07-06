'use strict'
const assert = require('assert')

function HostStorage () {
  const hosts = {}
  const regexHosts = []
  return {
    get: (host) => {
      const exact = hosts[host]
      if (exact) {
        return exact
      }
      for (const regex of regexHosts) {
        if (regex.host.test(host)) {
          return regex.value
        }
      }
    },
    set: (host, value) => {
      if (host instanceof RegExp) {
        regexHosts.push({ host, value })
      } else {
        hosts[host] = value
      }
    }
  }
}

module.exports = {
  name: 'host',
  mustMatchWhenDerived: false,
  storage: HostStorage,
  validate (value) {
    assert(typeof value === 'string' || Object.prototype.toString.call(value) === '[object RegExp]', 'Host should be a string or a RegExp')
  }
}
