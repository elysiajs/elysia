import { Elysia, t } from '../src'
import { separateFunction } from '../src/sucrose'
import { post, req } from '../test/utils'

const arrowNoParam = () => 'sucrose'


console.log(separateFunction(arrowNoParam.toString()))
