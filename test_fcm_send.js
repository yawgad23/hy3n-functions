const admin = require('firebase-admin');
const sa = require('/home/ubuntu/upload/hy3n26-firebase-adminsdk-fbsvc-e537d20568.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });

// The only rider with an FCM token
const token = 'fiVsrj0oYp8sZs5ggD15DY:APA91bH'; // prefix only shown, need full token

async function sendTest() {
  const db = admin.firestore();
  const snap = await db.collection('rider_profiles').where('user_id', '==', 'fGgkRLmej5Y6i44GgpWh10ZPFUV2').limit(1).get();
  if (snap.empty) { console.log('No profile found'); process.exit(1); }
  const fcmToken = snap.docs[0].data().fcm_token;
  console.log('Full token:', fcmToken ? fcmToken.substring(0, 50) + '...' : 'NONE');

  if (!fcmToken) { console.log('No FCM token to test with'); process.exit(1); }

  try {
    const msgId = await admin.messaging().send({
      token: fcmToken,
      notification: { title: 'HY3N Test', body: 'This is a test notification from the server.' },
      webpush: {
        notification: {
          title: 'HY3N Test',
          body: 'This is a test notification from the server.',
          icon: 'https://hy3n-rider.web.app/hy3n-icon-192.png',
          tag: 'hy3n-test',
        },
        fcmOptions: { link: 'https://hy3n-rider.web.app/' },
      },
    });
    console.log('SUCCESS — message ID:', msgId);
  } catch (err) {
    console.log('FAILED — error code:', err.code);
    console.log('FAILED — error message:', err.message);
  }
  process.exit(0);
}

sendTest().catch(e => { console.error(e.message); process.exit(1); });
