const admin = require('firebase-admin');
const https = require('https');
const serviceAccount = require('./service-account.json');
const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const APP_ID = '1:362594902321:web:9387b08590e7660216d010';

app.options.credential.getAccessToken().then(token => {
  // Get the web app config which includes messagingSenderId
  // Then try to get VAPID key via the web push cert endpoint
  const options = {
    hostname: 'firebase.googleapis.com',
    path: `/v1beta1/projects/hy3n26/webApps/${APP_ID}/config`,
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token.access_token }
  };
  const req = https.request(options, res => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => {
      console.log('=== Web App Config ===');
      console.log('Status:', res.statusCode);
      try {
        const parsed = JSON.parse(data);
        console.log(JSON.stringify(parsed, null, 2));
      } catch(e) { console.log(data.substring(0, 500)); }
      
      // Now try to get the VAPID key via the FCM web push cert API
      const opts2 = {
        hostname: 'iid.googleapis.com',
        path: `/iid/v1/webpush/vapid-key?project_id=hy3n26`,
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + token.access_token }
      };
      const req2 = https.request(opts2, res2 => {
        let d2 = '';
        res2.on('data', d => d2 += d);
        res2.on('end', () => {
          console.log('\n=== VAPID Key API ===');
          console.log('Status:', res2.statusCode);
          console.log(d2.substring(0, 500));
          process.exit(0);
        });
      });
      req2.on('error', e => { console.error(e); process.exit(1); });
      req2.end();
    });
  });
  req.on('error', e => { console.error(e); process.exit(1); });
  req.end();
}).catch(e => { console.error(e.message); process.exit(1); });
