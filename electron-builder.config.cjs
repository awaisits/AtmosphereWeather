const updateUrl = process.env.ATMOSPHERE_UPDATE_URL;
module.exports = {
  appId: 'com.atmosphere.weather',
  productName: 'Atmosphere Weather',
  asar: true,
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },
  directories: { output: 'release' },
  files: ['dist/**/*', 'electron/**/*', 'assets/icon.ico', 'assets/icon.png'],
  // Ship only the locales the UI can display instead of every Chromium locale
  // pack, which removes tens of megabytes from the installed footprint.
  electronLanguages: ['en-US', 'en-GB', 'ur'],
  win: {
    icon: 'assets/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
    signAndEditExecutable: true,
    verifyUpdateCodeSignature: true,
    forceCodeSigning: process.env.ATMOSPHERE_RELEASE === '1',
  },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true },
  ...(process.env.ATMOSPHERE_RELEASE === '1' && updateUrl ? { publish: [{ provider: 'generic', url: updateUrl.endsWith('/') ? updateUrl : `${updateUrl}/` }] } : {}),
};
