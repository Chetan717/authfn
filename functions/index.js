
// "use strict";

// const { onCall: _onCall, HttpsError } = require("firebase-functions/v2/https");

// const onCall = (handler) => _onCall({ region: "us-central1" }, handler);
// const { initializeApp } = require("firebase-admin/app");
// const { getFirestore } = require("firebase-admin/firestore");
// const axios = require("axios");
// const crypto = require("crypto");

// initializeApp();
// const db = getFirestore();

// const COL_USERS = process.env.COL_USERS || "users";
// const COL_MLMPROFILES = process.env.COL_MLMPROFILES || "mlmprofiles";
// const COL_MTEAM = process.env.COL_MTEAM || "mteam";
// const COL_COUPONCODE = process.env.COL_COUPONCODE || "couponcode";
// const COL_SESSIONS = "_authSessions"; // server-internal
// const COL_RATE = "_rateLimits"; // server-internal

// const LIMITS = {
//   // OTP sends — one shared bucket for signup, login-unverified, forgetpin, resend
//   otp_mobile: { max: 3, windowMs: 10 * 60 * 1000 }, // 3 OTPs / 10 min / mobile
//   otp_ip: { max: 8, windowMs: 10 * 60 * 1000 }, // 8 OTPs / 10 min / IP

//   // Login PIN attempts
//   login_mobile: { max: 10, windowMs: 15 * 60 * 1000 }, // 10 attempts / 15 min / mobile
//   login_ip: { max: 25, windowMs: 15 * 60 * 1000 }, // 25 attempts / 15 min / IP

//   // OTP verification (wrong-guess guard)
//   verify_ip: { max: 20, windowMs: 10 * 60 * 1000 }, // 20 verifies / 10 min / IP

//   // Change PIN (sensitive — must know current PIN)
//   changepin_mobile: { max: 5, windowMs: 15 * 60 * 1000 }, // 5 attempts / 15 min / mobile
//   changepin_ip: { max: 10, windowMs: 15 * 60 * 1000 }, // 10 attempts / 15 min / IP

//   // Delete Account (most destructive — very strict)
//   deleteacc_mobile: { max: 3, windowMs: 30 * 60 * 1000 }, // 3 attempts / 30 min / mobile
//   deleteacc_ip: { max: 6, windowMs: 30 * 60 * 1000 }, // 6 attempts / 30 min / IP
// };

// // ─── Rate-limit helpers ───────────────────────────────────────────────────────

// /**
//  * Atomically increment a sliding-window counter.
//  * Throws HttpsError "resource-exhausted" when the limit is exceeded.
//  *
//  * @param {string} bucket  e.g. "otp_mobile"
//  * @param {string} key     e.g. mobile number or IP
//  */
// async function checkRateLimit(bucket, key) {
//   const policy = LIMITS[bucket];
//   if (!policy) return; // unknown bucket → skip

//   const docId = `${bucket}:${key}`;
//   const ref = db.collection(COL_RATE).doc(docId);
//   const now = Date.now();

//   await db.runTransaction(async (tx) => {
//     const snap = await tx.get(ref);

//     if (!snap.exists) {
//       // First request in this window
//       tx.set(ref, {
//         bucket,
//         key,
//         count: 1,
//         windowStart: now,
//         expiresAt: now + policy.windowMs,
//       });
//       return;
//     }

//     const data = snap.data();

//     // Window expired → reset
//     if (now - data.windowStart >= policy.windowMs) {
//       tx.set(ref, {
//         bucket,
//         key,
//         count: 1,
//         windowStart: now,
//         expiresAt: now + policy.windowMs,
//       });
//       return;
//     }

//     // Over limit
//     if (data.count >= policy.max) {
//       const retryAfterSec = Math.ceil(
//         (data.windowStart + policy.windowMs - now) / 1000,
//       );
//       throw new HttpsError(
//         "resource-exhausted",
//         `Too many attempts. Please try again in ${retryAfterSec} second${retryAfterSec === 1 ? "" : "s"}.`,
//       );
//     }

//     // Within limit → increment
//     tx.update(ref, { count: data.count + 1 });
//   });
// }

// /**
//  * Run two rate-limit checks in parallel.
//  * Conveniently wraps the most common pattern: per-mobile + per-IP.
//  */
// async function checkRateLimits(mobileBucket, mobile, ipBucket, ip) {
//   await Promise.all([
//     checkRateLimit(mobileBucket, mobile),
//     ip ? checkRateLimit(ipBucket, ip) : Promise.resolve(),
//   ]);
// }

// /** Extract caller IP from an onCall request (best-effort). */
// function getIp(request) {
//   return (
//     request?.rawRequest?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
//     request?.rawRequest?.ip ||
//     null
//   );
// }

// // ─── OTP verify: per-session wrong-guess limiter ──────────────────────────────
// // Stored directly inside the session doc as { wrongCount }.
// const MAX_OTP_WRONG_GUESSES = 5;

// async function incrementOtpWrongGuess(sessionId) {
//   const ref = db.collection(COL_SESSIONS).doc(sessionId);
//   const snap = await ref.get();
//   if (!snap.exists) return; // already deleted

//   const wrong = (snap.data().wrongCount || 0) + 1;
//   if (wrong >= MAX_OTP_WRONG_GUESSES) {
//     // Invalidate session on too many wrong guesses
//     await ref.delete();
//     throw new HttpsError(
//       "resource-exhausted",
//       "Too many incorrect OTP attempts. Please start over.",
//     );
//   }
//   await ref.update({ wrongCount: wrong });
// }

// // ─── General helpers ──────────────────────────────────────────────────────────

// function generateOTP() {
//   return Math.floor(1000 + Math.random() * 9000).toString();
// }

// function generateSessionId() {
//   return crypto.randomBytes(24).toString("hex");
// }

// function generateReferCode(mobile) {
//   const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
//   const randomPart = Array.from(
//     { length: 4 },
//     () => chars[Math.floor(Math.random() * chars.length)],
//   ).join("");
//   return randomPart + mobile.slice(-4);
// }

// async function sendOtpViaSms(mobile, otp) {
//   const apiKey = process.env.TWOFACTOR_API_KEY;
//   if (!apiKey) throw new Error("TWOFACTOR_API_KEY not configured");
//   await axios.get(
//     `https://2factor.in/API/V1/${apiKey}/SMS/+91${mobile}/${otp}/OTP`,
//     { timeout: 10000 },
//   );
// }

