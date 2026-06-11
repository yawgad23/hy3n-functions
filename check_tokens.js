const admin = require('./node_modules/firebase-admin');
const sa = require('./service-account.json');
const app = admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
db.collection('rider_profiles').get().then(snap => {
  console.log('Total rider profiles:', snap.size);
  snap.docs.forEach(d => {
    const data = d.data();
    const token = data.fcm_token;
    console.log(d.id, '| user_id:', data.user_id, '| fcm_token:', token ? token.substring(0,25)+'...' : 'NONE');
  });
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
