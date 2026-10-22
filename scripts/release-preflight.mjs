const failures = [];
if (process.platform !== 'win32') failures.push('Run the signed release build on Windows.');
if (!process.env.CSC_LINK) failures.push('Set CSC_LINK to a trusted code-signing certificate path or secure download URL.');
if (!process.env.CSC_KEY_PASSWORD) failures.push('Set CSC_KEY_PASSWORD in the release environment.');
if (!process.env.ATMOSPHERE_UPDATE_URL || !/^https:\/\//i.test(process.env.ATMOSPHERE_UPDATE_URL)) failures.push('Set ATMOSPHERE_UPDATE_URL to the HTTPS update feed that will host latest.yml and installer files.');
if (process.env.ATMOSPHERE_PROVIDER_RIGHTS_CONFIRMED !== '1') failures.push('Review the Open-Meteo and radar/place-name provider terms for your release and set ATMOSPHERE_PROVIDER_RIGHTS_CONFIRMED=1 only after confirming distribution rights.');
if (failures.length) {
  console.error('Signed release preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else console.log('Release signing and update feed configuration found.');
