const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../models');

const { Admin, User, PersonalProfile, BusinessProfile, CustomerWin } = db;
const ACCESS_TOKEN_EXPIRY = '8h';

const toPublicAdmin = (admin) => ({
  id: admin.id,
  email: admin.email,
  firstName: admin.firstName,
  lastName: admin.lastName,
  role: admin.role,
  permissions: admin.permissions,
  status: admin.status,
  lastLoginAt: admin.lastLoginAt,
});

const generateAdminToken = (admin) => jwt.sign(
  {
    adminId: admin.id,
    role: admin.role,
    type: 'admin',
  },
  process.env.JWT_SECRET,
  { expiresIn: ACCESS_TOKEN_EXPIRY }
);

exports.login = async (req, res) => {
  try {
    const email = req.body.email?.toLowerCase().trim();
    const { password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    const admin = await Admin.findOne({ where: { email } });
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials',
      });
    }

    const passwordMatches = await bcrypt.compare(password, admin.password);
    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials',
      });
    }

    if (admin.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Admin account is not active',
      });
    }

    const accessToken = generateAdminToken(admin);
    await admin.update({
      lastLoginAt: new Date(),
      refreshToken: accessToken,
    });

    return res.json({
      success: true,
      message: 'Admin login successful',
      data: {
        accessToken,
        admin: toPublicAdmin(admin),
      },
    });
  } catch (error) {
    console.error('Admin login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Admin login failed',
    });
  }
};

exports.me = async (req, res) => {
  return res.json({
    success: true,
    data: {
      admin: toPublicAdmin(req.admin),
    },
  });
};

exports.logout = async (req, res) => {
  try {
    await req.admin.update({ refreshToken: null });
  } catch (error) {
    console.error('Admin logout cleanup error:', error);
  }

  return res.json({
    success: true,
    message: 'Admin logged out',
  });
};

const toCustomerWin = (customerWin) => ({
  id: customerWin.id,
  name: customerWin.companyName,
  contact: customerWin.contactName,
  type: customerWin.winType,
  useCase: customerWin.useCase,
  paymentStatus: customerWin.paymentStatus,
  state: customerWin.status,
  celebratedAt: customerWin.celebratedAt,
  createdAt: customerWin.createdAt,
});

exports.getCustomerWins = async (req, res) => {
  try {
    const customerWins = await CustomerWin.findAll({ order: [['createdAt', 'DESC']] });
    return res.json({ success: true, data: { customerWins: customerWins.map(toCustomerWin) } });
  } catch (error) {
    console.error('Customer wins fetch error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch customer wins' });
  }
};

exports.createCustomerWin = async (req, res) => {
  try {
    const companyName = req.body.companyName?.trim();
    const contactName = req.body.contactName?.trim();
    const useCase = req.body.useCase?.trim();
    const winType = req.body.winType;
    const paymentStatus = req.body.paymentStatus || 'confirmed';

    if (!companyName || !contactName || !useCase) {
      return res.status(400).json({ success: false, message: 'Company, account owner, and use case are required' });
    }
    if (!['subscription', 'service', 'both'].includes(winType)) {
      return res.status(400).json({ success: false, message: 'Select a valid customer package' });
    }
    if (!['confirmed', 'pending'].includes(paymentStatus)) {
      return res.status(400).json({ success: false, message: 'Select a valid payment status' });
    }

    const customerWin = await CustomerWin.create({
      companyName,
      contactName,
      useCase,
      winType,
      paymentStatus,
      createdByAdminId: req.admin.id,
    });
    return res.status(201).json({ success: true, message: 'Customer win recorded', data: { customerWin: toCustomerWin(customerWin) } });
  } catch (error) {
    console.error('Customer win create error:', error);
    return res.status(500).json({ success: false, message: 'Unable to record customer win' });
  }
};

exports.celebrateCustomerWin = async (req, res) => {
  try {
    const customerWin = await CustomerWin.findByPk(req.params.id);
    if (!customerWin) return res.status(404).json({ success: false, message: 'Customer win not found' });

    await customerWin.update({ status: 'celebrated', celebratedAt: new Date() });
    return res.json({ success: true, message: 'Customer win celebrated', data: { customerWin: toCustomerWin(customerWin) } });
  } catch (error) {
    console.error('Customer win celebration error:', error);
    return res.status(500).json({ success: false, message: 'Unable to complete celebration' });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: {
        exclude: [
          'password',
          'refreshToken',
          'verificationToken',
          'verificationTokenExpires',
          'resetPasswordToken',
          'resetPasswordExpires',
        ],
      },
      include: [
        {
          model: PersonalProfile,
          as: 'personalProfile',
          required: false,
        },
        {
          model: BusinessProfile,
          as: 'businessProfile',
          required: false,
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    return res.json({
      success: true,
      data: {
        users: users.map((user) => {
          const profile = user.personalProfile;
          const businessProfile = user.businessProfile;
          const personalName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
          const name = businessProfile?.businessName || personalName || user.email;

          return {
            id: user.id,
            email: user.email,
            name,
            firstName: profile?.firstName || '',
            lastName: profile?.lastName || '',
            phone: profile?.phone || businessProfile?.phone || '',
            workspace: businessProfile?.businessName || profile?.displayName || `${name}'s workspace`,
            userType: user.userType,
            subscriptionPlan: user.subscriptionPlan || 'Hobby',
            status: user.status,
            verified: user.verified,
            onboardingCompleted: user.onboardingCompleted,
            createdAt: user.createdAt,
          };
        }),
      },
    });
  } catch (error) {
    console.error('Admin users fetch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to fetch users',
    });
  }
};

exports.updateUserStatus = async (req, res) => {
  try {
    const status = req.body.status;
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be active or inactive' });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await user.update({ status });
    return res.json({ success: true, message: status === 'inactive' ? 'Account deactivated' : 'Account activated', data: { status } });
  } catch (error) {
    console.error('Admin user status update error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update account status' });
  }
};
