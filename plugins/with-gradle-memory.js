// Plugin de configuración de Expo: memoria de Gradle para compilar Android.
//
// La plantilla genera `org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m`.
// Con los módulos nativos de TEINS (PowerSync/op-sqlite, Skia, Reanimated…)
// el proceso de Gradle se queda sin memoria y muere ("Gradle build daemon
// disappeared unexpectedly") en los servidores de EAS (4 vCPU, ~16 GB de RAM).
// Se amplían el heap y el metaspace, y se da al demonio de Kotlin su propia
// memoria; el total sigue muy por debajo de la RAM del servidor.
const { withGradleProperties } = require('expo/config-plugins');

const PROPERTIES = {
  'org.gradle.jvmargs':
    '-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8',
  'kotlin.daemon.jvmargs': '-Xmx2048m',
};

function setProperty(items, key, value) {
  const existing = items.find((item) => item.type === 'property' && item.key === key);
  if (existing) {
    existing.value = value;
  } else {
    items.push({ type: 'property', key, value });
  }
}

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (modConfig) => {
    for (const [key, value] of Object.entries(PROPERTIES)) {
      setProperty(modConfig.modResults, key, value);
    }
    return modConfig;
  });
};
