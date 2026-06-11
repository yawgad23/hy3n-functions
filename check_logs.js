// Check recent rides and FCM token status
const admin = require("firebase-admin");
const SA_KEY = process.env.SA_KEY;
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

async function main() {
  // 1. Check recent completed rides
  console.log("\n=== Recent completed rides ===");
  const rides = await db.collection("rides")
    .where("status", "==", "completed")
    .orderBy("completed_at", "desc")
    .limit(3)
    .get().catch(() => db.collection("rides").where("status", "==", "completed").limit(3).get());
  
  rides.forEach(d => {
    const r = d.data();
    console.log(`Ride ${d.id}: rider=${r.user_id||r.rider_id}, final_fare=${r.final_fare}, receipt_sent=${r.receipt_sent}, completed_at=${r.completed_at}`);
  });

  // 2. Check rider FCM tokens
  console.log("\n=== Rider FCM tokens ===");
  const profiles = await db.collection("rider_profiles").limit(10).get();
  profiles.forEach(d => {
    const p = d.data();
    console.log(`Profile ${d.id}: user_id=${p.user_id}, email=${p.email||'none'}, has_fcm=${!!p.fcm_token}, token_updated=${p.fcm_token_updated||'never'}`);
  });

  // 3. Check rider emails in Firebase Auth
  console.log("\n=== Rider Auth emails ===");
  const riderIds = [];
  profiles.forEach(d => { if (d.data().user_id) riderIds.push(d.data().user_id); });
  for (const uid of riderIds.slice(0, 5)) {
    try {
      const u = await admin.auth().getUser(uid);
      console.log(`Auth ${uid}: email=${u.email||'NONE'}, displayName=${u.displayName||'none'}`);
    } catch (e) {
      console.log(`Auth ${uid}: ERROR - ${e.message}`);
    }
  }

  // 4. Check recent rides collection name
  console.log("\n=== Checking collection names ===");
  const cols = await db.listCollections();
  const rideRelated = cols.filter(c => c.id.toLowerCase().includes("ride"));
  console.log("Ride-related collections:", rideRelated.map(c => c.id).join(", "));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
