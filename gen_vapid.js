// Generate a new VAPID key pair using the web-push library
// This will be used to replace the potentially incorrect VAPID key in the app

const { execSync } = require('child_process');

// Install web-push if not already installed
try {
  require('web-push');
} catch(e) {
  console.log('Installing web-push...');
  execSync('npm install web-push --no-save', { cwd: '/home/ubuntu/hy3n-functions', stdio: 'inherit' });
}

const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('\n=== NEW VAPID KEY PAIR ===');
console.log('Public Key:', keys.publicKey);
console.log('Private Key:', keys.privateKey);
console.log('\nUse the PUBLIC KEY in the app (useFCMNotifications.js and firebase-messaging-sw.js)');
console.log('Use the PRIVATE KEY in the server/Cloud Functions');
