import { Elysia, t } from '../src'

export const errorHandler = new Elysia({ name: "error-handler" })
    .onError(({ code, error, status }) => {
        switch (code) {
            case "VALIDATION": {
            	const allErrors = error.detail

                return status(422, {
                    status: 422,
                    message: error.valueError?.message,
                    details: {
                        location: error.type,
                        rejected_value: error.value,
                        expected: error.expected,
                    },
                })
            }
            case "NOT_FOUND": {
                return status(404, {
                    status: 404,
                    message: "Route not found",
                })
            }
            default: {
                const statusCode =
                    "status" in error
                        ? (typeof error.status === "number" ? error.status : Number(error.status)) || 500
                        : 500

                let errMsg = "An error occurred"
                if (error instanceof Error && error.message) {
                    errMsg = error.message
                }

                return status(statusCode, {
                    status: statusCode,
                    message: errMsg,
                })
            }
        }
    })
    .as("scoped")
