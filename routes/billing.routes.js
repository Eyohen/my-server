const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billing.controller');
const { verifyToken } = require('../middleware/auth.middleware');

router.get('/summary', verifyToken, billingController.getBillingSummary);
router.get('/receipts', verifyToken, billingController.getReceipts);

module.exports = router;
