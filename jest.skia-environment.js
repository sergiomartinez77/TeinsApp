/**
 * Entorno de Jest para los tests que montan componentes de Skia.
 *
 * Es el entorno de jest-expo más CanvasKit (Skia compilado a WebAssembly),
 * que necesita el simulador oficial de `@shopify/react-native-skia`.
 * Se activa por archivo con el comentario `@jest-environment ./jest.skia-environment.js`
 * para no cargar WebAssembly en el resto de tests.
 */
const ExpoEnvironment = require('jest-expo/src/preset/nativeEnvironment');
const CanvasKitInit = require('canvaskit-wasm/bin/full/canvaskit');

class SkiaEnvironment extends ExpoEnvironment {
  async setup() {
    await super.setup();
    this.global.CanvasKit = await CanvasKitInit({});
  }
}

module.exports = SkiaEnvironment;
