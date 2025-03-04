import { TypeCompiler } from '../dist/type-system'
import { Elysia, t } from '../src'

const model = t.Object({
	id: t.Number(),
	name: t.Literal('SaltyAom'),
	bio: t.String({
		sanitize: true
	}),
	user: t.Object({
		name: t.String(),
		password: t.String()
	}),
	playing: t.Optional(t.String()),
	games: t.Array(
		t.Object({
			name: t.String(),
			hoursPlay: t.Number({ default: 0 }),
			tags: t.Array(t.String())
		})
	),
	metadata: t.Intersect([
		t.Object({
			alias: t.String()
		}),
		t.Object({
			country: t.Nullable(t.String())
		})
	]),
	social: t.Optional(
		t.Object({
			facebook: t.Optional(t.String()),
			twitter: t.Optional(t.String()),
			youtube: t.Optional(t.String())
		})
	)
})

const a = TypeCompiler.Compile(model)

const app1 = new Elysia({ jsonAccelerator: true })
	.get(
		'/',
		() => ({
			id: 1,
			name: 'SaltyAom' as const,
			bio: 'I like train\nhere',
			user: {
				name: 'SaltyAom',
				password: '123456'
			},
			games: [
				{
					name: 'MiSide',
					hoursPlay: 17,
					tags: ['Psychological Horror', 'Cute', 'Dating Sim']
				},
				{
					name: 'Strinova',
					hoursPlay: 365,
					tags: ['Free to Play', 'Anime', 'Third-Person Shooter']
				},
				{
					name: "Tom Clancy's Rainbow Six Siege",
					hoursPlay: 287,
					tags: ['FPS', 'Multiplayer', 'Tactical']
				}
			],
			metadata: {
				alias: 'SaltyAom',
				country: 'Thailand'
			},
			social: {
				twitter: 'SaltyAom'
			}
		}),
		{
			response: model
		}
	)
	.listen(3000)

const app2 = new Elysia({ jsonAccelerator: false })
	.get(
		'/',
		() => ({
			id: 1,
			name: 'SaltyAom' as const,
			bio: 'I like train\nhere',
			user: {
				name: 'SaltyAom',
				password: '123456'
			},
			games: [
				{
					name: 'MiSide',
					hoursPlay: 17,
					tags: ['Psychological Horror', 'Cute', 'Dating Sim']
				},
				{
					name: 'Strinova',
					hoursPlay: 365,
					tags: ['Free to Play', 'Anime', 'Third-Person Shooter']
				},
				{
					name: "Tom Clancy's Rainbow Six Siege",
					hoursPlay: 287,
					tags: ['FPS', 'Multiplayer', 'Tactical']
				}
			],
			metadata: {
				alias: 'SaltyAom',
				country: 'Thailand'
			},
			social: {
				twitter: 'SaltyAom'
			}
		}),
		{
			response: model
		}
	)
	.listen(3001)

const app3 = new Elysia()
	.get('/', () => ({
		id: 1,
		name: 'SaltyAom' as const,
		bio: 'I like train\nhere',
		user: {
			name: 'SaltyAom',
			password: '123456'
		},
		games: [
			{
				name: 'MiSide',
				hoursPlay: 17,
				tags: ['Psychological Horror', 'Cute', 'Dating Sim']
			},
			{
				name: 'Strinova',
				hoursPlay: 365,
				tags: ['Free to Play', 'Anime', 'Third-Person Shooter']
			},
			{
				name: "Tom Clancy's Rainbow Six Siege",
				hoursPlay: 287,
				tags: ['FPS', 'Multiplayer', 'Tactical']
			}
		],
		metadata: {
			alias: 'SaltyAom',
			country: 'Thailand'
		},
		social: {
			twitter: 'SaltyAom'
		}
	}))
	.listen(3002)

// console.log(
// 	`🦊 Elysia w/ JSON Accelerator is running at ${app1.server?.hostname}:${app1.server?.port}`
// )

// console.log(
// 	`🦊 Elysia w/o JSON Accelerator is running at ${app2.server?.hostname}:${app2.server?.port}`
// )

// console.log(
// 	`🦊 Elysia w/o response schema is running at ${app3.server?.hostname}:${app3.server?.port}`
// )

// console.log(app1.routes[0].compile().toString())
// console.log(app2.routes[0].compile().toString())
