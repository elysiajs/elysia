import { KingWorld } from '../src'

new KingWorld({
    ssl: {
        keyFile: 'path/to/key',
        certFile: 'path/to/cert',
        /**
        * Optional SSL options
        */
        // passphrase?: string;
        // caFile?: string;
        // dhParamsFile?: string;
        // lowMemoryMode?: boolean;
    }
})
    .get('/', () => 'Hi')
    .onStart(() => {
        console.log('🦊 KINGWORLD is running at :8080')
    })
    .listen(8080)
