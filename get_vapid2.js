const admin = require('firebase-admin');
const https = require('https');
const serviceAccount = require('./service-account.json');
const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

app.options.credential.getAccessToken().then(token => {
  // Try Firebase Management API to get web app config
  const options = {
    hostname: 'firebase.googleapis.com',
    path: '/v1beta1/projects/hy3n26/webApps',
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token.access_token }
  };
  const req = https.request(options, res => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => {
      console.log('Status:', res.statusCode);
      try {
        const parsed = JSON.parse(data);
        console.log(JSON.stringify(parsed, null, 2));
      } catch(e) { console.log(data.substring(0, 500)); }
      process.exit(0);
    });
  });
  req.on('error', e => { console.error(e); process.exit(1); });
  req.end();
}).catch(e => { console.error(e.message); process.exit(1); });
