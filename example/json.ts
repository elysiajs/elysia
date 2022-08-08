import Kingworld from 'kingworld'

new Kingworld()
    .get("/", () => ({
        "王 僕らの": "KingWorld"
    }))
    .listen(8080)