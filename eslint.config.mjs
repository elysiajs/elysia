import { defineConfig, globalIgnores } from 'eslint/config'
import typescriptEslint from '@typescript-eslint/eslint-plugin'
import sonarjs from 'eslint-plugin-sonarjs'
import globals from 'globals'
import tsParser from '@typescript-eslint/parser'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
	baseDirectory: __dirname,
	recommendedConfig: js.configs.recommended,
	allConfig: js.configs.all
})

export default defineConfig([
	globalIgnores(['example/*', 'test/**/*']),
	{
		// sonarjs ships a flat config (`sonarjs.configs.recommended`); the old
		// eslintrc string `plugin:sonarjs/recommended` via FlatCompat throws on
		// ESLint 9 ("Unexpected top-level property 'name'"). Spread its rules
		// instead and keep the plugin registered below.
		extends: compat.extends(
			'eslint:recommended',
			'plugin:@typescript-eslint/recommended'
		),

		plugins: {
			'@typescript-eslint': typescriptEslint,
			sonarjs
		},

		languageOptions: {
			globals: {
				...globals.browser
			},

			parser: tsParser,
			ecmaVersion: 'latest',
			sourceType: 'module'
		},

		rules: {
			...sonarjs.configs.recommended.rules,
			'@typescript-eslint/ban-types': 'off',
			// successors of ban-types (TS-eslint v8) — `{}` and `Function` are
			// deliberate, pervasive patterns in the type machinery + codegen
			'@typescript-eslint/no-empty-object-type': 'off',
			'@typescript-eslint/no-unsafe-function-type': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'no-mixed-spaces-and-tabs': 'off',
			'@typescript-eslint/no-non-null-assertion': 'off',
			'@typescript-eslint/no-extra-semi': 'off',
			'@typescript-eslint/ban-ts-comment': 'off',
			'@typescript-eslint/no-namespace': 'off',
			'no-case-declarations': 'off',
			'no-extra-semi': 'off',
			'sonarjs/cognitive-complexity': 'off',
			'sonarjs/no-all-duplicated-branches': 'off',
			// intentional perf/terseness (consistent with cognitive-complexity off)
			'sonarjs/no-nested-assignment': 'off',
			'sonarjs/no-nested-conditional': 'off'
		}
	}
])
