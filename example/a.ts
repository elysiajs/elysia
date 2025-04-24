import { Elysia, t } from '../src'
import { sucrose } from '../src/sucrose'
import { post, req } from '../test/utils'

new Elysia({ precompile: true })
	.get('/', ({ cookie: { token: A }, jwt: F, headers: D }) => {
		let w = D.authorization
		if (!w) return { userInfo: null }
		let [B, q] = await ND(
			IA.post(
				'https://ones.huyooo.com/restfulApi/users/profile',
				{},
				{
					headers: {
						accept: 'application/json',
						authorization: `${w}`
					}
				}
			)
		)
		if ((console.log(B, 'userInfoError'), B)) return { userInfo: null }
		let z = q.data.data
		if (!z) return { userInfo: null }
		return { userInfo: { userId: z.id, ...z } }
	})
	.compile()
