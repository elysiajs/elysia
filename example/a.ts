new Elysia()
	.macro({
		auth(enabled: boolean) {
			return {
				async resolve() {
					return {
						user: 'saltyaom'
					}
				}
			}
		}
	})
	.get('/', ({ user }) => {}, {
		auth: true
	})
