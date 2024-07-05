import { req } from "../test/utils";

const response = await app.handle(
    req('/council', {
        headers: {
            cookie: 'council=' +
                encodeURIComponent(
                    JSON.stringify([
                        {
                            name: 'Aoi',
                            affilation: 'Financial'
                        }
                    ])
                )
        }
    })
);
