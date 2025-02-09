const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const { URL } = require('url'); // Node.js built-in URL module
require('dotenv').config();

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const app = express();
app.use(bodyParser.json());

app.get('/api/ipn-listener', async (req, res) => {
  try {
    const listenerUrl = req.query.url;

    if (!listenerUrl) {
      console.error('Missing `url` parameter');
      return res.status(400).send('Missing `url` parameter');
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
      UpdatedAt: 'Hit By Alfalah Bank',
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
