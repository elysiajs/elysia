import { Elysia, macroType, t, type MacroTypeLambda } from '../src'

interface Role extends MacroTypeLambda {
    output: Record<'role', this['input']>
}

new Elysia()
    .macro({
        role: (role: 'admin' | 'member') => ({
			$type: macroType<Role>(),
            derive: () => ({ role })
		})
    })
    .get('/admin', { role: 'admin' }, ({ role }) => role)
    .get('/member', { role: 'member' }, ({ role }) => role)
