const admin = require('firebase-admin');
const sa = require('/home/ubuntu/upload/hy3n26-firebase-adminsdk-fbsvc-e537d20568.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function check() {
  console.log('=== rider_profiles (FCM tokens) ===');
  const profiles = await db.collection('rider_profiles').limit(10).get();
  profiles.forEach(d => {
    const data = d.data();
    const token = data.fcm_token;
    console.log(
      'doc:', d.id,
      '| user_id:', data.user_id,
      '| has_token:', !!token,
      '| token_prefix:', token ? token.substring(0, 25) + '...' : 'NONE',
      '| updated:', data.fcm_token_updated || 'never'
    );
  });

  console.log('\n=== recent rides ===');
  const rides = await db.collection('rides').orderBy('created_date', 'desc').limit(5).get();
  rides.forEach(d => {
    const data = d.data();
    console.log(
      'ride:', d.id,
      '| status:', data.status,
      '| user_id:', data.user_id,
      '| final_fare:', data.final_fare,
      '| actual_km:', data.actual_distance_km
    );
  });

  process.exit(0);
}

check().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
