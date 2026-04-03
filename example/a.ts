import { t } from '../src/type-system'
import Compile from 'typebox/compile'

const a = t.Numeric()

console.log(a)

const comp = Compile(a)
console.log(comp.Check(4))
