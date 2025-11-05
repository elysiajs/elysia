import { Elysia } from '../src'
import * as z from 'zod'

const sendOtpEmailSchema = z.object({
	channel: z.literal('email'),
	otpTo: z.email({ error: 'Must be a valid email address' })
})

const sendOtpSmsSchema = z.object({
	channel: z.literal('sms'),
	otpTo: z.e164({ error: 'Must be a valid phone number with country code' })
})

const sendOtpSchema = z.discriminatedUnion('channel', [
	sendOtpEmailSchema,
	sendOtpSmsSchema
])

export const app = new Elysia()
	.onError(({ code, error, status }) => {
		switch (code) {
			case 'VALIDATION':
				return error.detail(error.message)
			// console.log('error', {error: JSON.parse(error.message)});
			// console.log('error', {error, code, status});
			// return status(422, { type: 'VALIDATION', message: 'Validation error', userMessage: error.message } as OtpErrorInfo)
		}
	})
	.post(
		'/',
		async ({ body, set }) => {
			return 'ok'
		},
		{
			body: sendOtpSchema
		}
	)
	.listen(3000)