// async function fetchMlmProfile(mobile) {
//   const snap = await db
//     .collection(COL_MLMPROFILES)
//     .where("mobile", "==", mobile)
//     .limit(1)
//     .get();
//   if (snap.empty) return null;
//   const d = snap.docs[0];
//   return { id: d.id, ...d.data() };
// }

// // ─── Session helpers ──────────────────────────────────────────────────────────

// async function createSession(type, payload) {
//   const sessionId = generateSessionId();
//   const expiresAt = Date.now() + 10 * 60 * 1000; // 10 min
//   await db.collection(COL_SESSIONS).doc(sessionId).set({
//     type,
//     payload,
//     expiresAt,
//     createdAt: Date.now(),
//     wrongCount: 0,
//   });
//   return sessionId;
// }

// async function getSession(sessionId, expectedType) {
//   if (!sessionId)
//     throw new HttpsError("invalid-argument", "Session ID missing");

//   const snap = await db.collection(COL_SESSIONS).doc(sessionId).get();
//   if (!snap.exists)
//     throw new HttpsError(
//       "not-found",
//       "Session expired or invalid. Please start again.",
//     );

//   const data = snap.data();
//   if (data.type !== expectedType)
//     throw new HttpsError("invalid-argument", "Session type mismatch");
//   if (data.expiresAt < Date.now())
//     throw new HttpsError(
//       "deadline-exceeded",
//       "Session expired. Please start again.",
//     );

//   return data.payload;
// }

// async function deleteSession(sessionId) {
//   await db.collection(COL_SESSIONS).doc(sessionId).delete();
// }

// // ═════════════════════════════════════════════════════════════════════════════
// //  CLOUD FUNCTIONS
// // ═════════════════════════════════════════════════════════════════════════════

// // ─────────────────────────────────────────────────────────────────────────────
// //  1. LOGIN
// //     Rate limits: 10 attempts / 15 min per mobile  |  25 / 15 min per IP
// //     Client sends: { mobile, pin }
// //     Returns:      { status, user?, mlmProfile?, sessionId?, mobile? }
// // ─────────────────────────────────────────────────────────────────────────────
// exports.authLogin = onCall(async (request) => {
//   const { mobile, pin } = request.data || {};
//   const ip = getIp(request);

//   if (!/^[0-9]{10}$/.test(mobile))
//     throw new HttpsError(
//       "invalid-argument",
//       "Please enter a valid 10-digit mobile number",
//     );
//   if (!/^[0-9]{4}$/.test(pin))
//     throw new HttpsError(
//       "invalid-argument",
//       "Please enter a valid 4-digit PIN",
//     );

//   // ── Rate limit check ──
//   await checkRateLimits("login_mobile", mobile, "login_ip", ip);

//   const snap = await db
//     .collection(COL_USERS)
//     .where("mobileNo", "==", mobile)
//     .limit(1)
//     .get();

//   if (snap.empty)
//     throw new HttpsError(
//       "not-found",
//       "No account found with this mobile number",
//     );

//   const userDoc = snap.docs[0];
//   const userData = userDoc.data();

//   // Unverified account → send OTP first
//   if (!userData.isverified) {
//     // OTP-send rate limits
//     await checkRateLimits("otp_mobile", mobile, "otp_ip", ip);

//     const otp = generateOTP();
//     await sendOtpViaSms(mobile, otp);
//     await userDoc.ref.update({ otp });

//     const sessionId = await createSession("login_verify", {
//       userId: userDoc.id,
//       mobile: userData.mobileNo,
//       otp,
//     });

//     return {
//       status: "unverified",
//       sessionId,
//       mobile: userData.mobileNo,
//       userId: userDoc.id,
//     };
//   }

//   // PIN check (server-side)
//   if (userData.password !== pin)
//     throw new HttpsError("unauthenticated", "Incorrect PIN. Please try again.");

//   const user = {
//     id: userDoc.id,
//     name: userData.name,
//     mobileNo: userData.mobileNo,
//     isverified: userData.isverified,
//     createdAt: userData.createdAt?.toDate?.()?.toISOString() ?? "",
//     referCode: userData.referCode ?? "",
//     referredBy: userData.referredBy ?? null,
//     referCredit: userData.referCredit ?? 0,
//     referredByMteam: userData.referredByMteam ?? null,
//     mteamCouponCode: userData.mteamCouponCode ?? null,
//   };

//   const mlmProfile = await fetchMlmProfile(mobile);
//   return { status: "ok", user, mlmProfile };
// });

// // ─────────────────────────────────────────────────────────────────────────────
// //  2. SIGNUP — STEP 1  (validate + send OTP)
// //     Rate limits: 3 OTPs / 10 min per mobile  |  8 / 10 min per IP
// //     Client sends: { name, mobile, pin, referCode }
// //     Returns:      { status, sessionId }
// // ─────────────────────────────────────────────────────────────────────────────
// exports.authSignupInit = onCall(async (request) => {
//   const { name, mobile, pin, referCode = "" } = request.data || {};
//   const ip = getIp(request);

//   if (!name || name.trim().length < 3)
//     throw new HttpsError(
//       "invalid-argument",
//       "Name must be at least 3 characters",
//     );
//   if (!/^[0-9]{10}$/.test(mobile))
//     throw new HttpsError(
//       "invalid-argument",
//       "Mobile number must be exactly 10 digits",
//     );
//   if (!/^[0-9]{4}$/.test(pin))
//     throw new HttpsError("invalid-argument", "PIN must be exactly 4 digits");

//   // ── Rate limit check ──
//   await checkRateLimits("otp_mobile", mobile, "otp_ip", ip);

//   // Block already-verified mobiles
//   const verifiedSnap = await db
//     .collection(COL_USERS)
//     .where("mobileNo", "==", mobile)
//     .where("isverified", "==", true)
//     .limit(1)
//     .get();

//   if (!verifiedSnap.empty)
//     throw new HttpsError("already-exists", "Mobile number already registered");

//   // Soft-delete old unverified docs for this mobile
//   const unverifiedSnap = await db
//     .collection(COL_USERS)
//     .where("mobileNo", "==", mobile)
//     .where("isverified", "==", false)
//     .get();

//   const batch = db.batch();
//   unverifiedSnap.docs.forEach((d) => {
//     batch.update(d.ref, { mobileNo: `_deleted_${mobile}_${d.id}` });
//   });
//   await batch.commit();

