const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const { URL } = require('url');
require('dotenv').config();
const axios = require('axios');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const app = express();
app.use(bodyParser.json());

app.post('/api/ipn-listener', async (req, res) => {
  try {
    const listenerUrl = req.query.url;

    if (!listenerUrl) {
      console.error('Missing `url` parameter');
      return res.status(400).send('Missing `url` parameter');
    }

    console.log('Received URL:', listenerUrl);

    const parsedUrl = new URL(listenerUrl);
    const pathSegments = parsedUrl.pathname.split('/');
    
    const MerchantId = pathSegments[pathSegments.length - 3];
    const StoreId = pathSegments[pathSegments.length - 2];
    const TransactionReferenceNumber = pathSegments[pathSegments.length - 1];

    console.log(`MerchantId: ${MerchantId}`);
    console.log(`StoreId: ${StoreId}`);
    console.log(`TransactionReferenceNumber: ${TransactionReferenceNumber}`);

    if (MerchantId !== process.env.MERCHANT_ID || StoreId !== process.env.STORE_ID) {
      console.error('Invalid MerchantId or StoreId');
      return res.status(400).send('Invalid Merchant or Store ID');
    }

    const transactionResponse = await axios.get(listenerUrl);

    if (!transactionResponse.data) {
      console.error('Empty response from transaction status URL');
      return res.status(400).send('Failed to retrieve transaction details');
    }

    const transactionData = transactionResponse.data;
    console.log('Transaction Data:', transactionData);

    const transactionRef = db.collection('Transactions').doc(TransactionReferenceNumber);
    const transactionSnapshot = await transactionRef.get();

    if (!transactionSnapshot.exists) {
      console.error(`Transaction ${TransactionReferenceNumber} not found`);
      return res.status(404).send('Transaction not found');
    }

    const transactionDoc = transactionSnapshot.data();

    await transactionRef.update({
      Status: transactionData.TransactionStatus || "Unknown",
      UpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      transactionId: transactionData.TransactionId || "N/A"
    });
    

    console.log(`Transaction ${TransactionReferenceNumber} updated successfully`);

    if (transactionData.TransactionStatus === 'Paid' || transactionData.TransactionStatus === 'Initiated') {
      const userId = transactionDoc.UserId;
      const subscriptionPlan = transactionDoc.Subscription;

      if (!userId || !subscriptionPlan) {
        console.error(`Missing UserId or Subscription in Transaction ${TransactionReferenceNumber}`);
        return res.status(400).send('Transaction data is incomplete');
      }

      const userRef = db.collection('User').doc(userId);

      // Calculate subscription dates
      const now = new Date();
      const subscriptionStartDate = admin.firestore.Timestamp.fromDate(now);
      const subscriptionEndDate = admin.firestore.Timestamp.fromDate(new Date(now.setDate(now.getDate() + 20)));

      // Update user subscription
      await userRef.update({
        Subscription: subscriptionPlan,
        SubscriptionStartDate: subscriptionStartDate,
        SubscriptionEndDate: subscriptionEndDate,
      });

      console.log(`User ${userId} subscription updated successfully`);
    }

    res.status(200).send('IPN Processed Successfully');
  } catch (error) {
    console.error('Error processing IPN:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`IPN Listener running on port ${PORT}`);
});
