const { withAndroidManifest, withInfoPlist, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Plugin config ClearNet (V1.3, bare-metal / expo prebuild).
 * Ajoute les permissions natives requises par le mode audit & reporting :
 *  - Android : stockage externe (export PDF via expo-print/expo-sharing),
 *    trafic réseau clair en dev (10.0.2.2), notifications si activées.
 *  - iOS     : description de l'usage de la photothèque (partage PDF).
 * Le plugin est idempotent : il ne touche qu'aux nœuds AndroidManifest /
 * Info.plist générés par `npx expo prebuild --clean`.
 */
module.exports = function withClearNetNative(config) {
  config = withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults;
    const app = manifest.manifest.application?.[0];
    if (app && !app.$['android:usesCleartextTraffic']) {
      app.$['android:usesCleartextTraffic'] = 'true'; // dev HTTP 10.0.2.2 (retirer en prod)
    }
    const perms = manifest.manifest['uses-permission'] || [];
    const wanted = [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ];
    const existing = new Set(perms.map((p) => p.$['android:name']));
    for (const name of wanted) {
      if (!existing.has(name)) {
        perms.push({ $: { 'android:name': name } });
      }
    }
    manifest.manifest['uses-permission'] = perms;
    return modConfig;
  });

  config = withInfoPlist(config, (modConfig) => {
    const plist = modConfig.modResults;
    plist.NSPhotoLibraryUsageDescription =
      plist.NSPhotoLibraryUsageDescription ||
      "ClearNet exporte vos rapports d'audit (PDF) vers votre bibliothèque de photos.";
    return modConfig;
  });

  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      const gradlePath = path.join(modConfig.modRequest.platformProjectRoot, 'app', 'build.gradle');
      if (fs.existsSync(gradlePath)) {
        let content = fs.readFileSync(gradlePath, 'utf8');
        if (!content.includes('expo-build-properties')) {
          // Note de version : le plug-in build-properties pilote compileSdk/targetSdk.
          content = content + '\n// ClearNet V1.3 : versions SDK pilotées par expo-build-properties\n';
          fs.writeFileSync(gradlePath, content);
        }
      }
      return modConfig;
    },
  ]);

  return config;
};
