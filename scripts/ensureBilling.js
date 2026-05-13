require('dotenv').config();

const db = require('../models');

const { Invoice, sequelize } = db;

const ensureBilling = async () => {
  await sequelize.authenticate();
  await Invoice.sync();
  console.log('Billing tables are ready');
};

ensureBilling()
  .catch((error) => {
    console.error('Failed to prepare billing tables:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
