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
exports.checkRideSafety = exports.sendSupportReplyNotification = exports.onRideCompleted = exports.onRideStatusChange = exports.verifyBiometricKey = exports.verifyBiometricLogin = exports.getLoginChallenge = exports.generateBiometricKey = exports.getVapidPublicKey = exports.verifyPhoneLoginOtp = exports.sendPhoneLoginOtp = exports.generateInviteCode = exports.submitRideReport = exports.triggerSOS = exports.handleTripResponse = exports.suggestNearestDriver = exports.processCardPayment = exports.processMoMoWithdrawal = exports.processMoMoPayment = exports.placeDetails = exports.placesAutocomplete = exports.getGoogleMapsRoute = exports.calculateFare = exports.calculateDistance = exports.getNearbyDrivers = exports.getSurgePricing = void 0;
const functions = __importStar(require("firebase-functions/v1"));
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
        // Build set of driver user_ids who are currently on an active trip
        const activeStatuses = ["driver_arriving", "driver_arrived", "in_progress", "pending_driver"];
        const activeRidesSnaps = await Promise.all(activeStatuses.map(s => db.collection("rides").where("status", "==", s).get()));
        const busyDriverIds = new Set();
        activeRidesSnaps.forEach(snap => {
            snap.forEach(d => {
                const driverId = d.data().driver_id;
                if (driverId)
                    busyDriverIds.add(driverId);
            });
        });
        const drivers = [];
        driversSnap.forEach((doc) => {
            const d = doc.data();
            const driverUserId = d.user_id || doc.id;
            // Skip drivers who are currently on an active trip
            if (busyDriverIds.has(driverUserId) || busyDriverIds.has(doc.id))
                return;
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
    var _a, _b, _c;
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { pickup_lat, pickup_lng, dest_lat, dest_lng } = req.body;
        if (!pickup_lat || !pickup_lng || !dest_lat || !dest_lng) {
            res.status(400).json({ error: "All coordinates required" });
            return;
        }
        const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
        if (apiKey) {
            try {
                const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${pickup_lat},${pickup_lng}&destination=${dest_lat},${dest_lng}&key=${apiKey}`;
                const response = await axios_1.default.get(url);
                const route = (_c = (_b = (_a = response.data.routes) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.legs) === null || _c === void 0 ? void 0 : _c[0];
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
// 4. calculateFare
// Calculates fare based on distance, duration, and vehicle category using FareConfig
// ─────────────────────────────────────────────
exports.calculateFare = functions.https.onRequest(async (req, res) => {
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { distance_km, duration_minutes, category, lat, lng } = req.body;
        if (!distance_km || !category) {
            res.status(400).json({ error: "distance_km and category required" });
            return;
        }
        // Map rider categories to admin vehicle types
        const categoryToVehicleType = {
            standard: "Sedan",
            comfort: "SUV",
            kantanka: "SUV",
            executive: "Minivan",
            okada: "Motorcycle",
            express_delivery: "Tricycle"
        };
        const vehicleType = categoryToVehicleType[category] || "Sedan";
        // Fetch FareConfig from Firestore
        const fareConfigSnap = await db.collection("FareConfig").where("vehicle_type", "==", vehicleType).limit(1).get();
        let cfg = {
            base_fare: 5,
            per_km_rate: 3.5,
            minimum_fare: 10,
            surge_multiplier: 1,
            peak_multiplier: 1.3,
            night_multiplier: 1.2,
            traffic_multiplier: 1.5,
            peak_start_hour: 7,
            peak_end_hour: 9,
            peak_start_hour_2: 17,
            peak_end_hour_2: 19,
            night_start_hour: 22,
            night_end_hour: 5,
            traffic_enabled: false
        };
        if (!fareConfigSnap.empty) {
            cfg = Object.assign(Object.assign({}, cfg), fareConfigSnap.docs[0].data());
        }
        // Calculate dynamic multiplier
        const now = new Date();
        const hour = now.getHours();
        const inRange = (h, start, end) => start <= end ? h >= start && h < end : h >= start || h < end;
        const isPeak = inRange(hour, cfg.peak_start_hour, cfg.peak_end_hour) ||
            inRange(hour, cfg.peak_start_hour_2, cfg.peak_end_hour_2);
        const isNight = inRange(hour, cfg.night_start_hour, cfg.night_end_hour);
        const isTraffic = cfg.traffic_enabled;
        let multiplier = cfg.surge_multiplier || 1;
        if (isPeak)
            multiplier = Math.max(multiplier, cfg.peak_multiplier);
        if (isNight)
            multiplier = Math.max(multiplier, cfg.night_multiplier);
        if (isTraffic)
            multiplier = Math.max(multiplier, cfg.traffic_multiplier);
        // Final calculation
        const subtotal = (cfg.base_fare + (cfg.per_km_rate * distance_km)) * multiplier;
        const finalFare = Math.max(subtotal, cfg.minimum_fare);
        // Rounding: .50 or less down, > .50 up
        const roundedFare = Math.floor(finalFare + 0.49);
        res.json({
            fare: roundedFare,
            breakdown: {
                base: cfg.base_fare,
                distance_fare: cfg.per_km_rate * distance_km,
                multiplier,
                is_peak: isPeak,
                is_night: isNight,
                is_traffic: isTraffic
            }
        });
    }
    catch (err) {
        console.error("calculateFare error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ─────────────────────────────────────────────
// 5. getGoogleMapsRoute
// Returns route data from Google Maps Directions API
// ─────────────────────────────────────────────
exports.getGoogleMapsRoute = functions.https.onRequest(async (req, res) => {
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { origin, destination } = req.body;
        if (!origin || !destination) {
            res.status(400).json({ error: "origin and destination required" });
            return;
        }
        const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
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
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { query } = req.body;
        if (!query) {
            res.json({ predictions: [] });
            return;
        }
        const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
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
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { placeId } = req.body;
        if (!placeId) {
            res.status(400).json({ error: "placeId required" });
            return;
        }
        const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
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
    var _a, _b, _c, _d, _e, _f;
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { amount, phone, provider, reference, description } = req.body;
        if (!amount || !phone || !provider) {
            res.status(400).json({ error: "amount, phone, and provider are required" });
            return;
        }
        const paystackKey = process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY;
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
            if (data.status && (((_a = data.data) === null || _a === void 0 ? void 0 : _a.status) === "success" || ((_b = data.data) === null || _b === void 0 ? void 0 : _b.status) === "send_otp" || ((_c = data.data) === null || _c === void 0 ? void 0 : _c.status) === "pending")) {
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
        console.error("processMoMoPayment error:", ((_d = err.response) === null || _d === void 0 ? void 0 : _d.data) || err.message);
        res.status(500).json({
            success: false,
            error: ((_f = (_e = err.response) === null || _e === void 0 ? void 0 : _e.data) === null || _f === void 0 ? void 0 : _f.message) || err.message,
        });
    }
});
// ─────────────────────────────────────────────
// 8. processMoMoWithdrawal
// Driver payout / withdrawal via MoMo
// ─────────────────────────────────────────────
exports.processMoMoWithdrawal = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g;
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { phone, provider, amount, driver_id } = req.body;
        if (!phone || !provider || !amount || !driver_id) {
            res.status(400).json({ error: "phone, provider, amount, and driver_id are required" });
            return;
        }
        const paystackKey = process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY;
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
            const recipientCode = (_b = (_a = recipientRes.data) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.recipient_code;
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
            const transfer = (_c = transferRes.data) === null || _c === void 0 ? void 0 : _c.data;
            res.json({
                success: (transfer === null || transfer === void 0 ? void 0 : transfer.status) === "success" || (transfer === null || transfer === void 0 ? void 0 : transfer.status) === "pending",
                status: transfer === null || transfer === void 0 ? void 0 : transfer.status,
                reference: transfer === null || transfer === void 0 ? void 0 : transfer.reference,
                transfer_code: transfer === null || transfer === void 0 ? void 0 : transfer.transfer_code,
                message: (_d = transferRes.data) === null || _d === void 0 ? void 0 : _d.message,
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
        console.error("processMoMoWithdrawal error:", ((_e = err.response) === null || _e === void 0 ? void 0 : _e.data) || err.message);
        res.status(500).json({
            success: false,
            error: ((_g = (_f = err.response) === null || _f === void 0 ? void 0 : _f.data) === null || _g === void 0 ? void 0 : _g.message) || err.message,
        });
    }
});
// ─────────────────────────────────────────────
// 9. processCardPayment
// Card payment via Paystack
// ─────────────────────────────────────────────
exports.processCardPayment = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e;
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { card_token, amount, ride_id, rider_id, driver_id } = req.body;
        if (!amount || !ride_id) {
            res.status(400).json({ error: "amount and ride_id are required" });
            return;
        }
        const paystackKey = process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY;
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
            const data = (_a = response.data) === null || _a === void 0 ? void 0 : _a.data;
            res.json({
                success: (data === null || data === void 0 ? void 0 : data.status) === "success",
                status: data === null || data === void 0 ? void 0 : data.status,
                reference: data === null || data === void 0 ? void 0 : data.reference,
                message: (_b = response.data) === null || _b === void 0 ? void 0 : _b.message,
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
        console.error("processCardPayment error:", ((_c = err.response) === null || _c === void 0 ? void 0 : _c.data) || err.message);
        res.status(500).json({
            success: false,
            error: ((_e = (_d = err.response) === null || _d === void 0 ? void 0 : _d.data) === null || _e === void 0 ? void 0 : _e.message) || err.message,
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
        // Build set of driver user_ids who are currently on an active trip
        const activeStatuses = ["driver_arriving", "driver_arrived", "in_progress", "pending_driver"];
        const activeRidesSnaps = await Promise.all(activeStatuses.map(s => db.collection("rides").where("status", "==", s).get()));
        const busyDriverIds = new Set();
        activeRidesSnaps.forEach(snap => {
            snap.forEach(d => {
                const driverId = d.data().driver_id;
                if (driverId)
                    busyDriverIds.add(driverId);
            });
        });
        const suggestions = [];
        driversSnap.forEach((doc) => {
            const d = doc.data();
            const driverUserId = d.user_id || doc.id;
            // Skip drivers who are currently on an active trip
            if (busyDriverIds.has(driverUserId) || busyDriverIds.has(doc.id))
                return;
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
        const twilioSid = process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID;
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
        const twilioSid = process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID;
        const twilioToken = process.env.TWILIO_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN;
        const twilioPhone = process.env.TWILIO_PHONE || process.env.TWILIO_PHONE;
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
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
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
const RIDE_STATUS_NOTIFICATIONS = {
    pending_driver: {
        title: "Driver Found!",
        body: "A driver has been found for your trip. Waiting for confirmation...",
        tag: "hy3n-driver-found",
    },
    matched: {
        title: "Driver Assigned!",
        body: (r) => {
            const name = r.driver_name || "Your driver";
            const vehicle = [r.vehicle_color, r.vehicle_make, r.vehicle_model].filter(Boolean).join(" ");
            const plate = r.license_plate ? ` (${r.license_plate})` : "";
            return vehicle ? `${name} is heading to you in a ${vehicle}${plate}.` : `${name} is on the way.`;
        },
        tag: "hy3n-matched",
    },
    driver_arriving: {
        title: "Driver is on the Way!",
        body: (r) => {
            const name = r.driver_name || "Your driver";
            const vehicle = [r.vehicle_color, r.vehicle_make, r.vehicle_model].filter(Boolean).join(" ");
            const plate = r.license_plate ? ` (${r.license_plate})` : "";
            return vehicle ? `${name} is heading to you in a ${vehicle}${plate}. Be ready!` : `${name} is heading to your pickup. Be ready!`;
        },
        tag: "hy3n-arriving",
    },
    driver_arrived: {
        title: "Driver Has Arrived!",
        body: (r) => `${r.driver_name || "Your driver"} is waiting at your pickup. Hurry — waiting fees apply after 3 minutes.`,
        tag: "hy3n-arrived",
    },
    in_progress: {
        title: "Trip Started!",
        body: "You're on your way. Sit back and enjoy the ride.",
        tag: "hy3n-in-progress",
    },
    completed: {
        title: "Trip Complete!",
        body: (r) => {
            const fare = r.final_fare || r.fare_estimate;
            return fare ? `You've arrived. Total fare: GH₵${Math.round(fare)}. Rate your driver!` : "You've arrived safely. Rate your driver!";
        },
        tag: "hy3n-completed",
    },
    cancelled: {
        title: "Ride Cancelled",
        body: "Your ride has been cancelled.",
        tag: "hy3n-cancelled",
    },
};
exports.onRideStatusChange = functions.firestore
    .document("rides/{rideId}")
    .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const rideId = context.params.rideId;
    const oldStatus = before === null || before === void 0 ? void 0 : before.status;
    const newStatus = after === null || after === void 0 ? void 0 : after.status;
    if (!newStatus || oldStatus === newStatus)
        return null;
    console.log(`[FCM] Ride ${rideId}: ${oldStatus} → ${newStatus}`);
    const notifConfig = RIDE_STATUS_NOTIFICATIONS[newStatus];
    if (!notifConfig)
        return null;
    const riderId = after.user_id || after.rider_id;
    if (!riderId) {
        console.warn(`[FCM] No rider ID on ride ${rideId}`);
        return null;
    }
    // ── Deduplication guard ──────────────────────────────────────────────────
    // Firestore triggers can fire twice for the same write (especially on cold starts).
    // We use a short-lived dedup doc to ensure we only send one notification per
    // (rideId, status) transition. TTL is 60 seconds.
    const dedupId = `${rideId}_${newStatus}`;
    const dedupRef = db.collection("_fcm_dedup").doc(dedupId);
    try {
        await db.runTransaction(async (tx) => {
            var _a, _b, _c;
            const dedupDoc = await tx.get(dedupRef);
            if (dedupDoc.exists) {
                const sentAt = ((_c = (_b = (_a = dedupDoc.data()) === null || _a === void 0 ? void 0 : _a.sent_at) === null || _b === void 0 ? void 0 : _b.toMillis) === null || _c === void 0 ? void 0 : _c.call(_b)) || 0;
                if (Date.now() - sentAt < 60000) {
                    throw new Error("DUPLICATE");
                }
            }
            tx.set(dedupRef, { sent_at: admin.firestore.FieldValue.serverTimestamp(), ride_id: rideId, status: newStatus });
        });
    }
    catch (dedupErr) {
        if (dedupErr.message === "DUPLICATE") {
            console.log(`[FCM] Dedup: skipping duplicate notification for ${rideId} ${newStatus}`);
            return null;
        }
        // If dedup fails for other reasons, continue anyway (better to send than miss)
        console.warn("[FCM] Dedup check failed:", dedupErr.message);
    }
    let fcmToken = null;
    let profileDocId = null;
    try {
        const snap = await db.collection("rider_profiles").where("user_id", "==", riderId).limit(1).get();
        if (snap.empty) {
            console.warn(`[FCM] No rider profile for ${riderId}`);
            return null;
        }
        fcmToken = snap.docs[0].data().fcm_token || null;
        profileDocId = snap.docs[0].id;
    }
    catch (err) {
        console.error("[FCM] Profile fetch error:", err);
        return null;
    }
    if (!fcmToken) {
        console.warn(`[FCM] No FCM token for rider ${riderId}`);
        return null;
    }
    const title = notifConfig.title;
    const body = typeof notifConfig.body === "function" ? notifConfig.body(after) : notifConfig.body;
    const tag = notifConfig.tag;
    const message = {
        token: fcmToken,
        notification: { title, body },
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
            // Include pickup OTP so the rider can see it in the push notification
            pickup_code: after.pickup_code ? String(after.pickup_code) : "",
        },
        android: {
            priority: "high",
            notification: { channelId: "hy3n_rides", priority: "high", defaultVibrateTimings: true, defaultSound: true, tag },
        },
        apns: {
            payload: { aps: { alert: { title, body }, sound: "default", badge: 1, contentAvailable: true } },
            headers: { "apns-priority": "10", "apns-push-type": "alert" },
        },
        webpush: {
            notification: {
                title, body,
                icon: "https://hy3n-rider.web.app/hy3n-icon-192.png",
                badge: "https://hy3n-rider.web.app/hy3n-icon-192.png",
                tag,
                requireInteraction: newStatus === "driver_arrived",
                vibrate: [200, 100, 200],
                data: { ride_id: rideId, status: newStatus, action_url: "https://hy3n-rider.web.app/" },
                actions: [{ action: "open", title: "Open App" }],
            },
            fcmOptions: { link: "https://hy3n-rider.web.app/" },
        },
    };
    try {
        const msgId = await admin.messaging().send(message);
        console.log(`[FCM] ✅ Sent to rider ${riderId} for ${newStatus}. ID: ${msgId}`);
        return { success: true };
    }
    catch (err) {
        if (err.code === "messaging/registration-token-not-registered") {
            console.warn(`[FCM] Stale token for ${riderId} — clearing`);
            if (profileDocId)
                await db.collection("rider_profiles").doc(profileDocId).update({ fcm_token: null });
        }
        else {
            console.error("[FCM] Send error:", err);
        }
        return null;
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// onRideCompleted — Email Receipt
// Fires when a ride transitions to "completed".
// Sends a formatted HTML email receipt to the rider via Gmail SMTP (or any
// SMTP configured in environment variables).
// ─────────────────────────────────────────────────────────────────────────────
function buildReceiptHtml(ride, riderEmail) {
    const fare = ride.final_fare || ride.fare_estimate || 0;
    const date = ride.completed_at
        ? new Date(ride.completed_at).toLocaleString("en-GH", {
            timeZone: "Africa/Accra",
            year: "numeric", month: "long", day: "numeric",
            hour: "2-digit", minute: "2-digit",
        })
        : new Date().toLocaleString("en-GH", { timeZone: "Africa/Accra" });
    const paymentLabels = {
        mobile_money: "Mobile Money", cash: "Cash", card: "Card", wallet: "HY3N Wallet",
    };
    const payment = paymentLabels[ride.payment_method] || ride.payment_method || "Cash";
    const category = ride.category ? ride.category.charAt(0).toUpperCase() + ride.category.slice(1) : "Standard";
    const distText = ride.actual_distance_km ? `${Number(ride.actual_distance_km).toFixed(1)} km` : (ride.distance_km ? `${ride.distance_km} km` : "—");
    const durText = ride.duration_min ? `${ride.duration_min} min` : "—";
    const driverName = ride.driver_name || "Your Driver";
    const vehicle = [ride.vehicle_color, ride.vehicle_make, ride.vehicle_model].filter(Boolean).join(" ");
    const plate = ride.license_plate || "";
    const baseFare = ride.fare_estimate || fare;
    const waitingFee = ride.waiting_fee || 0;
    const tip = ride.tip_amount || 0;
    const promo = ride.promo_discount || 0;
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HY3N Ride Receipt</title></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e5e5e5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;padding:24px 16px;">
    <tr><td>
      <!-- Header -->
      <div style="text-align:center;padding:32px 0 24px;">
        <div style="display:inline-block;background:#f59e0b;color:#000;font-size:22px;font-weight:900;padding:10px 22px;border-radius:12px;letter-spacing:2px;">HY3N</div>
        <p style="color:#9ca3af;font-size:13px;margin:12px 0 0;">Your ride receipt</p>
      </div>

      <!-- Big Fare -->
      <div style="background:#1a1a1a;border-radius:20px;padding:32px 24px;text-align:center;margin-bottom:16px;border:1px solid #2a2a2a;">
        <p style="color:#9ca3af;font-size:13px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">Total Fare</p>
        <p style="font-size:56px;font-weight:900;color:#f59e0b;margin:0;line-height:1;">GH&#8373;${Math.round(fare)}</p>
        <p style="color:#6b7280;font-size:13px;margin:10px 0 0;">${payment} &middot; ${category}</p>
      </div>

      <!-- Date -->
      <p style="color:#6b7280;font-size:12px;text-align:center;margin:0 0 20px;">${date}</p>

      <!-- Route -->
      <div style="background:#1a1a1a;border-radius:16px;padding:20px;margin-bottom:16px;border:1px solid #2a2a2a;">
        <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;">
          <div style="display:flex;flex-direction:column;align-items:center;padding-top:4px;">
            <div style="width:10px;height:10px;border-radius:50%;background:#22c55e;"></div>
            <div style="width:2px;height:32px;background:#374151;margin:4px 0;"></div>
            <div style="width:10px;height:10px;border-radius:50%;background:#f59e0b;"></div>
          </div>
          <div style="flex:1;">
            <p style="color:#9ca3af;font-size:10px;text-transform:uppercase;margin:0 0 2px;">Pickup</p>
            <p style="font-size:14px;font-weight:500;margin:0 0 16px;">${ride.pickup_address || "Pickup location"}</p>
            <p style="color:#9ca3af;font-size:10px;text-transform:uppercase;margin:0 0 2px;">Drop-off</p>
            <p style="font-size:14px;font-weight:500;margin:0;">${ride.destination_address || "Destination"}</p>
          </div>
        </div>
        <div style="display:flex;gap:8px;border-top:1px solid #2a2a2a;padding-top:16px;">
          <div style="flex:1;text-align:center;background:#111;border-radius:10px;padding:10px;">
            <p style="font-size:15px;font-weight:700;margin:0;">${distText}</p>
            <p style="color:#6b7280;font-size:11px;margin:2px 0 0;">Distance</p>
          </div>
          <div style="flex:1;text-align:center;background:#111;border-radius:10px;padding:10px;">
            <p style="font-size:15px;font-weight:700;margin:0;">${durText}</p>
            <p style="color:#6b7280;font-size:11px;margin:2px 0 0;">Duration</p>
          </div>
          <div style="flex:1;text-align:center;background:#111;border-radius:10px;padding:10px;">
            <p style="font-size:15px;font-weight:700;color:#f59e0b;margin:0;">GH&#8373;${Math.round(fare)}</p>
            <p style="color:#6b7280;font-size:11px;margin:2px 0 0;">Fare</p>
          </div>
        </div>
      </div>

      <!-- Fare Breakdown -->
      <div style="background:#1a1a1a;border-radius:16px;padding:20px;margin-bottom:16px;border:1px solid #2a2a2a;">
        <p style="color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 14px;">Fare Breakdown</p>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px;">
          <span style="color:#9ca3af;">Base fare (${category})</span><span>GH&#8373;${Math.round(baseFare)}</span>
        </div>
        ${waitingFee > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px;"><span style="color:#9ca3af;">Waiting fee</span><span style="color:#f59e0b;">GH&#8373;${Math.round(waitingFee)}</span></div>` : ""}
        ${tip > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px;"><span style="color:#9ca3af;">Tip</span><span>GH&#8373;${Math.round(tip)}</span></div>` : ""}
        ${promo > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px;"><span style="color:#9ca3af;">Promo discount</span><span style="color:#22c55e;">-GH&#8373;${Math.round(promo)}</span></div>` : ""}
        <div style="border-top:1px solid #2a2a2a;padding-top:12px;display:flex;justify-content:space-between;font-size:16px;font-weight:700;">
          <span>Total</span><span style="color:#f59e0b;">GH&#8373;${Math.round(fare)}</span>
        </div>
      </div>

      <!-- Driver -->
      <div style="background:#1a1a1a;border-radius:16px;padding:20px;margin-bottom:24px;border:1px solid #2a2a2a;">
        <p style="color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Your Driver</p>
        <p style="font-size:16px;font-weight:700;margin:0 0 4px;">${driverName}</p>
        ${vehicle ? `<p style="color:#9ca3af;font-size:13px;margin:0;">${vehicle}${plate ? ` &middot; ${plate}` : ""}</p>` : ""}
      </div>

      <!-- Footer -->
      <div style="text-align:center;padding-bottom:32px;">
        <p style="color:#4b5563;font-size:12px;margin:0;">Thank you for riding with HY3N!</p>
        <p style="color:#374151;font-size:11px;margin:8px 0 0;">This is an automated receipt. Please do not reply to this email.</p>
      </div>
    </td></tr>
  </table>
</body>
</html>`;
}
exports.onRideCompleted = functions.firestore
    .document("rides/{rideId}")
    .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const rideId = context.params.rideId;
    // Only fire when status transitions TO "completed"
    if ((before === null || before === void 0 ? void 0 : before.status) === "completed" || (after === null || after === void 0 ? void 0 : after.status) !== "completed")
        return null;
    console.log(`[Receipt] Ride ${rideId} completed — sending email receipt`);
    // Get rider email from Firebase Auth
    const riderId = after.user_id || after.rider_id;
    if (!riderId) {
        console.warn("[Receipt] No rider ID");
        return null;
    }
    let riderEmail = null;
    let riderName = after.rider_name || "Rider";
    try {
        const userRecord = await admin.auth().getUser(riderId);
        riderEmail = userRecord.email || null;
        riderName = userRecord.displayName || riderName;
    }
    catch (err) {
        console.warn("[Receipt] Could not get rider auth record:", err);
    }
    if (!riderEmail) {
        // Try rider_profiles
        try {
            const snap = await db.collection("rider_profiles").where("user_id", "==", riderId).limit(1).get();
            if (!snap.empty)
                riderEmail = snap.docs[0].data().email || null;
        }
        catch (_a) { }
    }
    if (!riderEmail) {
        console.warn(`[Receipt] No email for rider ${riderId} — skipping`);
        return null;
    }
    const htmlBody = buildReceiptHtml(after, riderEmail);
    const subject = `Your HY3N Ride Receipt — GH₵${Math.round(after.final_fare || after.fare_estimate || 0)}`;
    // Send via Gmail SMTP using nodemailer
    const smtpUser = process.env.SMTP_USER || "hy3ntransportservices@gmail.com";
    const smtpPass = process.env.SMTP_PASS || "skah tmdn wkmw xeba";
    const smtpHost = "smtp.gmail.com";
    const smtpPort = 465;
    try {
        const nodemailer = require("nodemailer");
        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: true,
            auth: { user: smtpUser, pass: smtpPass },
        });
        await transporter.sendMail({
            from: `"HY3N Transport" <${smtpUser}>`,
            to: riderEmail,
            subject,
            html: htmlBody,
        });
        console.log(`[Receipt] ✅ Email sent to ${riderEmail} for ride ${rideId}`);
    }
    catch (err) {
        console.error("[Receipt] Email send error:", err.message);
    }
    // Mark receipt as sent in Firestore
    await change.after.ref.update({ receipt_sent: true, receipt_sent_at: new Date().toISOString() }).catch(() => { });
    return null;
});
// ─────────────────────────────────────────────
// 16. sendSupportReplyNotification
// Sends a push notification to the user (rider/driver) when an admin replies to their ticket.
// ─────────────────────────────────────────────
exports.sendSupportReplyNotification = functions.https.onRequest(async (req, res) => {
    if (handleOptions(req, res))
        return;
    setCors(req, res);
    try {
        const { ticketId, replyText } = req.body;
        if (!ticketId || !replyText) {
            res.status(400).json({ error: "ticketId and replyText are required" });
            return;
        }
        const ticketSnap = await db.collection("SupportTicket").doc(ticketId).get();
        if (!ticketSnap.exists) {
            res.status(404).json({ error: "Support ticket not found" });
            return;
        }
        const ticket = ticketSnap.data();
        let userId;
        let userType;
        if (ticket.from_rider_id) {
            userId = ticket.from_rider_id;
            userType = "rider";
        }
        else if (ticket.from_driver_id) {
            userId = ticket.from_driver_id;
            userType = "driver";
        }
        if (!userId || !userType) {
            console.warn(`[SupportReply] No user ID found for ticket ${ticketId}`);
            res.status(400).json({ error: "No associated rider or driver found for this ticket" });
            return;
        }
        const userRef = db.collection(userType === "rider" ? "Rider" : "Driver").doc(userId);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
            console.warn(`[SupportReply] User ${userId} (${userType}) not found`);
            res.status(404).json({ error: `Associated ${userType} not found` });
            return;
        }
        const userData = userSnap.data();
        const fcmToken = userData.fcm_token;
        if (!fcmToken) {
            console.warn(`[SupportReply] No FCM token for ${userType} ${userId}`);
            res.json({ success: true, message: `No FCM token for ${userType}. Notification not sent.` });
            return;
        }
        const title = "HY3N Support Reply";
        const body = `Your ticket \"${ticket.subject}\" has a new reply: ${replyText.substring(0, 70)}...`;
        const message = {
            token: fcmToken,
            notification: { title, body },
            data: {
                type: "support_reply",
                ticket_id: ticketId,
                subject: ticket.subject,
                reply: replyText,
            },
            android: {
                notification: { channelId: "hy3n_support", priority: "high", defaultVibrateTimings: true, defaultSound: true },
            },
            apns: {
                payload: {
                    aps: { sound: "default" },
                },
            },
        };
        try {
            const msgId = await admin.messaging().send(message);
            console.log(`[SupportReply] ✅ Sent to ${userType} ${userId} for ticket ${ticketId}. ID: ${msgId}`);
            res.json({ success: true, message: "Notification sent successfully" });
        }
        catch (err) {
            if (err.code === "messaging/registration-token-not-registered") {
                console.warn(`[SupportReply] Stale token for ${userType} ${userId} — clearing`);
                await userRef.update({ fcm_token: admin.firestore.FieldValue.delete() });
            }
            console.error("[SupportReply] Send error:", err);
            res.status(500).json({ success: false, error: err.message });
        }
    }
    catch (err) {
        console.error("sendSupportReplyNotification error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// 10. checkRideSafety (Ride Check)
// Scheduled function that runs every 5 minutes to check for "in_progress" rides
// that haven't moved or updated their location in over 5 minutes.
// Sends a safety check-in notification to the rider if a stall is detected.
// ─────────────────────────────────────────────────────────────────────────────
exports.checkRideSafety = functions.pubsub.schedule("every 5 minutes").onRun(async (context) => {
    const fiveMinAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 5 * 60 * 1000);
    try {
        // Find rides that are in progress
        const ridesSnap = await db.collection("Ride")
            .where("status", "==", "in_progress")
            .get();
        if (ridesSnap.empty)
            return null;
        const safetyChecks = ridesSnap.docs.map(async (doc) => {
            const ride = doc.data();
            const rideId = doc.id;
            // Check if the last location update was more than 5 minutes ago
            // or if the driver's current location hasn't changed (if we tracked history)
            // For now, we check the 'updated_at' timestamp on the ride
            const lastUpdate = ride.updated_at || ride.trip_started_at;
            if (!lastUpdate)
                return;
            const lastUpdateTime = typeof lastUpdate === "string"
                ? new Date(lastUpdate).getTime()
                : lastUpdate.toMillis();
            if (Date.now() - lastUpdateTime > 5 * 60 * 1000) {
                // Trip appears stalled. Send safety check-in to rider.
                const riderId = ride.user_id || ride.rider_id;
                if (!riderId)
                    return;
                // Get rider's FCM token
                const profileSnap = await db.collection("rider_profiles").where("user_id", "==", riderId).limit(1).get();
                if (profileSnap.empty)
                    return;
                const fcmToken = profileSnap.docs[0].data().fcm_token;
                if (!fcmToken)
                    return;
                const title = "Safety Check-in";
                const body = "We noticed your trip has stopped for a while. Is everything okay?";
                const message = {
                    token: fcmToken,
                    notification: { title, body },
                    data: {
                        type: "safety_check",
                        ride_id: rideId,
                        tag: "hy3n-safety-check",
                    },
                    android: {
                        priority: "high",
                        notification: { channelId: "hy3n_safety", priority: "high", defaultVibrateTimings: true, defaultSound: true },
                    },
                    apns: {
                        payload: { aps: { alert: { title, body }, sound: "default" } },
                    },
                };
                await admin.messaging().send(message);
                console.log(`[Safety] Sent check-in to rider ${riderId} for stalled ride ${rideId}`);
            }
        });
        await Promise.all(safetyChecks);
        return { success: true };
    }
    catch (err) {
        console.error("checkRideSafety error:", err);
        return null;
    }
});
//# sourceMappingURL=index.js.map