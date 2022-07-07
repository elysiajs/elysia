'use strict'

const acceptVersionStrategy = require('./strategies/accept-version')
const acceptHostStrategy = require('./strategies/accept-host')
const assert = require('assert')

class Constrainer {
  constructor (customStrategies) {
    this.strategies = {
      version: acceptVersionStrategy,
      host: acceptHostStrategy
    }

    this.strategiesInUse = new Set()

    // validate and optimize prototypes of given custom strategies
    if (customStrategies) {
      for (const strategy of Object.values(customStrategies)) {
        this.addConstraintStrategy(strategy)
      }
    }
  }

  hasConstraintStrategy (strategyName) {
    const customConstraintStrategy = this.strategies[strategyName]
    if (customConstraintStrategy !== undefined) {
      return customConstraintStrategy.isCustom || this.strategiesInUse.has(strategyName)
    }
    return false
  }

  addConstraintStrategy (strategy) {
    assert(typeof strategy.name === 'string' && strategy.name !== '', 'strategy.name is required.')
    assert(strategy.storage && typeof strategy.storage === 'function', 'strategy.storage function is required.')
    assert(strategy.deriveConstraint && typeof strategy.deriveConstraint === 'function', 'strategy.deriveConstraint function is required.')

    if (this.strategies[strategy.name] && this.strategies[strategy.name].isCustom) {
      throw new Error(`There already exists a custom constraint with the name ${strategy.name}.`)
    }

    if (this.strategiesInUse.has(strategy.name)) {
      throw new Error(`There already exists a route with ${strategy.name} constraint.`)
    }

    strategy.isCustom = true
    this.strategies[strategy.name] = strategy

    if (strategy.mustMatchWhenDerived) {
      this.noteUsage({ [strategy.name]: strategy })
    }
  }

  deriveConstraints (req, ctx) {
    return undefined
  }

  // When new constraints start getting used, we need to rebuild the deriver to derive them. Do so if we see novel constraints used.
  noteUsage (constraints) {
    if (constraints) {
      const beforeSize = this.strategiesInUse.size
      for (const key in constraints) {
        this.strategiesInUse.add(key)
      }
      if (beforeSize !== this.strategiesInUse.size) {
        this._buildDeriveConstraints()
      }
    }
  }

  newStoreForConstraint (constraint) {
    if (!this.strategies[constraint]) {
      throw new Error(`No strategy registered for constraint key ${constraint}`)
    }
    return this.strategies[constraint].storage()
  }

  validateConstraints (constraints) {
    for (const key in constraints) {
      const value = constraints[key]
      if (typeof value === 'undefined') {
        throw new Error('Can\'t pass an undefined constraint value, must pass null or no key at all')
      }
      const strategy = this.strategies[key]
      if (!strategy) {
        throw new Error(`No strategy registered for constraint key ${key}`)
      }
      if (strategy.validate) {
        strategy.validate(value)
      }
    }
  }

  // Optimization: build a fast function for deriving the constraints for all the strategies at once. We inline the definitions of the version constraint and the host constraint for performance.
  // If no constraining strategies are in use (no routes constrain on host, or version, or any custom strategies) then we don't need to derive constraints for each route match, so don't do anything special, and just return undefined
  // This allows us to not allocate an object to hold constraint values if no constraints are defined.
  _buildDeriveConstraints () {
    if (this.strategiesInUse.size === 0) return

    const lines = ['return {']

    for (const key of this.strategiesInUse) {
      const strategy = this.strategies[key]
      // Optimization: inline the derivation for the common built in constraints
      if (!strategy.isCustom) {
        if (key === 'version') {
          lines.push('   version: req.headers[\'accept-version\'],')
        } else if (key === 'host') {
          lines.push('   host: req.headers.host || req.headers[\':authority\'],')
        } else {
          throw new Error('unknown non-custom strategy for compiling constraint derivation function')
        }
      } else {
        lines.push(`  ${strategy.name}: this.strategies.${key}.deriveConstraint(req, ctx),`)
      }
    }

    lines.push('}')

    this.deriveConstraints = new Function('req', 'ctx', lines.join('\n')).bind(this) // eslint-disable-line
  }
}

module.exports = Constrainer
