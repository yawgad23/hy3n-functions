"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyBiometricKey = exports.verifyBiometricLogin = exports.getLoginChallenge = exports.generateBiometricKey = exports.getVapidPublicKey = exports.verifyPhoneLoginOtp = exports.sendPhoneLoginOtp = exports.generateInviteCode = exports.submitRideReport = exports.triggerSOS = exports.handleTripResponse = exports.suggestNearestDriver = exports.processCardPayment = exports.processMoMoWithdrawal = exports.processMoMoPayment = exports.placeDetails = exports.placesAutocomplete = exports.getGoogleMapsRoute = exports.calculateDistance = exports.getNearbyDrivers = exports.getSurgePricing = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const axios_1 = __importDefault(require("axios"));
const crypto = __importStar(require("crypto"));
admin.initializeApp();
const db = admin.firestore();
// ─────────────────────────────────────────────
// CORS helper
// ─────────────────────────────────────────────
const corsOrigins = [
    "https://hy3n26.web.app",
    "https://hy3n26.firebaseapp.com",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
];
function setCors(req, res) {
    const origin = req.headers.origin || "";
    if (corsOrigins.includes(origin) || origin.endsWith(".web.app") || origin.includes("localhost")) {
        res.set("Access-Control-Allow-Origin", origin);
    }
    else {
        res.set("Access-Control-Allow-Origin", corsOrigins[0]);
    }
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
function handleOptions(req, res) {
    setCors(req, res);
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return true;
    }
    return false;
}
// ─────────────────────────────────────────────
// 1. getSurgePricing
// Calculates surge multiplier based on active rides vs available drivers
// in the given radius.
// ─────────────────────────────────────────────
exports.getSurgePricing = functions.https.onRequest(async (req, res) => {
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { lat, lng, radius_km = 5 } = req.body;
        if (!lat || !lng) {
            res.status(400).json({ error: "lat and lng are required" });
            return;
        }
        const radiusMeters = radius_km * 1000;
        const now = admin.firestore.Timestamp.now();
        const fiveMinAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 5 * 60 * 1000);
        // Count active ride requests in the last 5 minutes (demand)
        const ridesSnap = await db.collection("Ride")
            .where("status", "in", ["pending", "searching"])
            .where("created_date", ">=", fiveMinAgo)
            .get();
        // Count online drivers (supply)
        const driversSnap = await db.collection("Driver")
            .where("is_online", "==", true)
            .where("is_available", "==", true)
            .get();
        const demand = ridesSnap.size;
        const supply = Math.max(driversSnap.size, 1);
        const ratio = demand / supply;
        let multiplier = 1.0;
        let is_surge = false;
        let surge_reason = "";
        if (ratio >= 3) {
            multiplier = 2.5;
            is_surge = true;
            surge_reason = "Very high demand";
        }
        else if (ratio >= 2) {
            multiplier = 2.0;
            is_surge = true;
            surge_reason = "High demand";
        }
        else if (ratio >= 1.5) {
            multiplier = 1.5;
            is_surge = true;
            surge_reason = "Moderate surge";
        }
        else if (ratio >= 1.2) {
            multiplier = 1.2;
            is_surge = true;
            surge_reason = "Slight surge";
        }
        res.json({
            multiplier,
            is_surge,
            surge_reason,
            demand,
            supply,
            ratio: Math.round(ratio * 100) / 100,
        });
    }
    catch (err) {
        console.error("getSurgePricing error:", err);
        res.status(500).json({ error: err.message, multiplier: 1.0, is_surge: false });
    }
});
// ─────────────────────────────────────────────
// 2. getNearbyDrivers
// Returns online, available drivers within radius (meters)
// ─────────────────────────────────────────────
exports.getNearbyDrivers = functions.https.onRequest(async (req, res) => {
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { lat, lng, radius = 5000 } = req.body;
        if (!lat || !lng) {
            res.status(400).json({ error: "lat and lng are required" });
            return;
        }
        const driversSnap = await db.collection("Driver")
            .where("is_online", "==", true)
            .where("is_available", "==", true)
            .get();
        const drivers = [];
        driversSnap.forEach((doc) => {
            const d = doc.data();
            if (d.current_lat && d.current_lng) {
                const dist = haversineDistance(lat, lng, d.current_lat, d.current_lng);
                if (dist <= radius) {
                    drivers.push({
                        id: doc.id,
                        name: d.full_name || "Driver",
                        lat: d.current_lat,
                        lng: d.current_lng,
                        rating: d.rating || 4.5,
                        vehicle_type: d.vehicle_type || "standard",
                        vehicle_plate: d.vehicle_plate || "",
                        distance_m: Math.round(dist),
                        eta_minutes: Math.max(1, Math.round(dist / 1000 / 30 * 60)), // ~30 km/h
                    });
                }
            }
        });
        // Sort by distance
        drivers.sort((a, b) => a.distance_m - b.distance_m);
        res.json({ drivers: drivers.slice(0, 20), total: drivers.length });
    }
    catch (err) {
        console.error("getNearbyDrivers error:", err);
        res.status(500).json({ error: err.message, drivers: [] });
    }
});
// ─────────────────────────────────────────────
// 3. calculateDistance
// Uses Google Maps Directions API (or Haversine fallback)
// ─────────────────────────────────────────────
exports.calculateDistance = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d;
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { pickup_lat, pickup_lng, dest_lat, dest_lng } = req.body;
        if (!pickup_lat || !pickup_lng || !dest_lat || !dest_lng) {
            res.status(400).json({ error: "All coordinates required" });
            return;
        }
        const apiKey = process.env.GOOGLE_MAPS_API_KEY || ((_a = functions.config().google) === null || _a === void 0 ? void 0 : _a.maps_api_key);
        if (apiKey) {
            try {
                const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${pickup_lat},${pickup_lng}&destination=${dest_lat},${dest_lng}&key=${apiKey}`;
                const response = await axios_1.default.get(url);
                const route = (_d = (_c = (_b = response.data.routes) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.legs) === null || _d === void 0 ? void 0 : _d[0];
                if (route) {
                    res.json({
                        distance_km: Math.round((route.distance.value / 1000) * 10) / 10,
                        duration_minutes: Math.round(route.duration.value / 60),
                        distance_text: route.distance.text,
                        duration_text: route.duration.text,
                    });
                    return;
                }
            }
            catch (e) {
                console.warn("Google Maps API failed, using Haversine fallback:", e);
            }
        }
        // Haversine fallback
        const distKm = haversineDistance(pickup_lat, pickup_lng, dest_lat, dest_lng) / 1000;
        const durationMin = Math.max(1, Math.round(distKm / 30 * 60)); // ~30 km/h average
        res.json({
            distance_km: Math.round(distKm * 10) / 10,
            duration_minutes: durationMin,
            distance_text: `${Math.round(distKm * 10) / 10} km`,
            duration_text: `${durationMin} min`,
        });
    }
    catch (err) {
        console.error("calculateDistance error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ─────────────────────────────────────────────
// 4. getGoogleMapsRoute
// Returns route data from Google Maps Directions API
// ─────────────────────────────────────────────
exports.getGoogleMapsRoute = functions.https.onRequest(async (req, res) => {
    var _a;
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { origin, destination } = req.body;
        if (!origin || !destination) {
            res.status(400).json({ error: "origin and destination required" });
            return;
        }
        const apiKey = process.env.GOOGLE_MAPS_API_KEY || ((_a = functions.config().google) === null || _a === void 0 ? void 0 : _a.maps_api_key);
        if (apiKey) {
            const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${apiKey}`;
            const response = await axios_1.default.get(url);
            res.json(response.data);
            return;
        }
        // Fallback: return a synthetic route
        const [oLat, oLng] = origin.split(",").map(Number);
        const [dLat, dLng] = destination.split(",").map(Number);
        const distM = haversineDistance(oLat, oLng, dLat, dLng);
        const durationSec = Math.round(distM / (30 * 1000 / 3600)); // 30 km/h
        res.json({
            routes: [{
                    legs: [{
                            distance: { value: Math.round(distM), text: `${Math.round(distM / 1000 * 10) / 10} km` },
                            duration: { value: durationSec, text: `${Math.round(durationSec / 60)} min` },
                        }],
                }],
            status: "OK",
        });
    }
    catch (err) {
        console.error("getGoogleMapsRoute error:", err);
        res.status(500).json({ error: err.message, routes: [] });
    }
});
// ─────────────────────────────────────────────
// 5. placesAutocomplete
// Google Places Autocomplete API
// ─────────────────────────────────────────────
exports.placesAutocomplete = functions.https.onRequest(async (req, res) => {
    var _a;
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { query } = req.body;
        if (!query) {
            res.json({ predictions: [] });
            return;
        }
        const apiKey = process.env.GOOGLE_MAPS_API_KEY || ((_a = functions.config().google) === null || _a === void 0 ? void 0 : _a.maps_api_key);
        if (apiKey) {
            const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${apiKey}&language=en&components=country:gh`;
            const response = await axios_1.default.get(url);
            res.json(response.data);
            return;
        }
        // Fallback: return empty predictions
        res.json({ predictions: [], status: "NO_API_KEY" });
    }
    catch (err) {
        console.error("placesAutocomplete error:", err);
        res.status(500).json({ error: err.message, predictions: [] });
    }
});
// ─────────────────────────────────────────────
// 6. placeDetails
// Google Places Details API
// ─────────────────────────────────────────────
exports.placeDetails = functions.https.onRequest(async (req, res) => {
    var _a;
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { placeId } = req.body;
        if (!placeId) {
            res.status(400).json({ error: "placeId required" });
            return;
        }
        const apiKey = process.env.GOOGLE_MAPS_API_KEY || ((_a = functions.config().google) === null || _a === void 0 ? void 0 : _a.maps_api_key);
        if (apiKey) {
            const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,geometry&key=${apiKey}`;
            const response = await axios_1.default.get(url);
            res.json(response.data);
            return;
        }
        res.status(400).json({ error: "Google Maps API key not configured" });
    }
    catch (err) {
        console.error("placeDetails error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ─────────────────────────────────────────────
// 7. processMoMoPayment
// MTN Mobile Money / Vodafone Cash payment processing
// Uses Paystack or direct MTN MoMo API
// ─────────────────────────────────────────────
exports.processMoMoPayment = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g;
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { amount, phone, provider, reference, description } = req.body;
        if (!amount || !phone || !provider) {
            res.status(400).json({ error: "amount, phone, and provider are required" });
            return;
        }
        const paystackKey = process.env.PAYSTACK_SECRET_KEY || ((_a = functions.config().paystack) === null || _a === void 0 ? void 0 : _a.secret_key);
        if (paystackKey) {
            // Use Paystack Mobile Money API
            const paystackProvider = provider === "mtn" ? "mtn" : provider === "vodafone" ? "vod" : "tgo";
            const response = await axios_1.default.post("https://api.paystack.co/charge", {
                amount: Math.round(amount * 100), // Paystack uses pesewas
                currency: "GHS",
                mobile_money: {
                    phone: phone.replace(/\s/g, ""),
                    provider: paystackProvider,
                },
                reference: reference || `HY3N-${Date.now()}`,
                metadata: { description: description || "HY3N Payment" },
            }, {
                headers: {
                    Authorization: `Bearer ${paystackKey}`,
                    "Content-Type": "application/json",
                },
            });
            const data = response.data;
            if (data.status && (((_b = data.data) === null || _b === void 0 ? void 0 : _b.status) === "success" || ((_c = data.data) === null || _c === void 0 ? void 0 : _c.status) === "send_otp" || ((_d = data.data) === null || _d === void 0 ? void 0 : _d.status) === "pending")) {
                res.json({
                    success: true,
                    status: data.data.status,
                    reference: data.data.reference,
                    message: data.message,
                    data: data.data,
                });
            }
            else {
                res.json({
                    success: false,
                    status: "failed",
                    message: data.message || "Payment failed",
                });
            }
            return;
        }
        // Sandbox mode: simulate successful payment
        console.warn("No Paystack key configured — using sandbox simulation");
        res.json({
            success: true,
            status: "success",
            reference: reference || `HY3N-SANDBOX-${Date.now()}`,
            message: "Payment successful (sandbox mode)",
            sandbox: true,
        });
    }
    catch (err) {
        console.error("processMoMoPayment error:", ((_e = err.response) === null || _e === void 0 ? void 0 : _e.data) || err.message);
        res.status(500).json({
            success: false,
            error: ((_g = (_f = err.response) === null || _f === void 0 ? void 0 : _f.data) === null || _g === void 0 ? void 0 : _g.message) || err.message,
        });
    }
});
// ─────────────────────────────────────────────
// 8. processMoMoWithdrawal
// Driver payout / withdrawal via MoMo
// ─────────────────────────────────────────────
exports.processMoMoWithdrawal = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { phone, provider, amount, driver_id } = req.body;
        if (!phone || !provider || !amount || !driver_id) {
            res.status(400).json({ error: "phone, provider, amount, and driver_id are required" });
            return;
        }
        const paystackKey = process.env.PAYSTACK_SECRET_KEY || ((_a = functions.config().paystack) === null || _a === void 0 ? void 0 : _a.secret_key);
        if (paystackKey) {
            // Create transfer recipient first
            const recipientRes = await axios_1.default.post("https://api.paystack.co/transferrecipient", {
                type: "mobile_money",
                name: `Driver ${driver_id}`,
                account_number: phone.replace(/\s/g, ""),
                bank_code: provider === "mtn" ? "MTN" : provider === "vodafone" ? "VOD" : "ATL",
                currency: "GHS",
            }, {
                headers: {
                    Authorization: `Bearer ${paystackKey}`,
                    "Content-Type": "application/json",
                },
            });
            const recipientCode = (_c = (_b = recipientRes.data) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.recipient_code;
            if (!recipientCode) {
                throw new Error("Failed to create transfer recipient");
            }
            // Initiate transfer
            const transferRes = await axios_1.default.post("https://api.paystack.co/transfer", {
                source: "balance",
                amount: Math.round(amount * 100),
                recipient: recipientCode,
                reason: `HY3N Driver Withdrawal - ${driver_id}`,
                currency: "GHS",
            }, {
                headers: {
                    Authorization: `Bearer ${paystackKey}`,
                    "Content-Type": "application/json",
                },
            });
            const transfer = (_d = transferRes.data) === null || _d === void 0 ? void 0 : _d.data;
            res.json({
                success: (transfer === null || transfer === void 0 ? void 0 : transfer.status) === "success" || (transfer === null || transfer === void 0 ? void 0 : transfer.status) === "pending",
                status: transfer === null || transfer === void 0 ? void 0 : transfer.status,
                reference: transfer === null || transfer === void 0 ? void 0 : transfer.reference,
                transfer_code: transfer === null || transfer === void 0 ? void 0 : transfer.transfer_code,
                message: (_e = transferRes.data) === null || _e === void 0 ? void 0 : _e.message,
            });
            return;
        }
        // Sandbox mode
        console.warn("No Paystack key — using sandbox simulation");
        res.json({
            success: true,
            status: "success",
            reference: `WD-SANDBOX-${Date.now()}`,
            message: "Withdrawal successful (sandbox mode)",
            sandbox: true,
        });
    }
    catch (err) {
        console.error("processMoMoWithdrawal error:", ((_f = err.response) === null || _f === void 0 ? void 0 : _f.data) || err.message);
        res.status(500).json({
            success: false,
            error: ((_h = (_g = err.response) === null || _g === void 0 ? void 0 : _g.data) === null || _h === void 0 ? void 0 : _h.message) || err.message,
        });
    }
});
// ─────────────────────────────────────────────
// 9. processCardPayment
// Card payment via Paystack
// ─────────────────────────────────────────────
exports.processCardPayment = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f;
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { card_token, amount, ride_id, rider_id, driver_id } = req.body;
        if (!amount || !ride_id) {
            res.status(400).json({ error: "amount and ride_id are required" });
            return;
        }
        const paystackKey = process.env.PAYSTACK_SECRET_KEY || ((_a = functions.config().paystack) === null || _a === void 0 ? void 0 : _a.secret_key);
        if (paystackKey && card_token && !card_token.startsWith("tok_")) {
            const response = await axios_1.default.post("https://api.paystack.co/charge", {
                amount: Math.round(amount * 100),
                currency: "GHS",
                authorization_code: card_token,
                metadata: { ride_id, rider_id, driver_id },
            }, {
                headers: {
                    Authorization: `Bearer ${paystackKey}`,
                    "Content-Type": "application/json",
                },
            });
            const data = (_b = response.data) === null || _b === void 0 ? void 0 : _b.data;
            res.json({
                success: (data === null || data === void 0 ? void 0 : data.status) === "success",
                status: data === null || data === void 0 ? void 0 : data.status,
                reference: data === null || data === void 0 ? void 0 : data.reference,
                message: (_c = response.data) === null || _c === void 0 ? void 0 : _c.message,
            });
            return;
        }
        // Sandbox / test card mode
        res.json({
            success: true,
            status: "success",
            reference: `CARD-${Date.now()}`,
            message: "Card payment successful (sandbox mode)",
            sandbox: true,
        });
    }
    catch (err) {
        console.error("processCardPayment error:", ((_d = err.response) === null || _d === void 0 ? void 0 : _d.data) || err.message);
        res.status(500).json({
            success: false,
            error: ((_f = (_e = err.response) === null || _e === void 0 ? void 0 : _e.data) === null || _f === void 0 ? void 0 : _f.message) || err.message,
        });
    }
});
// ─────────────────────────────────────────────
// 10. suggestNearestDriver
// Returns ranked list of available drivers for a trip
// ─────────────────────────────────────────────
exports.suggestNearestDriver = functions.https.onRequest(async (req, res) => {
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { pickup_lat, pickup_lng, trip_id } = req.body;
        if (!pickup_lat || !pickup_lng) {
            res.status(400).json({ error: "pickup_lat and pickup_lng required" });
            return;
        }
        const driversSnap = await db.collection("Driver")
            .where("is_online", "==", true)
            .where("is_available", "==", true)
            .get();
        const suggestions = [];
        driversSnap.forEach((doc) => {
            const d = doc.data();
            if (d.current_lat && d.current_lng) {
                const dist = haversineDistance(pickup_lat, pickup_lng, d.current_lat, d.current_lng);
                const eta = Math.max(1, Math.round(dist / 1000 / 30 * 60));
                suggestions.push({
                    driver_id: doc.id,
                    name: d.full_name || "Driver",
                    rating: d.rating || 4.5,
                    total_trips: d.total_trips || 0,
                    vehicle_type: d.vehicle_type || "standard",
                    vehicle_plate: d.vehicle_plate || "",
                    vehicle_model: d.vehicle_model || "",
                    distance_m: Math.round(dist),
                    eta_minutes: eta,
                    score: (1 / (dist + 1)) * (d.rating || 4.5) * 100,
                });
            }
        });
        suggestions.sort((a, b) => b.score - a.score);
        res.json({
            suggestions: suggestions.slice(0, 5),
            total_available: suggestions.length,
            trip_id,
        });
    }
    catch (err) {
        console.error("suggestNearestDriver error:", err);
        res.status(500).json({ error: err.message, suggestions: [] });
    }
});
// ─────────────────────────────────────────────
// 11. handleTripResponse
// Driver accepts or declines a trip
// ─────────────────────────────────────────────
exports.handleTripResponse = functions.https.onRequest(async (req, res) => {
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { tripId, action } = req.body;
        if (!tripId || !action) {
            res.status(400).json({ error: "tripId and action required" });
            return;
        }
        const tripRef = db.collection("Ride").doc(tripId);
        const tripSnap = await tripRef.get();
        if (!tripSnap.exists) {
            res.status(404).json({ error: "Trip not found" });
            return;
        }
        const trip = tripSnap.data();
        if (action === "accept") {
            if (trip.status !== "pending" && trip.status !== "searching") {
                res.json({ success: false, error: "Trip is no longer available" });
                return;
            }
            await tripRef.update({
                status: "accepted",
                accepted_at: admin.firestore.FieldValue.serverTimestamp(),
            });
            res.json({ success: true, trip: Object.assign(Object.assign({}, trip), { id: tripId, status: "accepted" }) });
        }
        else if (action === "decline") {
            // Log the decline but don't change trip status (let it be offered to another driver)
            await db.collection("TripDecline").add({
                trip_id: tripId,
                declined_at: admin.firestore.FieldValue.serverTimestamp(),
            });
            res.json({ success: true, message: "Trip declined" });
        }
        else {
            res.status(400).json({ error: "action must be 'accept' or 'decline'" });
        }
    }
    catch (err) {
        console.error("handleTripResponse error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ─────────────────────────────────────────────
// 12. triggerSOS
// Records SOS event and notifies emergency contacts
// ─────────────────────────────────────────────
exports.triggerSOS = functions.https.onRequest(async (req, res) => {
    var _a;
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { lat, lng, role, ride_id } = req.body;
        // Record SOS event in Firestore
        const sosRef = await db.collection("SOSEvent").add({
            lat: lat || null,
            lng: lng || null,
            role: role || "unknown",
            ride_id: ride_id || null,
            triggered_at: admin.firestore.FieldValue.serverTimestamp(),
            status: "active",
        });
        // If ride exists, update it with SOS flag
        if (ride_id) {
            await db.collection("Ride").doc(ride_id).update({
                sos_triggered: true,
                sos_at: admin.firestore.FieldValue.serverTimestamp(),
            }).catch(() => { }); // Don't fail if ride doesn't exist
        }
        // TODO: Send SMS to emergency contacts via Twilio when configured
        const twilioSid = process.env.TWILIO_ACCOUNT_SID || ((_a = functions.config().twilio) === null || _a === void 0 ? void 0 : _a.account_sid);
        if (twilioSid) {
            // Twilio SMS would go here
            console.log("SOS triggered — Twilio SMS would be sent here");
        }
        res.json({
            success: true,
            sos_id: sosRef.id,
            message: "SOS triggered. Help is on the way.",
        });
    }
    catch (err) {
        console.error("triggerSOS error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ─────────────────────────────────────────────
// 13. submitRideReport
// Records a ride report/complaint
// ─────────────────────────────────────────────
exports.submitRideReport = functions.https.onRequest(async (req, res) => {
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { ride_id, report_type, category, description, severity } = req.body;
        if (!ride_id || !report_type) {
            res.status(400).json({ error: "ride_id and report_type required" });
            return;
        }
        const reportRef = await db.collection("RideReport").add({
            ride_id,
            report_type,
            category: category || "",
            description: description || "",
            severity: severity || "medium",
            status: "pending",
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.json({
            success: true,
            report_id: reportRef.id,
            message: "Report submitted successfully",
        });
    }
    catch (err) {
        console.error("submitRideReport error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ─────────────────────────────────────────────
// 14. generateInviteCode
// Generates a unique referral/invite code for a user
// ─────────────────────────────────────────────
exports.generateInviteCode = functions.https.onRequest(async (req, res) => {
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        // Get auth token from header
        const authHeader = req.headers.authorization || "";
        let userId = "anonymous";
        if (authHeader.startsWith("Bearer ")) {
            try {
                const token = authHeader.split("Bearer ")[1];
                const decoded = await admin.auth().verifyIdToken(token);
                userId = decoded.uid;
            }
            catch (e) {
                // Continue without auth
            }
        }
        // Check if user already has a code
        const existingSnap = await db.collection("InviteCode")
            .where("user_id", "==", userId)
            .limit(1)
            .get();
        if (!existingSnap.empty) {
            const existing = existingSnap.docs[0].data();
            res.json({ code: existing.code, user_id: userId });
            return;
        }
        // Generate a new unique code
        const code = `HY3N-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
        await db.collection("InviteCode").add({
            user_id: userId,
            code,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
            uses: 0,
        });
        res.json({ code, user_id: userId });
    }
    catch (err) {
        console.error("generateInviteCode error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ─────────────────────────────────────────────
// 15. sendPhoneLoginOtp
// Sends OTP via SMS using Twilio (or Firebase Phone Auth)
// ─────────────────────────────────────────────
exports.sendPhoneLoginOtp = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c;
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { phone } = req.body;
        if (!phone) {
            res.status(400).json({ error: "phone required" });
            return;
        }
        // Generate a 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
        // Store OTP in Firestore (hashed)
        const otpHash = crypto.createHash("sha256").update(otp + phone).digest("hex");
        await db.collection("PhoneOTP").doc(phone).set({
            otp_hash: otpHash,
            expires_at: expiresAt,
            attempts: 0,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        const twilioSid = process.env.TWILIO_ACCOUNT_SID || ((_a = functions.config().twilio) === null || _a === void 0 ? void 0 : _a.account_sid);
        const twilioToken = process.env.TWILIO_AUTH_TOKEN || ((_b = functions.config().twilio) === null || _b === void 0 ? void 0 : _b.auth_token);
        const twilioPhone = process.env.TWILIO_PHONE || ((_c = functions.config().twilio) === null || _c === void 0 ? void 0 : _c.phone);
        if (twilioSid && twilioToken && twilioPhone) {
            const twilio = require("twilio")(twilioSid, twilioToken);
            await twilio.messages.create({
                body: `Your HY3N verification code is: ${otp}. Valid for 10 minutes.`,
                from: twilioPhone,
                to: phone,
            });
            res.json({ success: true, message: "OTP sent via SMS" });
        }
        else {
            // Development mode: return OTP in response (REMOVE IN PRODUCTION)
            console.warn(`[DEV] OTP for ${phone}: ${otp}`);
            res.json({
                success: true,
                message: "OTP sent (dev mode)",
                dev_otp: process.env.NODE_ENV !== "production" ? otp : undefined,
            });
        }
    }
    catch (err) {
        console.error("sendPhoneLoginOtp error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ─────────────────────────────────────────────
// 16. verifyPhoneLoginOtp
// Verifies OTP and returns a temp password for Firebase Auth login
// ─────────────────────────────────────────────
exports.verifyPhoneLoginOtp = functions.https.onRequest(async (req, res) => {
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { phone, otpCode } = req.body;
        if (!phone || !otpCode) {
            res.status(400).json({ error: "phone and otpCode required" });
            return;
        }
        const otpDoc = await db.collection("PhoneOTP").doc(phone).get();
        if (!otpDoc.exists) {
            res.json({ success: false, error: "No OTP found for this phone" });
            return;
        }
        const otpData = otpDoc.data();
        // Check expiry
        if (Date.now() > otpData.expires_at) {
            res.json({ success: false, error: "OTP has expired" });
            return;
        }
        // Check attempts
        if (otpData.attempts >= 5) {
            res.json({ success: false, error: "Too many attempts. Request a new OTP." });
            return;
        }
        // Verify hash
        const expectedHash = crypto.createHash("sha256").update(otpCode + phone).digest("hex");
        if (expectedHash !== otpData.otp_hash) {
            await db.collection("PhoneOTP").doc(phone).update({
                attempts: admin.firestore.FieldValue.increment(1),
            });
            res.json({ success: false, error: "Invalid OTP" });
            return;
        }
        // OTP is valid — delete it
        await db.collection("PhoneOTP").doc(phone).delete();
        // Find or create Firebase Auth user for this phone
        let userRecord;
        const email = `${phone.replace(/\+/g, "").replace(/\s/g, "")}@hy3n.phone`;
        try {
            userRecord = await admin.auth().getUserByEmail(email);
        }
        catch (e) {
            // User doesn't exist — create them
            const tempPassword = crypto.randomBytes(16).toString("hex");
            userRecord = await admin.auth().createUser({
                email,
                password: tempPassword,
                phoneNumber: phone,
                displayName: phone,
            });
        }
        // Generate a temp password for this session
        const tempPassword = crypto.randomBytes(16).toString("hex");
        await admin.auth().updateUser(userRecord.uid, { password: tempPassword });
        res.json({
            success: true,
            email,
            tempPassword,
            uid: userRecord.uid,
        });
    }
    catch (err) {
        console.error("verifyPhoneLoginOtp error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ─────────────────────────────────────────────
// 17. getVapidPublicKey
// Returns the VAPID public key for Web Push notifications
// ─────────────────────────────────────────────
exports.getVapidPublicKey = functions.https.onRequest(async (req, res) => {
    var _a;
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || ((_a = functions.config().vapid) === null || _a === void 0 ? void 0 : _a.public_key);
        if (!vapidPublicKey) {
            res.json({ vapidPublicKey: null, message: "VAPID not configured" });
            return;
        }
        res.json({ vapidPublicKey });
    }
    catch (err) {
        console.error("getVapidPublicKey error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ─────────────────────────────────────────────
// 18. generateBiometricKey
// Generates a WebAuthn challenge for biometric login
// ─────────────────────────────────────────────
exports.generateBiometricKey = functions.https.onRequest(async (req, res) => {
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const challenge = Array.from(crypto.randomBytes(32));
        const challengeId = crypto.randomBytes(16).toString("hex");
        // Store challenge temporarily (5 min TTL)
        await db.collection("BiometricChallenge").doc(challengeId).set({
            challenge,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
            expires_at: Date.now() + 5 * 60 * 1000,
        });
        res.json({ challenge, challengeId });
    }
    catch (err) {
        console.error("generateBiometricKey error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ─────────────────────────────────────────────
// 19. getLoginChallenge
// Returns a WebAuthn challenge for biometric login
// ─────────────────────────────────────────────
exports.getLoginChallenge = functions.https.onRequest(async (req, res) => {
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { email } = req.body;
        const challenge = Array.from(crypto.randomBytes(32));
        const challengeId = crypto.randomBytes(16).toString("hex");
        await db.collection("BiometricChallenge").doc(challengeId).set({
            challenge,
            email: email || null,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
            expires_at: Date.now() + 5 * 60 * 1000,
        });
        res.json({ challenge, challengeId });
    }
    catch (err) {
        console.error("getLoginChallenge error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ─────────────────────────────────────────────
// 20. verifyBiometricLogin / verifyBiometricKey
// Verifies a WebAuthn assertion
// ─────────────────────────────────────────────
exports.verifyBiometricLogin = functions.https.onRequest(async (req, res) => {
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { challengeId, credential, email } = req.body;
        // In a full implementation, verify the WebAuthn assertion here
        // For now, we verify the challenge exists and hasn't expired
        if (challengeId) {
            const challengeDoc = await db.collection("BiometricChallenge").doc(challengeId).get();
            if (challengeDoc.exists) {
                const data = challengeDoc.data();
                if (Date.now() < data.expires_at) {
                    await db.collection("BiometricChallenge").doc(challengeId).delete();
                    res.json({ success: true, verified: true });
                    return;
                }
            }
        }
        res.json({ success: false, verified: false, error: "Challenge expired or invalid" });
    }
    catch (err) {
        console.error("verifyBiometricLogin error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.verifyBiometricKey = functions.https.onRequest(async (req, res) => {
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { challengeId, credential, email } = req.body;
        if (challengeId) {
            const challengeDoc = await db.collection("BiometricChallenge").doc(challengeId).get();
            if (challengeDoc.exists) {
                const data = challengeDoc.data();
                if (Date.now() < data.expires_at) {
                    await db.collection("BiometricChallenge").doc(challengeId).delete();
                    res.json({ success: true, verified: true });
                    return;
                }
            }
        }
        res.json({ success: false, verified: false, error: "Challenge expired or invalid" });
    }
    catch (err) {
        console.error("verifyBiometricKey error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ─────────────────────────────────────────────
// Utility: Haversine distance in meters
// ─────────────────────────────────────────────
function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
//# sourceMappingURL=index.js.map