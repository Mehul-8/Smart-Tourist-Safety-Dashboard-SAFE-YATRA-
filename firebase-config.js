// firebase-config.js — Smart Tourist Safety Dashboard
// -----------------------------------------------------------------------
// Fill in your Firebase project credentials below (Project settings →
// General → Your apps → SDK setup and configuration).
//
// FOR ADMIN LOGIN:
// 1. In Firebase Console, go to Authentication → Sign-in method.
// 2. Enable "Email/Password" provider.
// 3. In the "Users" tab, click "Add user" and create your Admin email & password.
// -----------------------------------------------------------------------

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

/*
  EXPECTED FIRESTORE SCHEMA
  --------------------------------------------------------------------
  tourists/{touristId}
    name              string
    touristId         string   ("TID175825...")
    phone             string
    emergencyContact  string
    riskScore         number   (0-100)
    riskLevel         string   ("LOW" | "MEDIUM" | "HIGH")
    riskCode          string   ("RSK-H82")
    riskFactors       array<string>
    latitude          number
    longitude         number
    accuracy          number   (meters)
    zoneId            string
    zoneName          string
    zoneRiskLevel     string
    insideZone        boolean
    status            string   ("Safe" | "Warning" | "Emergency")
    lastUpdated       Timestamp
    riskHistory       array<{ score:number, at:Timestamp }>   // for "recently increased" logic

  alerts/{alertId}
    touristId         string
    touristName       string
    riskAtAlert       number
    latitude          number
    longitude         number
    status            string   ("active" | "acknowledged" | "resolved")
    createdAt         Timestamp
    acknowledgedAt    Timestamp | null
    resolvedAt        Timestamp | null

  zones/{zoneId}
    name              string
    type              string   ("Tourist Hub" | "Safe Haven" | "Restricted Area" | ...)
    riskLevel         string   ("LOW" | "MEDIUM" | "HIGH")
    radiusMeters      number
    latitude          number | null
    longitude         number | null
    active            boolean
    touristsInside    number
    description       string
    createdAt         Timestamp
  --------------------------------------------------------------------
*/