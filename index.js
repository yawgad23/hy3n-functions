/**
 * HY3N — Firebase Cloud Functions
 * Sends FCM push notifications to riders when their ride status changes.
 *
 * Trigger: Firestore document update on rides/{rideId}
 * When status changes, reads the rider's fcm_token from rider_profiles
 * and sends a push notification via FCM HTTP v1 API.
 */

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

const db = getFirestore();

// Notification payloads for each status transition
const STATUS_NOTIFICATIONS = {
  pending_driver: {
    title: "Driver Found!",
    body: "A driver has been found for your trip. Waiting for confirmation...",
    tag: "hy3n-driver-found",
  },
  matched: {
    title: "Driver Assigned!",
    body: (ride) => {
      const name = ride.driver_name || "Your driver";
      const vehicle = [ride.vehicle_color, ride.vehicle_make, ride.vehicle_model].filter(Boolean).join(" ");
      const plate = ride.license_plate ? ` (${ride.license_plate})` : "";
      return vehicle
        ? `${name} is heading to you in a ${vehicle}${plate}.`
        : `${name} is on the way to pick you up.`;
    },
    tag: "hy3n-matched",
  },
  driver_arriving: {
    title: "Driver is on the Way!",
    body: (ride) => {
      const name = ride.driver_name || "Your driver";
      const vehicle = [ride.vehicle_color, ride.vehicle_make, ride.vehicle_model].filter(Boolean).join(" ");
      const plate = ride.license_plate ? ` (${ride.license_plate})` : "";
      return vehicle
        ? `${name} is heading to you in a ${vehicle}${plate}. Be ready!`
        : `${name} is heading to your pickup point. Be ready!`;
    },
    tag: "hy3n-arriving",
  },
  driver_arrived: {
    title: "Driver Has Arrived!",
    body: (ride) => {
      const name = ride.driver_name || "Your driver";
      return `${name} is waiting at your pickup point. Please hurry — waiting fees apply after 3 minutes.`;
    },
    tag: "hy3n-arrived",
  },
  in_progress: {
    title: "Trip Started!",
    body: "You're on your way. Sit back and enjoy the ride.",
    tag: "hy3n-in-progress",
  },
  completed: {
    title: "Trip Complete!",
    body: (ride) => {
      const fare = ride.final_fare || ride.fare_estimate;
      return fare
        ? `You've arrived safely. Total fare: GH₵${Math.round(fare)}. Don't forget to rate your driver!`
        : "You've arrived safely. Don't forget to rate your driver!";
    },
    tag: "hy3n-completed",
  },
  cancelled: {
    title: "Ride Cancelled",
    body: "Your ride has been cancelled.",
    tag: "hy3n-cancelled",
  },
};

exports.onRideStatusChange = onDocumentUpdated(
  { document: "rides/{rideId}", region: "us-central1" },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const rideId = event.params.rideId;

    const oldStatus = before?.status;
    const newStatus = after?.status;

    // Only act on actual status changes
    if (!newStatus || oldStatus === newStatus) return null;

    console.log(`[FCM] Ride ${rideId}: ${oldStatus} → ${newStatus}`);

    const notifConfig = STATUS_NOTIFICATIONS[newStatus];
    if (!notifConfig) {
      console.log(`[FCM] No notification configured for status: ${newStatus}`);
      return null;
    }

    // Get rider's FCM token
    const riderId = after.user_id || after.rider_id;
    if (!riderId) {
      console.warn(`[FCM] No rider ID on ride ${rideId}`);
      return null;
    }

    let fcmToken = null;
    try {
      const profileSnap = await db
        .collection("rider_profiles")
        .where("user_id", "==", riderId)
        .limit(1)
        .get();

      if (profileSnap.empty) {
        console.warn(`[FCM] No rider profile found for user ${riderId}`);
        return null;
      }

      fcmToken = profileSnap.docs[0].data().fcm_token;
    } catch (err) {
      console.error("[FCM] Error fetching rider profile:", err);
      return null;
    }

    if (!fcmToken) {
      console.warn(`[FCM] No FCM token for rider ${riderId} — they may not have granted notification permission`);
      return null;
    }

    // Build notification body
    const title = notifConfig.title;
    const body = typeof notifConfig.body === "function"
      ? notifConfig.body(after)
      : notifConfig.body;
    const tag = notifConfig.tag;

    // Send FCM message
    const message = {
      token: fcmToken,
      notification: {
        title,
        body,
      },
      data: {
        ride_id: rideId,
        status: newStatus,
        tag,
        action_url: "/",
        driver_name: after.driver_name || "",
        vehicle_color: after.vehicle_color || "",
        vehicle_make: after.vehicle_make || "",
        vehicle_model: after.vehicle_model || "",
        license_plate: after.license_plate || "",
      },
      android: {
        priority: "high",
        notification: {
          channelId: "hy3n_rides",
          priority: "high",
          defaultVibrateTimings: true,
          defaultSound: true,
          tag,
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
        },
      },
      apns: {
        payload: {
          aps: {
            alert: { title, body },
            sound: "default",
            badge: 1,
            contentAvailable: true,
          },
        },
        headers: {
          "apns-priority": "10",
          "apns-push-type": "alert",
        },
      },
      webpush: {
        notification: {
          title,
          body,
          icon: "/hy3n-icon-192.png",
          badge: "/hy3n-icon-192.png",
          tag,
          requireInteraction: newStatus === "driver_arrived",
          vibrate: [200, 100, 200],
          data: { ride_id: rideId, status: newStatus, action_url: "/" },
          actions: [{ action: "open", title: "Open App" }],
        },
        fcmOptions: { link: "/" },
      },
    };

    try {
      const response = await getMessaging().send(message);
      console.log(`[FCM] ✅ Notification sent to rider ${riderId} for status ${newStatus}. Message ID: ${response}`);
      return { success: true, messageId: response };
    } catch (err) {
      if (err.code === "messaging/registration-token-not-registered") {
        // Token is stale — clear it from Firestore
        console.warn(`[FCM] Stale token for rider ${riderId} — clearing`);
        try {
          const profileSnap = await db
            .collection("rider_profiles")
            .where("user_id", "==", riderId)
            .limit(1)
            .get();
          if (!profileSnap.empty) {
            await profileSnap.docs[0].ref.update({ fcm_token: null });
          }
        } catch (clearErr) {
          console.error("[FCM] Failed to clear stale token:", clearErr);
        }
      } else {
        console.error(`[FCM] Failed to send notification:`, err);
      }
      return null;
    }
  }
);
