const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkPhones() {
  console.log("--- Checking recent rides for phone numbers ---");
  const ridesSnap = await db.collection('Ride')
    .orderBy('created_at', 'desc')
    .limit(5)
    .get();

  ridesSnap.forEach(doc => {
    const data = doc.data();
    console.log(`Ride ${doc.id}:`);
    console.log(`  Rider ID: ${data.rider_id}`);
    console.log(`  Rider Phone (in Ride doc): ${data.rider_phone || 'MISSING'}`);
    console.log(`  Passenger Phone (in Ride doc): ${data.passenger_phone || 'MISSING'}`);
  });

  console.log("\n--- Checking rider profiles for phone numbers ---");
  const ridersSnap = await db.collection('rider_profiles').limit(5).get();
  ridersSnap.forEach(doc => {
    const data = doc.data();
    console.log(`Rider ${doc.id}:`);
    console.log(`  Phone: ${data.phone || 'MISSING'}`);
    console.log(`  User ID: ${data.user_id}`);
  });
}

checkPhones().catch(console.error);
