const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const axios = require("axios");
const { URL } = require("url"); 
require("dotenv").config();
const path = require("path");
const fs = require("fs");

const serviceAccountPath = path.join(__dirname, "gymvisa.json");
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
  console.error("Error initializing Firebase Admin SDK:", error);
  process.exit(1);
}

const db = admin.firestore();
const app = express();
app.use(bodyParser.json());

module.exports = async (req, res) => {
  try {
    console.log("IPN Listener invoked");

    // Ensure request is POST (as per documentation)
    if (req.method !== "POST") {
      console.error("Invalid request method");
      return res.status(405).send("Method Not Allowed");
    }

    // Extract URL from the body (since it's a POST request)
    const listenerUrl = req.body.url;
    if (!listenerUrl) {
      console.error("Missing `url` parameter in request body");
      return res.status(400).send("Missing `url` parameter");
    }

    console.log("Received URL:", listenerUrl);

    // Parse the URL correctly
    const parsedUrl = new URL(listenerUrl);
    const pathSegments = parsedUrl.pathname.split("/");

    if (pathSegments.length < 5) {
      console.error("Invalid URL format");
      return res.status(400).send("Invalid URL format");
    }

    const MerchantId = pathSegments[pathSegments.length - 3]; // Dynamically extracting last three values
    const StoreId = pathSegments[pathSegments.length - 2];
    const TransactionReferenceNumber = pathSegments[pathSegments.length - 1];

    console.log(`MerchantId: ${MerchantId}`);
    console.log(`StoreId: ${StoreId}`);
    console.log(`TransactionReferenceNumber: ${TransactionReferenceNumber}`);

    if (!MerchantId || !StoreId || !TransactionReferenceNumber) {
      console.error("Missing MerchantId, StoreId, or TransactionReferenceNumber");
      return res.status(400).send("Invalid URL format");
    }

    if (MerchantId !== process.env.MERCHANT_ID || StoreId !== process.env.STORE_ID) {
      console.error("Invalid MerchantId or StoreId");
      return res.status(400).send("Invalid Merchant or Store ID");
    }

    // Fetch transaction status
    const transactionResponse = await axios.get(listenerUrl);

    if (!transactionResponse.data) {
      console.error("Empty response from transaction status URL");
      return res.status(400).send("Failed to retrieve transaction details");
    }

    const transactionData = transactionResponse.data; // No need for JSON.parse

    console.log("Transaction Data:", transactionData);

    // Firestore reference
    const transactionRef = db.collection("Transactions").doc(TransactionReferenceNumber);
    const transactionSnapshot = await transactionRef.get();

    if (!transactionSnapshot.exists) {
      console.error(`Transaction ${TransactionReferenceNumber} not found`);
      return res.status(404).send("Transaction not found");
    }

    // Update transaction status
    await transactionRef.update({
      Status: transactionData.TransactionStatus,
      UpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      transactionId: transactionData.TransactionId,
    });

    console.log(`Transaction ${TransactionReferenceNumber} updated successfully`);
    res.status(200).send("IPN Processed Successfully");

  } catch (error) {
    console.error("Error processing IPN:", error);
    res.status(500).send("Internal Server Error");
  }
};
