import { Elysia, t } from '../src'
import { req } from '../test/utils'

const challengeModel = t.Object({
	nonce: t.String(),
	issued: t.Number(),
	bits: t.Number()
})

const app = new Elysia({
	cookie: {
		secrets: ['a', null],
		sign: 'challenge'
	}
})
	.get(
		'/set',
		({ cookie: { challenge } }) => {
			challenge.value = {
				nonce: 'hello',
				bits: 19,
				issued: Date.now()
			}

			return challenge.value
		},
		{
			cookie: t.Cookie({
				challenge: t.Optional(challengeModel)
			})
		}
	)
	.get(
		'/get',
		({ cookie: { challenge } }) => {
			return {
				type: typeof challenge,
				value: challenge.value
			}
		},
		{
			cookie: t.Cookie({
				challenge: challengeModel
			})
		}
	)

const first = await app.handle(
	req('/set', {
		headers: {
			cookie: `challenge=${JSON.stringify({
				nonce: 'hello',
				bits: 19,
				issued: 1770750432990
			})}`
		}
	})
)

console.log(first.status)
console.log(await first.json())

const cookie = first.headers.get('set-cookie')
const challenge = cookie!.match(/challenge=([^;]*)/)![1]

console.log(challenge)

const second = await app
	.handle(
		req('/get', {
			headers: {
				cookie: `challenge=${challenge}`
			}
		})
	)

console.log(second.status)
