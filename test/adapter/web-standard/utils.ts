export class Passthrough {
    toResponse() {
        return this.custom
    }

    get custom() {
        return 'hi'
    }
}