const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../models');

const { Admin, User, PersonalProfile } = db;
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
      ],
      order: [['createdAt', 'DESC']],
    });

    return res.json({
      success: true,
      data: {
        users: users.map((user) => {
          const profile = user.personalProfile;
          const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || user.email;

          return {
            id: user.id,
            email: user.email,
            name,
            firstName: profile?.firstName || '',
            lastName: profile?.lastName || '',
            phone: profile?.phone || '',
            workspace: profile?.displayName || `${name}'s workspace`,
            userType: user.userType,
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
