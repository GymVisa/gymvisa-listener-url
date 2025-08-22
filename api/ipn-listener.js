const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const axios = require('axios'); // Move axios import to top
const { URL } = require('url');
require('dotenv').config();
const generatePlan = require('./planGeneraton');

// Add error handling for environment variables
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('FIREBASE_SERVICE_ACCOUNT environment variable is required');
  process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Initialize Firebase Admin SDK with error handling
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} catch (error) {
  console.error('Failed to initialize Firebase:', error);
  process.exit(1);
}

const db = admin.firestore();

const app = express();
app.use(bodyParser.json()); 

app.get('/api/ipn-listener', async (req, res) => {
  try {
    const listenerUrl = req.query.url;

    if (!listenerUrl) {
      console.error('Missing ⁠ url ⁠ parameter');
      return res.status(400).send('Missing ⁠ url ⁠ parameter');
    }

    console.log('Received URL:', listenerUrl);

    const parsedUrl = new URL(listenerUrl);
    const pathSegments = parsedUrl.pathname.split('/');

    console.log(pathSegments);

    const MerchantId = pathSegments[5];
    const StoreId = pathSegments[6];
    const TransactionReferenceNumber = pathSegments[7];

    console.log(`MerchantId: ${MerchantId}`);
    console.log(`StoreId: ${StoreId}`);
    console.log(`TransactionReferenceNumber: ${TransactionReferenceNumber}`);

    if (MerchantId !== process.env.MERCHANT_ID || StoreId !== process.env.STORE_ID) {
      console.error('Invalid MerchantId or StoreId');
      return res.status(400).send('Invalid Merchant or Store ID');
    }

    const axios = require('axios');
    const transactionResponse = await axios.get(listenerUrl);

    if (!transactionResponse.data) {
      console.error('Empty response from transaction status URL');
      return res.status(400).send('Failed to retrieve transaction details');
    }

    const transactionData = JSON.parse(transactionResponse.data);
    console.log('Transaction Data:', transactionData);

    const transactionRef = db.collection('Transactions').doc(TransactionReferenceNumber);
    const transactionSnapshot = await transactionRef.get();

    if (!transactionSnapshot.exists) {
      console.error(`Transaction ${TransactionReferenceNumber} not found`);
      return res.status(404).send('Transaction not found');
    }

    const transactionDoc = transactionSnapshot.data();
    await transactionRef.update({
      Status: transactionData.TransactionStatus,
      UpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      transactionId: transactionData.TransactionId
    });

    console.log(`Transaction ${TransactionReferenceNumber} updated successfully`);

    if (transactionData.TransactionStatus === 'Paid') {
      const userId = transactionDoc.UserId; 
      const subscriptionPlan = transactionDoc.Subscription; 

      if (!userId || !subscriptionPlan) {
        console.error(`Missing UserId or Subscription in Transaction ${TransactionReferenceNumber}`);
        return res.status(400).send('Transaction data is incomplete');
      }

 
        if (subscriptionPlan === 'Credits') {
          // --- PURCHASE CREDITS LOGIC ---
          const creditsToAdd = transactionDoc.Credits || 0;
          if (!creditsToAdd || creditsToAdd <= 0) {
            console.error(`No credits to add for Transaction ${TransactionReferenceNumber}`);
            return res.status(400).send('No credits to add');
          }

          const userRef = db.collection('User').doc(userId);
          await db.runTransaction(async (t) => {
            const userSnap = await t.get(userRef);
            if (!userSnap.exists) throw new Error('User not found');
            const userData = userSnap.data();
            const currentCredits = userData.credits || 0;
            t.update(userRef, { credits: currentCredits + creditsToAdd });
          });

          console.log(`Added ${creditsToAdd} credits to user ${userId}`);
        } else {
          // --- SUBSCRIPTION LOGIC ---
          const userRef = db.collection('User').doc(userId);

          const now = new Date();
          const subscriptionStartDate = admin.firestore.Timestamp.fromDate(now);
          const subscriptionEndDate = admin.firestore.Timestamp.fromDate(new Date(now.setDate(now.getDate() + 20)));

          await userRef.update({
            Subscription: subscriptionPlan,
            SubscriptionStartDate: subscriptionStartDate,
            SubscriptionEndDate: subscriptionEndDate
          });

          console.log(`User ${userId} subscription updated successfully`);
        }
    }

    res.status(200).send('IPN Processed Successfully');
  } catch (error) {
    console.error('Error processing IPN:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.use('/', generatePlan);

// Add graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`IPN Listener running on port ${PORT}`);
});
