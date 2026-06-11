const admin = require('firebase-admin');
const https = require('https');
const serviceAccount = require('./service-account.json');
const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

app.options.credential.getAccessToken().then(token => {
  // Firebase Cloud Messaging API v1 - list web push configs
  const options = {
    hostname: 'fcm.googleapis.com',
    path: '/v1/projects/hy3n26/webPushConfigs',
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token.access_token }
  };
  const req = https.request(options, res => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => {
      console.log('Status:', res.statusCode);
      try { console.log(JSON.stringify(JSON.parse(data), null, 2)); }
      catch(e) { console.log(data); }
      process.exit(0);
    });
  });
  req.on('error', e => { console.error(e); process.exit(1); });
  req.end();
}).catch(e => { console.error(e.message); process.exit(1); });
