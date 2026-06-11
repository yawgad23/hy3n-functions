const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(fs.readFileSync(process.env.SA_KEY, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkDriver() {
  console.log('Checking driver profiles...');
  const snapshot = await db.collection('driver_profiles').limit(10).get();
  
  if (snapshot.empty) {
    console.log('No driver found with name starting with Philip');
    return;
  }

  snapshot.forEach(doc => {
    const data = doc.data();
    console.log(`Driver: ${data.full_name}`);
    console.log(`ID: ${doc.id}`);
    console.log(`Service Type: ${data.service_type}`);
    console.log(`Vehicle: ${data.vehicle_model} (${data.vehicle_plate})`);
    console.log('---');
  });
}

checkDriver().catch(console.error);
