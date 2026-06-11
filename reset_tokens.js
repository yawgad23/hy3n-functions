// Clear all FCM tokens so the app re-registers fresh on next open
const admin = require("firebase-admin");
const SA_KEY = process.env.SA_KEY;
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

async function main() {
  const snap = await db.collection("rider_profiles").get();
  let cleared = 0;
  for (const d of snap.docs) {
    if (d.data().fcm_token) {
      await d.ref.update({ fcm_token: null, fcm_token_updated: null });
      console.log(`Cleared token for profile ${d.id} (user: ${d.data().user_id})`);
      cleared++;
    }
  }
  console.log(`\nDone. Cleared ${cleared} token(s). Riders must reopen the app to re-register.`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