//   // Validate refer code
//   let referredByDocId = null;
//   let referredByMteamId = null;
//   let mteamCouponCode = null;
//   const trimmedRefer = referCode.trim().toUpperCase();

//   if (trimmedRefer !== "") {
//     if (!/^[A-Za-z0-9]{6,8}$/.test(trimmedRefer))
//       throw new HttpsError("invalid-argument", "Invalid refer code format");

//     const userReferSnap = await db
//       .collection(COL_USERS)
//       .where("referCode", "==", trimmedRefer)
//       .limit(1)
//       .get();

//     if (!userReferSnap.empty) {
//       referredByDocId = userReferSnap.docs[0].id;
//     } else {
//       const mteamSnap = await db
//         .collection(COL_MTEAM)
//         .where("referCode", "==", trimmedRefer)
//         .limit(1)
//         .get();

//       if (!mteamSnap.empty) {
//         const mteamDoc = mteamSnap.docs[0];
//         referredByMteamId = mteamDoc.id;
//         const couponId = mteamDoc.data().assign_coupon_id;

//         if (couponId) {
//           const couponSnap = await db
//             .collection(COL_COUPONCODE)
//             .doc(couponId)
//             .get();
//           if (couponSnap.exists && couponSnap.data().active) {
//             mteamCouponCode = couponSnap.data().code || null;
//           }
//         }
//       } else {
//         throw new HttpsError("not-found", "Refer code not found");
//       }
//     }
//   }

//   const otp = generateOTP();
//   const referCode2 = generateReferCode(mobile);

//   await sendOtpViaSms(mobile, otp);

//   const sessionId = await createSession("signup", {
//     name: name.trim(),
//     mobile,
//     pin,
//     otp,
//     referCode: referCode2,
//     referredBy: trimmedRefer || null,
//     referredByDocId: referredByDocId || null,
//     referredByMteamId: referredByMteamId || null,
//     mteamCouponCode: mteamCouponCode || null,
//   });

//   return { status: "otp_sent", sessionId };
// });

// // ─────────────────────────────────────────────────────────────────────────────
// //  3. SIGNUP — STEP 2  (verify OTP + create user)
// //     Rate limits: 5 wrong guesses / session  |  20 verify calls / 10 min / IP
// //     Client sends: { sessionId, otp }
// //     Returns:      { status, user, mlmProfile }
// // ─────────────────────────────────────────────────────────────────────────────
// exports.authSignupVerify = onCall(async (request) => {
//   const { sessionId, otp } = request.data || {};
//   const ip = getIp(request);

//   if (!otp || otp.length < 4)
//     throw new HttpsError("invalid-argument", "Please enter the 4-digit OTP");

//   // ── Rate limit check (IP only — session handles per-attempt guard) ──
//   if (ip) await checkRateLimit("verify_ip", ip);

//   const pending = await getSession(sessionId, "signup");

//   if (otp !== pending.otp) {
//     await incrementOtpWrongGuess(sessionId);
//     throw new HttpsError("unauthenticated", "Incorrect OTP. Please try again.");
//   }

//   // Race-condition guard
//   const finalCheck = await db
//     .collection(COL_USERS)
//     .where("mobileNo", "==", pending.mobile)
//     .where("isverified", "==", true)
//     .limit(1)
//     .get();

//   if (!finalCheck.empty)
//     throw new HttpsError(
//       "already-exists",
//       "Mobile number was just registered by someone else. Please try a different number.",
//     );

//   const docRef = await db.collection(COL_USERS).add({
//     name: pending.name,
//     mobileNo: pending.mobile,
//     password: pending.pin,
//     createdAt: new Date(),
//     isverified: true,
//     otp: "",
//     referCode: pending.referCode,
//     referredBy: pending.referredBy,
//     referredByMteam: pending.referredByMteamId || null,
//     mteamCouponCode: pending.mteamCouponCode || null,
//     referCredit: pending.referredBy ? 5 : 0,
//   });

//   // Credit the referrer (+10)
//   if (pending.referredByDocId) {
//     try {
//       const referrerRef = db.collection(COL_USERS).doc(pending.referredByDocId);
//       const referrerSnap = await referrerRef.get();
//       if (referrerSnap.exists) {
//         await referrerRef.update({
//           referCredit: (referrerSnap.data().referCredit || 0) + 10,
//         });
//       }
//     } catch (_) {
//       console.error("Failed to credit referrer:", pending.referredByDocId);
//     }
//   }

//   await deleteSession(sessionId);

//   const user = {
//     id: docRef.id,
//     name: pending.name,
//     mobileNo: pending.mobile,
//     isverified: true,
//     createdAt: new Date().toISOString(),
//     referCode: pending.referCode ?? "",
//     referredBy: pending.referredBy ?? null,
//     referCredit: pending.referredBy ? 5 : 0,
//     referredByMteam: pending.referredByMteamId ?? null,
//     mteamCouponCode: pending.mteamCouponCode ?? null,
//   };

//   return {
//     status: "ok",
//     user,
//     mlmProfile: await fetchMlmProfile(pending.mobile),
//   };
// });

// exports.authResendOtp = onCall(async (request) => {
//   const { sessionId, type } = request.data || {};
//   const ip = getIp(request);

//   const validTypes = ["signup", "login_verify", "forgetpin"];
//   if (!validTypes.includes(type))
//     throw new HttpsError("invalid-argument", "Invalid session type");

//   const payload = await getSession(sessionId, type);

//   // ── Rate limit check ──
//   await checkRateLimits("otp_mobile", payload.mobile, "otp_ip", ip);

//   const newOtp = generateOTP();
//   await sendOtpViaSms(payload.mobile, newOtp);

//   await db
//     .collection(COL_SESSIONS)
//     .doc(sessionId)
//     .update({
//       "payload.otp": newOtp,
//       wrongCount: 0, // reset wrong-guess counter
//       expiresAt: Date.now() + 10 * 60 * 1000, // fresh 10-min window
//     });

//   return { status: "otp_sent" };
// });

// // ─────────────────────────────────────────────────────────────────────────────
// //  5. FORGET PIN — STEP 1  (send OTP)
// //     Rate limits: otp_mobile + otp_ip
// //     Client sends: { mobile }
// //     Returns:      { status, sessionId }
// // ─────────────────────────────────────────────────────────────────────────────
// exports.authForgetPinInit = onCall(async (request) => {
//   const { mobile } = request.data || {};
//   const ip = getIp(request);

