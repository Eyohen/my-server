const express = require('express');
const router = express.Router();
const adminAuthController = require('../controllers/adminAuth.controller');
const adminAuth = require('../middleware/adminAuth');

router.post('/login', adminAuthController.login);
router.get('/me', adminAuth, adminAuthController.me);
router.get('/users', adminAuth, adminAuthController.getUsers);
router.patch('/users/:id/status', adminAuth, adminAuthController.updateUserStatus);
router.post('/logout', adminAuth, adminAuthController.logout);

module.exports = router;
