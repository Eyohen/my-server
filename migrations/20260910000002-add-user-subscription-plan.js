'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'subscriptionPlan', {
      type: Sequelize.STRING(40),
      allowNull: false,
      defaultValue: 'Hobby',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'subscriptionPlan');
  },
};