//   if (!/^[0-9]{10}$/.test(mobile))
//     throw new HttpsError(
//       "invalid-argument",
//       "Please enter a valid 10-digit mobile number",
//     );

//   // ── Rate limit check ──
//   await checkRateLimits("otp_mobile", mobile, "otp_ip", ip);

//   const snap = await db
//     .collection(COL_USERS)
//     .where("mobileNo", "==", mobile)
//     .limit(1)
//     .get();

//   if (snap.empty)
//     throw new HttpsError(
//       "not-found",
//       "No account found with this mobile number",
//     );

//   const userId = snap.docs[0].id;
//   const otp = generateOTP();

//   await sendOtpViaSms(mobile, otp);
//   await snap.docs[0].ref.update({ otp });

//   const sessionId = await createSession("forgetpin", {
//     mobile,
//     userId,
//     otp,
//     otpVerified: false,
//   });
//   return { status: "otp_sent", sessionId };
// });

// // ─────────────────────────────────────────────────────────────────────────────
// //  6. FORGET PIN — STEP 2  (verify OTP)
// //     Rate limits: 5 wrong guesses / session  |  verify_ip
// //     Client sends: { sessionId, otp }
// //     Returns:      { status: "verified", sessionId }
// // ─────────────────────────────────────────────────────────────────────────────
// exports.authForgetPinVerify = onCall(async (request) => {
//   const { sessionId, otp } = request.data || {};
//   const ip = getIp(request);

//   if (!otp || otp.length < 4)
//     throw new HttpsError("invalid-argument", "Please enter the 4-digit OTP");

//   if (ip) await checkRateLimit("verify_ip", ip);

//   const payload = await getSession(sessionId, "forgetpin");

//   if (otp !== payload.otp) {
//     await incrementOtpWrongGuess(sessionId);
//     throw new HttpsError("unauthenticated", "Incorrect OTP. Please try again.");
//   }

//   await db.collection(COL_SESSIONS).doc(sessionId).update({
//     "payload.otpVerified": true,
//   });
//   await db.collection(COL_USERS).doc(payload.userId).update({ otp: "" });

//   return { status: "verified", sessionId };
// });

// // ─────────────────────────────────────────────────────────────────────────────
// //  7. FORGET PIN — STEP 3  (set new PIN)
// //     Client sends: { sessionId, newPin }
// //     Returns:      { status: "ok" }
// // ─────────────────────────────────────────────────────────────────────────────
// exports.authForgetPinReset = onCall(async (request) => {
//   const { sessionId, newPin } = request.data || {};

//   if (!/^[0-9]{4}$/.test(newPin))
//     throw new HttpsError("invalid-argument", "PIN must be exactly 4 digits");

//   const payload = await getSession(sessionId, "forgetpin");

//   if (!payload.otpVerified)
//     throw new HttpsError(
//       "permission-denied",
//       "OTP not verified. Please complete Step 2.",
//     );

//   await db
//     .collection(COL_USERS)
//     .doc(payload.userId)
//     .update({ password: newPin });
//   await deleteSession(sessionId);

//   return { status: "ok" };
// });

// // ─────────────────────────────────────────────────────────────────────────────
// //  8. VERIFY UNVERIFIED USER  (from login flow, isverified=false)
// //     Rate limits: 5 wrong guesses / session  |  verify_ip
// //     Client sends: { sessionId, otp }
// //     Returns:      { status, user, mlmProfile }
// // ─────────────────────────────────────────────────────────────────────────────
// exports.authVerifyUser = onCall(async (request) => {
//   const { sessionId, otp } = request.data || {};
//   const ip = getIp(request);

//   if (!otp || otp.length < 4)
//     throw new HttpsError("invalid-argument", "Please enter the 4-digit OTP");

//   if (ip) await checkRateLimit("verify_ip", ip);

//   const payload = await getSession(sessionId, "login_verify");

//   if (otp !== payload.otp) {
//     await incrementOtpWrongGuess(sessionId);
//     throw new HttpsError("unauthenticated", "Incorrect OTP. Please try again.");
//   }

//   const userRef = db.collection(COL_USERS).doc(payload.userId);
//   const userSnap = await userRef.get();
//   if (!userSnap.exists) throw new HttpsError("not-found", "User not found");

//   await userRef.update({ isverified: true, otp: "" });
//   await deleteSession(sessionId);

//   const d = userSnap.data();
//   const user = {
//     id: payload.userId,
//     name: d.name,
//     mobileNo: d.mobileNo,
//     isverified: true,
//     createdAt: d.createdAt?.toDate?.()?.toISOString() ?? "",
//     referCode: d.referCode ?? "",
//     referredBy: d.referredBy ?? null,
//     referCredit: d.referCredit ?? 0,
//     referredByMteam: d.referredByMteam ?? null,
//     mteamCouponCode: d.mteamCouponCode ?? null,
//   };

//   return { status: "ok", user, mlmProfile: await fetchMlmProfile(d.mobileNo) };
// });

// // ─────────────────────────────────────────────────────────────────────────────
// //  9. CHANGE PIN  (profile page — user must know current PIN)
// //     Rate limits: 5 attempts / 15 min per mobile  |  10 / 15 min per IP
// //     Client sends: { mobile, oldPin, newPin }
// //     Returns:      { status: "ok" }
// // ─────────────────────────────────────────────────────────────────────────────
// exports.authChangePin = onCall(async (request) => {
//   const { mobile, oldPin, newPin } = request.data || {};
//   const ip = getIp(request);

//   if (!/^[0-9]{10}$/.test(mobile))
//     throw new HttpsError("invalid-argument", "Invalid mobile number");
//   if (!/^[0-9]{4}$/.test(oldPin))
//     throw new HttpsError("invalid-argument", "Current PIN must be 4 digits");
//   if (!/^[0-9]{4}$/.test(newPin))
//     throw new HttpsError("invalid-argument", "New PIN must be 4 digits");
//   if (oldPin === newPin)
//     throw new HttpsError(
//       "invalid-argument",
//       "New PIN must be different from your current PIN",
//     );

//   // ── Rate limit check ──
//   await checkRateLimits("changepin_mobile", mobile, "changepin_ip", ip);

