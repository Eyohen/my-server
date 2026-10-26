const express = require('express');
const router = express.Router();
const adminAuthController = require('../controllers/adminAuth.controller');
const adminAuth = require('../middleware/adminAuth');

router.post('/login', adminAuthController.login);
router.get('/me', adminAuth, adminAuthController.me);
router.get('/users', adminAuth, adminAuthController.getUsers);
router.patch('/users/:id/status', adminAuth, adminAuthController.updateUserStatus);
router.get('/customer-wins', adminAuth, adminAuthController.getCustomerWins);
router.post('/customer-wins', adminAuth, adminAuthController.createCustomerWin);
router.patch('/customer-wins/:id/celebrate', adminAuth, adminAuthController.celebrateCustomerWin);
router.post('/logout', adminAuth, adminAuthController.logout);

module.exports = router;
