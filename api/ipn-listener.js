const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const { URL } = require("url"); 
const serverless = require("serverless-http"); 
require("dotenv").config();
const path = require("path");
const fs = require("fs");

const serviceAccountPath = path.join(
  __dirname,
  "gymvisa.json"
);
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
    const listenerUrl = req.query.url;

    if (!listenerUrl) {
      console.error("Missing `url` parameter");
      return res.status(400).send("Missing `url` parameter");
    }

    console.log("Received URL:", listenerUrl);

    const parsedUrl = new URL(listenerUrl);
    const pathSegments = parsedUrl.pathname.split("/");

    console.log(pathSegments);

    const MerchantId = pathSegments[5];
    const StoreId = pathSegments[6];
    const TransactionReferenceNumber = pathSegments[7];

    console.log(`MerchantId: ${MerchantId}`);
    console.log(`StoreId: ${StoreId}`);
    console.log(`TransactionReferenceNumber: ${TransactionReferenceNumber}`);

    if (
      MerchantId !== process.env.MERCHANT_ID ||
      StoreId !== process.env.STORE_ID
    ) {
      console.error("Invalid MerchantId or StoreId");
      return res.status(400).send("Invalid Merchant or Store ID");
    }

    const axios = require("axios");
    const transactionResponse = await axios.get(listenerUrl);

    if (!transactionResponse.data) {
      console.error("Empty response from transaction status URL");
      return res.status(400).send("Failed to retrieve transaction details");
    }

    const transactionData = JSON.parse(transactionResponse.data);
    console.log("Transaction Data:", transactionData);

    const transactionRef = db
      .collection("Transactions")
      .doc(TransactionReferenceNumber);

    const transactionSnapshot = await transactionRef.get();
    if (!transactionSnapshot.exists) {
      console.error(`Transaction ${TransactionReferenceNumber} not found`);
      return res.status(404).send("Transaction not found");
    }

    await transactionRef.update({
      Status: transactionData.TransactionStatus,
      UpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      transactionId: transactionData.TransactionId,
    });

    console.log(
      `Transaction ${TransactionReferenceNumber} updated successfully`
    );

    res.status(200).send("IPN Processed Successfully");
  } catch (error) {
    console.error("Error processing IPN:", error);
    res.status(500).send("Internal Server Error");
  }
};