//   const snap = await db
//     .collection(COL_USERS)
//     .where("mobileNo", "==", mobile)
//     .limit(1)
//     .get();

//   if (snap.empty)
//     throw new HttpsError("not-found", "User not found. Please login again.");

//   const userDoc = snap.docs[0];
//   const userData = userDoc.data();

//   // Verify current PIN server-side — never sent back to client
//   if (userData.password !== oldPin)
//     throw new HttpsError(
//       "unauthenticated",
//       "Current PIN is incorrect. Please try again.",
//     );

//   await userDoc.ref.update({ password: newPin });

//   return { status: "ok" };
// });

// // ─────────────────────────────────────────────────────────────────────────────
// //  10. DELETE ACCOUNT  (profile page — PIN required, most destructive action)
// //      Rate limits: 3 attempts / 30 min per mobile  |  6 / 30 min per IP
// //      Client sends: { mobile, pin }
// //      Returns:      { status: "ok" }
// // ─────────────────────────────────────────────────────────────────────────────
// exports.authDeleteAccount = onCall(async (request) => {
//   const { mobile, pin } = request.data || {};
//   const ip = getIp(request);

//   if (!/^[0-9]{10}$/.test(mobile))
//     throw new HttpsError("invalid-argument", "Invalid mobile number");
//   if (!/^[0-9]{4}$/.test(pin))
//     throw new HttpsError("invalid-argument", "PIN must be 4 digits");

//   // ── Rate limit check (strictest in the system) ──
//   await checkRateLimits("deleteacc_mobile", mobile, "deleteacc_ip", ip);

//   const snap = await db
//     .collection(COL_USERS)
//     .where("mobileNo", "==", mobile)
//     .limit(1)
//     .get();

//   if (snap.empty)
//     throw new HttpsError("not-found", "User not found. Please login again.");

//   const userDoc = snap.docs[0];
//   const userData = userDoc.data();

//   // Verify PIN server-side
//   if (userData.password !== pin)
//     throw new HttpsError(
//       "unauthenticated",
//       "Incorrect PIN. Account not deleted.",
//     );

//   // Delete user document
//   await userDoc.ref.delete();

//   // Delete MLM profile (non-fatal if missing)
//   try {
//     const profileSnap = await db
//       .collection(COL_MLMPROFILES)
//       .where("mobile", "==", mobile)
//       .limit(1)
//       .get();

//     if (!profileSnap.empty) {
//       await profileSnap.docs[0].ref.delete();
//     }
//   } catch (_) {
//     console.error("Failed to delete MLM profile for:", mobile);
//   }

//   // Clean up any active sessions for this user
//   try {
//     const sessionSnap = await db
//       .collection(COL_SESSIONS)
//       .where("payload.mobile", "==", mobile)
//       .get();
//     const batch = db.batch();
//     sessionSnap.docs.forEach((d) => batch.delete(d.ref));
//     await batch.commit();
//   } catch (_) {}

//   return { status: "ok" };
// });



"use strict";

const { onCall: _onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const TWOFACTOR_API_KEY = defineSecret("TWOFACTOR_API_KEY");

const onCall = (handler) =>
  _onCall({ region: "us-central1", secrets: [TWOFACTOR_API_KEY] }, handler);

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const axios = require("axios");
const crypto = require("crypto");

initializeApp();
const db = getFirestore();

const COL_USERS = process.env.COL_USERS || "users";
const COL_MLMPROFILES = process.env.COL_MLMPROFILES || "mlmprofiles";
const COL_MTEAM = process.env.COL_MTEAM || "mteam";
const COL_COUPONCODE = process.env.COL_COUPONCODE || "couponcode";
const COL_SESSIONS = "_authSessions"; 
const COL_RATE = "_rateLimits"; 

const LIMITS = {
  otp_mobile: { max: 3, windowMs: 10 * 60 * 1000 },
  otp_ip: { max: 8, windowMs: 10 * 60 * 1000 },
  login_mobile: { max: 10, windowMs: 15 * 60 * 1000 },
  login_ip: { max: 25, windowMs: 15 * 60 * 1000 },
  verify_ip: { max: 20, windowMs: 10 * 60 * 1000 },
  changepin_mobile: { max: 5, windowMs: 15 * 60 * 1000 },
  changepin_ip: { max: 10, windowMs: 15 * 60 * 1000 },
  deleteacc_mobile: { max: 3, windowMs: 30 * 60 * 1000 },
  deleteacc_ip: { max: 6, windowMs: 30 * 60 * 1000 },
};

// ─── Rate-limit helpers ───────────────────────────────────────────────────────

async function checkRateLimit(bucket, key) {
  const policy = LIMITS[bucket];
  if (!policy) return;

  const docId = `${bucket}:${key}`;
  const ref = db.collection(COL_RATE).doc(docId);
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      tx.set(ref, {
        bucket,
        key,
        count: 1,
        windowStart: now,
        expiresAt: now + policy.windowMs,
      });
      return;
    }

    const data = snap.data();

    if (now - data.windowStart >= policy.windowMs) {
      tx.set(ref, {
        bucket,
        key,
        count: 1,
        windowStart: now,
        expiresAt: now + policy.windowMs,
      });
      return;
    }

    if (data.count >= policy.max) {
      const retryAfterSec = Math.ceil(
        (data.windowStart + policy.windowMs - now) / 1000,
      );
      throw new HttpsError(
        "resource-exhausted",
        `Too many attempts. Please try again in ${retryAfterSec} second${retryAfterSec === 1 ? "" : "s"}.`,
      );
    }

    tx.update(ref, { count: data.count + 1 });
  });
}

async function checkRateLimits(mobileBucket, mobile, ipBucket, ip) {
  await Promise.all([
    checkRateLimit(mobileBucket, mobile),
    ip ? checkRateLimit(ipBucket, ip) : Promise.resolve(),
  ]);
}

function getIp(request) {
  return (
    request?.rawRequest?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    request?.rawRequest?.ip ||
    null
  );
}

// ─── OTP wrong-guess limiter ──────────────────────────────────────────────────

const MAX_OTP_WRONG_GUESSES = 5;

async function incrementOtpWrongGuess(sessionId) {
  const ref = db.collection(COL_SESSIONS).doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) return;

  const wrong = (snap.data().wrongCount || 0) + 1;
  if (wrong >= MAX_OTP_WRONG_GUESSES) {
    await ref.delete();
    throw new HttpsError(
      "resource-exhausted",
      "Too many incorrect OTP attempts. Please start over.",
    );
  }
  await ref.update({ wrongCount: wrong });
}

