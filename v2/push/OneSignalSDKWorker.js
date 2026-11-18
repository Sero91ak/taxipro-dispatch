/* TaxiPro OneSignal push worker only (isolated /v2/push/ scope).
 * The main existing /v2/sw.js continues to manage PWA offline assets.
 * This file contains NO API key, patient data, or employee IDs. */
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
