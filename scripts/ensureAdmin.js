require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../models');

const { Admin } = db;

const DEFAULT_EMAIL = process.env.DEFAULT_ADMIN_EMAIL || 'admin@spilight.app';
const DEFAULT_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'Spilight@2026!';

const permissions = {
  users: { read: true, write: true, delete: true },
  billing: { read: true, write: true, refund: true },
  infrastructure: { read: true, write: true },
  settings: { read: true, write: true },
  audit: { read: true },
  reports: { read: true, export: true },
};

const ensureAdmin = async () => {
  try {
    await db.sequelize.authenticate();
    await Admin.sync();

    const password = await bcrypt.hash(DEFAULT_PASSWORD, 12);
    const [admin, created] = await Admin.findOrCreate({
      where: { email: DEFAULT_EMAIL.toLowerCase() },
      defaults: {
        email: DEFAULT_EMAIL.toLowerCase(),
        password,
        firstName: 'Spilight',
        lastName: 'Admin',
        role: 'super_admin',
        permissions,
        status: 'active',
      },
    });

    if (!created) {
      await admin.update({
        password,
        firstName: admin.firstName || 'Spilight',
        lastName: admin.lastName || 'Admin',
        role: 'super_admin',
        permissions,
        status: 'active',
      });
    }

    console.log('Default admin ready');
    console.log(`Email: ${DEFAULT_EMAIL}`);
    console.log(`Password: ${DEFAULT_PASSWORD}`);
  } catch (error) {
    console.error('Failed to ensure default admin:', error);
    process.exitCode = 1;
  } finally {
    await db.sequelize.close();
  }
};

ensureAdmin();
