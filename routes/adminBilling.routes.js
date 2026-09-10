const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const adminBillingController = require('../controllers/adminBilling.controller');

router.use(adminAuth);

router.get('/dashboard', adminBillingController.getDashboard);
router.get('/invoices', adminBillingController.listInvoices);
router.get('/receipts', adminBillingController.listReceipts);
router.get('/documents/next-number', adminBillingController.getNextDocumentNumber);
router.post('/invoices', adminBillingController.createInvoice);
router.post('/documents/send', adminBillingController.sendDocument);
router.put('/invoices/:id', adminBillingController.updateInvoice);
router.patch('/invoices/:id/status', adminBillingController.updateInvoiceStatus);

module.exports = router;
