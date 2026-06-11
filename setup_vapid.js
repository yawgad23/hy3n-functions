// Generate a new VAPID key pair and register it with Firebase Cloud Messaging
// Firebase FCM uses VAPID keys for Web Push authentication
// The key must be registered via the Firebase Console or API

const admin = require('firebase-admin');
const https = require('https');
const webpush = require('web-push');
const serviceAccount = require('./service-account.json');

const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

async function main() {
  // Step 1: Generate a new VAPID key pair
  const vapidKeys = webpush.generateVAPIDKeys();
  console.log('=== Generated VAPID Keys ===');
  console.log('Public Key:', vapidKeys.publicKey);
  console.log('Private Key:', vapidKeys.privateKey);

  // Step 2: Get an OAuth2 access token
  const tokenResult = await app.options.credential.getAccessToken();
  const accessToken = tokenResult.access_token;

  // Step 3: Register the VAPID public key with Firebase Cloud Messaging
  // Firebase stores VAPID keys per project using the FCM API
  // The correct endpoint to create/update a web push certificate is:
  // POST https://fcm.googleapis.com/v1/projects/{project}/webPushConfigs
  
  const body = JSON.stringify({
    webPushConfig: {
      vapidKey: vapidKeys.publicKey
    }
  });

  const result = await new Promise((resolve) => {
    const options = {
      hostname: 'fcm.googleapis.com',
      path: `/v1/projects/${serviceAccount.project_id}/webPushConfigs`,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', e => resolve({ status: 0, data: e.message }));
    req.write(body);
    req.end();
  });

  console.log('\n=== Firebase Registration Result ===');
  console.log('Status:', result.status);
  try { console.log(JSON.stringify(JSON.parse(result.data), null, 2)); }
  catch(e) { console.log(result.data.substring(0, 500)); }

  // Step 4: Save the keys to a file for reference
  const fs = require('fs');
  fs.writeFileSync('/home/ubuntu/hy3n-functions/vapid_keys.json', JSON.stringify({
    publicKey: vapidKeys.publicKey,
    privateKey: vapidKeys.privateKey,
    generatedAt: new Date().toISOString()
  }, null, 2));
  console.log('\nKeys saved to vapid_keys.json');
  
  process.exit(0);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
