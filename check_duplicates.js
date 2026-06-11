const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkDuplicates() {
  console.log("--- Checking for duplicate FCM tokens ---");
  const ridersSnap = await db.collection('rider_profiles').get();
  const tokenMap = new Map();
  
  ridersSnap.forEach(doc => {
    const data = doc.data();
    if (data.fcm_token) {
      if (tokenMap.has(data.fcm_token)) {
        console.log(`Duplicate token found! Token: ${data.fcm_token.substring(0, 20)}...`);
        console.log(`Used by Rider IDs: ${tokenMap.get(data.fcm_token)} and ${doc.id}`);
      } else {
        tokenMap.set(data.fcm_token, doc.id);
      }
    }
  });

  console.log("\n--- Checking recent rides for double status updates ---");
  const ridesSnap = await db.collection('rides')
    .orderBy('created_date', 'desc')
    .limit(5)
    .get();

  ridesSnap.forEach(doc => {
    const data = doc.data();
    console.log(`Ride ${doc.id}: Status=${data.status}, Rider=${data.rider_id}, Driver=${data.driver_id}`);
    if (data.fcm_token) {
       console.log(`  Ride has fcm_token: ${data.fcm_token.substring(0, 20)}...`);
    }
  });
}

checkDuplicates().catch(console.error);
