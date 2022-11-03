export default ({ Vue }) => { Vue.mixin({
    computed: {
      $dataBlock() {
        return this.$options.__data__block__
      }
    }
  }) }