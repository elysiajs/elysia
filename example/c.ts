// ? client
import { models } from './a'

const value = models.user.parse({
    name: 'Doro',
    age: 21
})

const { data, error } = models.user.safeParse({
    name: 'Doro',
    age: '21'
})

console.log({ data, error })