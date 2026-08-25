const { withAndroidManifest, withInfoPlist, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Plugin config ClearNet (bare-metal / expo prebuild).
 *  - Android : permissions réseau minimales (INTERNET, ACCESS_NETWORK_STATE).
 *    Pas de trafic HTTP en clair, pas de permissions de stockage legacy
 *    (le partage PDF passe par expo-sharing / Storage Access Framework).
 *  - iOS     : description d'usage de la photothèque (partage PDF).
 * Idempotent : ne touche qu'aux nœuds générés par `expo prebuild`.
 */
module.exports = function withClearNetNative(config) {
  config = withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults;

    // 1) Supprime les permissions de stockage legacy (déclarées par
    //    expo-file-system) de la liste des permissions de l'app.
    manifest.manifest['uses-permission'] = (manifest.manifest['uses-permission'] || []).filter(
      (p) =>
        p.$['android:name'] !== 'android.permission.READ_EXTERNAL_STORAGE' &&
        p.$['android:name'] !== 'android.permission.WRITE_EXTERNAL_STORAGE',
    );

    // 2) tools:node="remove" : écrasement au moment du merge Gradle (le
    //    manifest de la bibliothèque expo-file-system les redéclare).
    if (!manifest.manifest.$['xmlns:tools']) {
      manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    manifest.manifest['uses-permission'].push(
      { $: { 'android:name': 'android.permission.READ_EXTERNAL_STORAGE', 'tools:node': 'remove' } },
      { $: { 'android:name': 'android.permission.WRITE_EXTERNAL_STORAGE', 'tools:node': 'remove' } },
    );

    // 3) Garantit les permissions réseau minimales.
    const perms = manifest.manifest['uses-permission'];
    const wanted = [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
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
