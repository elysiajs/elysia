import { defineConfig, globalIgnores } from 'eslint/config'
import typescriptEslint from '@typescript-eslint/eslint-plugin'
import sonarjs from 'eslint-plugin-sonarjs'
import globals from 'globals'
import js from '@eslint/js'

export default defineConfig([
	globalIgnores([
		'example/*',
		'test/**/*',
		'dist/**',
		'design/**',
		'src-old/**'
	]),
	{
		extends: [
			js.configs.recommended,
			...typescriptEslint.configs['flat/recommended']
		],

		plugins: {
			sonarjs
		},

		languageOptions: {
			globals: {
				...globals.browser
			},

			ecmaVersion: 'latest',
			sourceType: 'module'
		},

		rules: {
			...sonarjs.configs.recommended.rules,
			'@typescript-eslint/ban-types': 'off',
			// successors of ban-types (TS-eslint v8) — `{}`, `Function` and the
			// `Object` wrapper are deliberate, pervasive patterns in the type
			// machinery + codegen
			'@typescript-eslint/no-empty-object-type': 'off',
			'@typescript-eslint/no-unsafe-function-type': 'off',
			'@typescript-eslint/no-wrapper-object-types': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'no-mixed-spaces-and-tabs': 'off',
			'@typescript-eslint/no-non-null-assertion': 'off',
			'@typescript-eslint/no-extra-semi': 'off',
			'@typescript-eslint/ban-ts-comment': 'off',
			'@typescript-eslint/no-namespace': 'off',
			// overloaded methods (guard/group) dispatch on `arguments` by design
			'prefer-rest-params': 'off',
			// `const self = this` snapshots for closures (trace slots)
			'@typescript-eslint/no-this-alias': 'off',
			// honor the `_`-prefix intentional-unused convention + destructure-omit
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					ignoreRestSiblings: true
				}
			],
			// every flagged empty block is a deliberate `} catch {}`
			'no-empty': ['error', { allowEmptyCatch: true }],
			// only flag `let` that's fully convertible (skip destructures with a
			// reassigned sibling)
			'prefer-const': ['error', { destructuring: 'all' }],
			'no-case-declarations': 'off',
			'no-extra-semi': 'off',
			'sonarjs/cognitive-complexity': 'off',
			'sonarjs/no-all-duplicated-branches': 'off',
			// intentional perf/terseness (consistent with cognitive-complexity off)
			'sonarjs/no-nested-assignment': 'off',
			'sonarjs/no-nested-conditional': 'off',
			'sonarjs/no-nested-template-literals': 'off',
			// inline anonymous union/intersection types are pervasive in the
			// type machinery; naming each one is noise
			'sonarjs/use-type-alias': 'off',
			// semantic named aliases (AnyWSLocalHook, ServerWebSocketSendStatus)
			'sonarjs/redundant-type-aliases': 'off',
			// false positive on the prettier `;(` leading-semicolon convention
			'sonarjs/no-unenclosed-multiline-block': 'off',
			// class + interface declaration merging is a deliberate TS pattern
			'@typescript-eslint/no-unsafe-declaration-merging': 'off',
			// `void app.fetch` explicitly discards a getter's compile side effect
			'sonarjs/void-use': 'off',
			// commented-out code is in-progress rewrite work, kept on purpose
			'sonarjs/no-commented-code': 'off',
			// TODOs mark the ongoing rewrite, not stale debt
			'sonarjs/todo-tag': 'off',
			// redundant with @typescript-eslint/no-unused-vars (configured above)
			// and doesn't honor the `_`-prefix convention (`for (const _ in x)`)
			'sonarjs/no-unused-vars': 'off'
		}
	}
])
