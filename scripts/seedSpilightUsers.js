require('dotenv').config();

const bcrypt = require('bcryptjs');
const db = require('../models');

const { User, PersonalProfile, sequelize } = db;

const PASSWORD = 'Password123!';

const users = [
  {
    email: 'info@gamedey.com',
    firstName: 'Game',
    lastName: 'Dey',
    phone: '+2348010001001',
  },
  {
    email: 'info@cedora.com',
    firstName: 'Cedora',
    lastName: 'Team',
    phone: '+2348010001002',
  },
  {
    email: 'info@homeofproteingoodies.com',
    firstName: 'Protein',
    lastName: 'Goodies',
    phone: '+2348010001003',
  },
  {
    email: 'info@connectin.com',
    firstName: 'Connect',
    lastName: 'In',
    phone: '+2348010001004',
  },
  {
    email: 'info@yursay.com',
    firstName: 'Yur',
    lastName: 'Say',
    phone: '+2348010001005',
  },
  {
    email: 'info@zentranscript.com',
    firstName: 'Zen',
    lastName: 'Transcript',
    phone: '+2348010001006',
  },
];

const seedUsers = async () => {
  const password = await bcrypt.hash(PASSWORD, 12);

  await sequelize.authenticate();
  await User.sync();
  await PersonalProfile.sync();

  for (const userSeed of users) {
    const email = userSeed.email.toLowerCase();
    const [user, created] = await User.findOrCreate({
      where: { email },
      defaults: {
        email,
        password,
        userType: 'personal',
        verified: true,
        status: 'active',
        onboardingCompleted: true,
        onboardingStep: 2,
      },
    });

    if (!created) {
      await user.update({
        password,
        userType: 'personal',
        verified: true,
        status: 'active',
        onboardingCompleted: true,
        onboardingStep: Math.max(user.onboardingStep || 0, 2),
        verificationToken: null,
        verificationTokenExpires: null,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      });
    }

    const displayName = `${userSeed.firstName} ${userSeed.lastName}`;
    await PersonalProfile.upsert({
      userId: user.id,
      firstName: userSeed.firstName,
      lastName: userSeed.lastName,
      displayName,
      phone: userSeed.phone,
      onboardingCompleted: true,
      onboardingStep: 2,
      onboardingCompletedAt: new Date(),
    });

    console.log(`${created ? 'Created' : 'Updated'} ${email}`);
  }

  console.log(`Seeded ${users.length} Spilight users. Password: ${PASSWORD}`);
};

seedUsers()
  .catch((error) => {
    console.error('Failed to seed Spilight users:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
