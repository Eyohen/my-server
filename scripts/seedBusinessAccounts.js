require('dotenv').config();

const bcrypt = require('bcryptjs');
const db = require('../models');

const { User, BusinessProfile, sequelize } = db;
const PASSWORD = 'Password123!';

const accounts = [
  {
    email: 'admin@northstar-demo.test',
    businessName: 'Northstar Demo Ltd',
    contactName: 'Maya Chen',
    businessType: 'startup',
    industry: 'Technology',
  },
  {
    email: 'admin@paycore-demo.test',
    businessName: 'Paycore Demo Africa',
    contactName: 'Ife Ade',
    businessType: 'sme',
    industry: 'Financial Services',
  },
];

const seedBusinessAccounts = async () => {
  await sequelize.authenticate();
  const password = await bcrypt.hash(PASSWORD, 12);

  for (const account of accounts) {
    const [user, created] = await User.findOrCreate({
      where: { email: account.email },
      defaults: {
        email: account.email,
        password,
        userType: 'business',
        verified: true,
        status: 'active',
        onboardingCompleted: true,
        onboardingStep: 2,
      },
    });

    if (!created) {
      await user.update({
        password,
        userType: 'business',
        verified: true,
        status: 'active',
        onboardingCompleted: true,
        onboardingStep: 2,
      });
    }

    await BusinessProfile.upsert({
      userId: user.id,
      businessName: account.businessName,
      contactName: account.contactName,
      businessType: account.businessType,
      industry: account.industry,
      onboardingCompleted: true,
      onboardingStep: 2,
      onboardingCompletedAt: new Date(),
    });

    console.log(`${created ? 'Created' : 'Updated'} ${account.email}`);
  }

  const businessCount = await User.count({ where: { userType: 'business' } });
  console.log(`Business accounts in the local database: ${businessCount}`);
};

seedBusinessAccounts()
  .catch((error) => {
    console.error('Failed to seed business accounts:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
