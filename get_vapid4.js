// Fetch VAPID key from Firebase Cloud Messaging API
// The correct endpoint is the Firebase Cloud Messaging HTTP v1 API
const admin = require('firebase-admin');
const https = require('https');
const serviceAccount = require('./service-account.json');
const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

app.options.credential.getAccessToken().then(token => {
  console.log('Got access token, making API calls...\n');
  
  // Try the Firebase Cloud Messaging web push cert endpoint
  // This is the endpoint that stores VAPID keys per sender ID
  const makeRequest = (hostname, path, label) => {
    return new Promise((resolve) => {
      const options = {
        hostname,
        path,
        method: 'GET',
        headers: { 
          'Authorization': 'Bearer ' + token.access_token,
          'Content-Type': 'application/json'
        }
      };
      const req = https.request(options, res => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          console.log(`=== ${label} ===`);
          console.log('Status:', res.statusCode);
          try { console.log(JSON.stringify(JSON.parse(data), null, 2).substring(0, 800)); }
          catch(e) { console.log(data.substring(0, 400)); }
          console.log('');
          resolve();
        });
      });
      req.on('error', e => { console.error(`${label} error:`, e.message); resolve(); });
      req.end();
    });
  };

  Promise.all([
    // Try the correct Firebase Cloud Messaging v1 API for web push config
    makeRequest('fcm.googleapis.com', '/v1/projects/hy3n26/messages:send', 'FCM v1 test'),
    // Try getting web push certs from the Firebase project settings
    makeRequest('www.googleapis.com', '/identitytoolkit/v3/relyingparty/getProjectConfig?key=AIzaSyDYUm2xv_8er3oGwk6qVXzAT51hoS4N4dE', 'Identity Toolkit'),
  ]).then(() => process.exit(0));
}).catch(e => { console.error(e.message); process.exit(1); });