// ─── General helpers ──────────────────────────────────────────────────────────

function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}
function generateSessionId() {
  return crypto.randomBytes(24).toString("hex");
}

function generateReferCode(mobile) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const rand = Array.from(
    { length: 4 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
  return rand + mobile.slice(-4);
}

async function sendOtpViaSms(mobile, otp) {
  const apiKey = TWOFACTOR_API_KEY.value();
  if (!apiKey) throw new Error("TWOFACTOR_API_KEY not configured");
  await axios.get(
    `https://2factor.in/API/V1/${apiKey}/SMS/+91${mobile}/${otp}/OTP`,
    { timeout: 10000 },
  );
}

async function fetchMlmProfile(mobile) {
  const snap = await db
    .collection(COL_MLMPROFILES)
    .where("mobile", "==", mobile)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

// ─── Session helpers ──────────────────────────────────────────────────────────

async function createSession(type, payload) {
  const sessionId = generateSessionId();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  await db.collection(COL_SESSIONS).doc(sessionId).set({
    type,
    payload,
    expiresAt,
    createdAt: Date.now(),
    wrongCount: 0,
  });
  return sessionId;
}

async function getSession(sessionId, expectedType) {
  if (!sessionId)
    throw new HttpsError("invalid-argument", "Session ID missing");

  const snap = await db.collection(COL_SESSIONS).doc(sessionId).get();
  if (!snap.exists)
    throw new HttpsError(
      "not-found",
      "Session expired or invalid. Please start again.",
    );

  const data = snap.data();
  if (data.type !== expectedType)
    throw new HttpsError("invalid-argument", "Session type mismatch");
  if (data.expiresAt < Date.now())
    throw new HttpsError(
      "deadline-exceeded",
      "Session expired. Please start again.",
    );

  return data.payload;
}

async function deleteSession(sessionId) {
  await db.collection(COL_SESSIONS).doc(sessionId).delete();
}

// ─── Firebase Auth helper — lazy-create user + issue custom token ─────────────

async function issueCustomToken(mobile, displayName) {
  const uid = `mobile_${mobile}`;
  try {
    await getAuth().getUser(uid);
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      await getAuth().createUser({ uid, displayName: displayName || mobile });
    } else {
      throw e;
    }
  }
  return getAuth().createCustomToken(uid, { mobile });
}

exports.authLogin = onCall(async (request) => {
  const { mobile, pin } = request.data || {};
  const ip = getIp(request);

  if (!/^[0-9]{10}$/.test(mobile))
    throw new HttpsError(
      "invalid-argument",
      "Please enter a valid 10-digit mobile number",
    );
  if (!/^[0-9]{4}$/.test(pin))
    throw new HttpsError(
      "invalid-argument",
      "Please enter a valid 4-digit PIN",
    );

  await checkRateLimits("login_mobile", mobile, "login_ip", ip);

  const snap = await db
    .collection(COL_USERS)
    .where("mobileNo", "==", mobile)
    .limit(1)
    .get();

  if (snap.empty)
    throw new HttpsError(
      "not-found",
      "No account found with this mobile number",
    );

  const userDoc = snap.docs[0];
  const userData = userDoc.data();

  if (!userData.isverified) {
    await checkRateLimits("otp_mobile", mobile, "otp_ip", ip);
    const otp = generateOTP();
    await sendOtpViaSms(mobile, otp);
    await userDoc.ref.update({ otp });
    const sessionId = await createSession("login_verify", {
      userId: userDoc.id,
      mobile: userData.mobileNo,
      otp,
    });
    return {
      status: "unverified",
      sessionId,
      mobile: userData.mobileNo,
      userId: userDoc.id,
    };
  }

  if (userData.password !== pin)
    throw new HttpsError("unauthenticated", "Incorrect PIN. Please try again.");

  const user = {
    id: userDoc.id,
    name: userData.name,
    mobileNo: userData.mobileNo,
    isverified: userData.isverified,
    createdAt: userData.createdAt?.toDate?.()?.toISOString() ?? "",
    referCode: userData.referCode ?? "",
    referredBy: userData.referredBy ?? null,
    referCredit: userData.referCredit ?? 0,
    referredByMteam: userData.referredByMteam ?? null,
    mteamCouponCode: userData.mteamCouponCode ?? null,
  };

  const mlmProfile = await fetchMlmProfile(mobile);
  // Issue Firebase custom token (lazy-migrates existing users automatically)
  const customToken = await issueCustomToken(mobile, userData.name);

  return { status: "ok", user, mlmProfile, customToken };
});

// ─────────────────────────────────────────────────────────────────────────────
//  2. SIGNUP — STEP 1
// ─────────────────────────────────────────────────────────────────────────────
exports.authSignupInit = onCall(async (request) => {
  const { name, mobile, pin, referCode = "" } = request.data || {};
  const ip = getIp(request);

  if (!name || name.trim().length < 3)
    throw new HttpsError(
      "invalid-argument",
      "Name must be at least 3 characters",
    );
  if (!/^[0-9]{10}$/.test(mobile))
    throw new HttpsError(
      "invalid-argument",
      "Mobile number must be exactly 10 digits",
    );
  if (!/^[0-9]{4}$/.test(pin))
    throw new HttpsError("invalid-argument", "PIN must be exactly 4 digits");

  await checkRateLimits("otp_mobile", mobile, "otp_ip", ip);

  const verifiedSnap = await db
    .collection(COL_USERS)
    .where("mobileNo", "==", mobile)
    .where("isverified", "==", true)
    .limit(1)
    .get();
  if (!verifiedSnap.empty)
    throw new HttpsError("already-exists", "Mobile number already registered");

  const unverifiedSnap = await db
    .collection(COL_USERS)
    .where("mobileNo", "==", mobile)
    .where("isverified", "==", false)
    .get();
  const batch = db.batch();
  unverifiedSnap.docs.forEach((d) =>
    batch.update(d.ref, { mobileNo: `_deleted_${mobile}_${d.id}` }),
  );
  await batch.commit();

  let referredByDocId = null;
  let referredByMteamId = null;
  let mteamCouponCode = null;
  const trimmedRefer = referCode.trim().toUpperCase();

  if (trimmedRefer !== "") {
    if (!/^[A-Za-z0-9]{6,8}$/.test(trimmedRefer))
      throw new HttpsError("invalid-argument", "Invalid refer code format");

    const userReferSnap = await db
      .collection(COL_USERS)
      .where("referCode", "==", trimmedRefer)
      .limit(1)
      .get();

    if (!userReferSnap.empty) {
      referredByDocId = userReferSnap.docs[0].id;
    } else {
      const mteamSnap = await db
        .collection(COL_MTEAM)
        .where("referCode", "==", trimmedRefer)
        .limit(1)
        .get();
      if (!mteamSnap.empty) {
        const mteamDoc = mteamSnap.docs[0];
        referredByMteamId = mteamDoc.id;
        const couponId = mteamDoc.data().assign_coupon_id;
        if (couponId) {
          const couponSnap = await db
            .collection(COL_COUPONCODE)
            .doc(couponId)
            .get();
          if (couponSnap.exists && couponSnap.data().active) {
            mteamCouponCode = couponSnap.data().code || null;
          }
        }
      } else {
        throw new HttpsError("not-found", "Refer code not found");
      }
    }
  }

  const otp = generateOTP();
  const referCode2 = generateReferCode(mobile);
  await sendOtpViaSms(mobile, otp);

  const sessionId = await createSession("signup", {
    name: name.trim(),
    mobile,
    pin,
    otp,
    referCode: referCode2,
    referredBy: trimmedRefer || null,
    referredByDocId: referredByDocId || null,
    referredByMteamId: referredByMteamId || null,
    mteamCouponCode: mteamCouponCode || null,
  });

  return { status: "otp_sent", sessionId };
});

// ─────────────────────────────────────────────────────────────────────────────
//  3. SIGNUP — STEP 2
// ─────────────────────────────────────────────────────────────────────────────
exports.authSignupVerify = onCall(async (request) => {
  const { sessionId, otp } = request.data || {};
  const ip = getIp(request);

  if (!otp || otp.length < 4)
    throw new HttpsError("invalid-argument", "Please enter the 4-digit OTP");

  if (ip) await checkRateLimit("verify_ip", ip);

  const pending = await getSession(sessionId, "signup");

  if (otp !== pending.otp) {
    await incrementOtpWrongGuess(sessionId);
    throw new HttpsError("unauthenticated", "Incorrect OTP. Please try again.");
  }

  const finalCheck = await db
    .collection(COL_USERS)
    .where("mobileNo", "==", pending.mobile)
    .where("isverified", "==", true)
    .limit(1)
    .get();
  if (!finalCheck.empty)
    throw new HttpsError(
      "already-exists",
      "Mobile number was just registered by someone else.",
    );

  const docRef = await db.collection(COL_USERS).add({
    name: pending.name,
    mobileNo: pending.mobile,
    password: pending.pin,
    createdAt: new Date(),
    isverified: true,
    otp: "",
    referCode: pending.referCode,
    referredBy: pending.referredBy,
    referredByMteam: pending.referredByMteamId || null,
    mteamCouponCode: pending.mteamCouponCode || null,
    referCredit: pending.referredBy ? 5 : 0,
  });

  if (pending.referredByDocId) {
    try {
      const referrerRef = db.collection(COL_USERS).doc(pending.referredByDocId);
      const referrerSnap = await referrerRef.get();
      if (referrerSnap.exists) {
        await referrerRef.update({
          referCredit: (referrerSnap.data().referCredit || 0) + 10,
        });
      }
    } catch (_) {
      console.error("Failed to credit referrer:", pending.referredByDocId);
    }
  }

  await deleteSession(sessionId);

  const user = {
    id: docRef.id,
    name: pending.name,
    mobileNo: pending.mobile,
    isverified: true,
    createdAt: new Date().toISOString(),
    referCode: pending.referCode ?? "",
    referredBy: pending.referredBy ?? null,
    referCredit: pending.referredBy ? 5 : 0,
    referredByMteam: pending.referredByMteamId ?? null,
    mteamCouponCode: pending.mteamCouponCode ?? null,
  };

  // Create Firebase Auth user and issue custom token
  const customToken = await issueCustomToken(pending.mobile, pending.name);

  return {
    status: "ok",
    user,
    mlmProfile: await fetchMlmProfile(pending.mobile),
    customToken,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
//  4. RESEND OTP
// ─────────────────────────────────────────────────────────────────────────────
exports.authResendOtp = onCall(async (request) => {
  const { sessionId, type } = request.data || {};
  const ip = getIp(request);

  const validTypes = ["signup", "login_verify", "forgetpin"];
  if (!validTypes.includes(type))
    throw new HttpsError("invalid-argument", "Invalid session type");

  const payload = await getSession(sessionId, type);
  await checkRateLimits("otp_mobile", payload.mobile, "otp_ip", ip);

  const newOtp = generateOTP();
  await sendOtpViaSms(payload.mobile, newOtp);
  await db
    .collection(COL_SESSIONS)
    .doc(sessionId)
    .update({
      "payload.otp": newOtp,
      wrongCount: 0,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

  return { status: "otp_sent" };
});

// ─────────────────────────────────────────────────────────────────────────────
//  5. FORGET PIN — STEP 1
// ─────────────────────────────────────────────────────────────────────────────
exports.authForgetPinInit = onCall(async (request) => {
  const { mobile } = request.data || {};
  const ip = getIp(request);

  if (!/^[0-9]{10}$/.test(mobile))
    throw new HttpsError(
      "invalid-argument",
      "Please enter a valid 10-digit mobile number",
    );

  await checkRateLimits("otp_mobile", mobile, "otp_ip", ip);

  const snap = await db
    .collection(COL_USERS)
    .where("mobileNo", "==", mobile)
    .limit(1)
    .get();
  if (snap.empty)
    throw new HttpsError(
      "not-found",
      "No account found with this mobile number",
    );

  const userId = snap.docs[0].id;
  const otp = generateOTP();
  await sendOtpViaSms(mobile, otp);
  await snap.docs[0].ref.update({ otp });

  const sessionId = await createSession("forgetpin", {
    mobile,
    userId,
    otp,
    otpVerified: false,
  });
  return { status: "otp_sent", sessionId };
});

// ─────────────────────────────────────────────────────────────────────────────
//  6. FORGET PIN — STEP 2
// ─────────────────────────────────────────────────────────────────────────────
exports.authForgetPinVerify = onCall(async (request) => {
  const { sessionId, otp } = request.data || {};
  const ip = getIp(request);

  if (!otp || otp.length < 4)
    throw new HttpsError("invalid-argument", "Please enter the 4-digit OTP");

  if (ip) await checkRateLimit("verify_ip", ip);

  const payload = await getSession(sessionId, "forgetpin");

  if (otp !== payload.otp) {
    await incrementOtpWrongGuess(sessionId);
    throw new HttpsError("unauthenticated", "Incorrect OTP. Please try again.");
  }

  await db
    .collection(COL_SESSIONS)
    .doc(sessionId)
    .update({ "payload.otpVerified": true });
  await db.collection(COL_USERS).doc(payload.userId).update({ otp: "" });

  return { status: "verified", sessionId };
});

// ─────────────────────────────────────────────────────────────────────────────
//  7. FORGET PIN — STEP 3
// ─────────────────────────────────────────────────────────────────────────────
exports.authForgetPinReset = onCall(async (request) => {
  const { sessionId, newPin } = request.data || {};

  if (!/^[0-9]{4}$/.test(newPin))
    throw new HttpsError("invalid-argument", "PIN must be exactly 4 digits");

  const payload = await getSession(sessionId, "forgetpin");
  if (!payload.otpVerified)
    throw new HttpsError(
      "permission-denied",
      "OTP not verified. Please complete Step 2.",
    );

  await db
    .collection(COL_USERS)
    .doc(payload.userId)
    .update({ password: newPin });
  await deleteSession(sessionId);

  return { status: "ok" };
});

// ─────────────────────────────────────────────────────────────────────────────
//  8. VERIFY UNVERIFIED USER
// ─────────────────────────────────────────────────────────────────────────────
exports.authVerifyUser = onCall(async (request) => {
  const { sessionId, otp } = request.data || {};
  const ip = getIp(request);

  if (!otp || otp.length < 4)
    throw new HttpsError("invalid-argument", "Please enter the 4-digit OTP");

  if (ip) await checkRateLimit("verify_ip", ip);

  const payload = await getSession(sessionId, "login_verify");

  if (otp !== payload.otp) {
    await incrementOtpWrongGuess(sessionId);
    throw new HttpsError("unauthenticated", "Incorrect OTP. Please try again.");
  }

  const userRef = db.collection(COL_USERS).doc(payload.userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found");

  await userRef.update({ isverified: true, otp: "" });
  await deleteSession(sessionId);

  const d = userSnap.data();
  const user = {
    id: payload.userId,
    name: d.name,
    mobileNo: d.mobileNo,
    isverified: true,
    createdAt: d.createdAt?.toDate?.()?.toISOString() ?? "",
    referCode: d.referCode ?? "",
    referredBy: d.referredBy ?? null,
    referCredit: d.referCredit ?? 0,
    referredByMteam: d.referredByMteam ?? null,
    mteamCouponCode: d.mteamCouponCode ?? null,
  };

  // Issue custom token so this user gets a Firebase Auth session too
  const customToken = await issueCustomToken(d.mobileNo, d.name);

  return {
    status: "ok",
    user,
    mlmProfile: await fetchMlmProfile(d.mobileNo),
    customToken,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
//  9. CHANGE PIN
// ─────────────────────────────────────────────────────────────────────────────
exports.authChangePin = onCall(async (request) => {
  const { mobile, oldPin, newPin } = request.data || {};
  const ip = getIp(request);

  if (!/^[0-9]{10}$/.test(mobile))
    throw new HttpsError("invalid-argument", "Invalid mobile number");
  if (!/^[0-9]{4}$/.test(oldPin))
    throw new HttpsError("invalid-argument", "Current PIN must be 4 digits");
  if (!/^[0-9]{4}$/.test(newPin))
    throw new HttpsError("invalid-argument", "New PIN must be 4 digits");
  if (oldPin === newPin)
    throw new HttpsError(
      "invalid-argument",
      "New PIN must be different from your current PIN",
    );

  await checkRateLimits("changepin_mobile", mobile, "changepin_ip", ip);

  const snap = await db
    .collection(COL_USERS)
    .where("mobileNo", "==", mobile)
    .limit(1)
    .get();
  if (snap.empty)
    throw new HttpsError("not-found", "User not found. Please login again.");

  const userDoc = snap.docs[0];
  const userData = userDoc.data();

  if (userData.password !== oldPin)
    throw new HttpsError(
      "unauthenticated",
      "Current PIN is incorrect. Please try again.",
    );

  await userDoc.ref.update({ password: newPin });
  return { status: "ok" };
});

// ─────────────────────────────────────────────────────────────────────────────
//  10. DELETE ACCOUNT
// ─────────────────────────────────────────────────────────────────────────────
exports.authDeleteAccount = onCall(async (request) => {
  const { mobile, pin } = request.data || {};
  const ip = getIp(request);

  if (!/^[0-9]{10}$/.test(mobile))
    throw new HttpsError("invalid-argument", "Invalid mobile number");
  if (!/^[0-9]{4}$/.test(pin))
    throw new HttpsError("invalid-argument", "PIN must be 4 digits");

  await checkRateLimits("deleteacc_mobile", mobile, "deleteacc_ip", ip);

  const snap = await db
    .collection(COL_USERS)
    .where("mobileNo", "==", mobile)
    .limit(1)
    .get();
  if (snap.empty)
    throw new HttpsError("not-found", "User not found. Please login again.");

  const userDoc = snap.docs[0];
  const userData = userDoc.data();

  if (userData.password !== pin)
    throw new HttpsError(
      "unauthenticated",
      "Incorrect PIN. Account not deleted.",
    );

  await userDoc.ref.delete();

  // Also delete from Firebase Auth
  try {
    await getAuth().deleteUser(`mobile_${mobile}`);
  } catch (_) {}

  try {
    const profileSnap = await db
      .collection(COL_MLMPROFILES)
      .where("mobile", "==", mobile)
      .limit(1)
      .get();
    if (!profileSnap.empty) await profileSnap.docs[0].ref.delete();
  } catch (_) {
    console.error("Failed to delete MLM profile for:", mobile);
  }

  try {
    const sessionSnap = await db
      .collection(COL_SESSIONS)
      .where("payload.mobile", "==", mobile)
      .get();
    const batch = db.batch();
    sessionSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch (_) {}

  return { status: "ok" };
});
