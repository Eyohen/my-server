'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('CustomerWins', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      companyName: { type: Sequelize.STRING(180), allowNull: false },
      contactName: { type: Sequelize.STRING(180), allowNull: false },
      winType: { type: Sequelize.ENUM('subscription', 'service', 'both'), allowNull: false },
      useCase: { type: Sequelize.TEXT, allowNull: false },
      paymentStatus: { type: Sequelize.ENUM('confirmed', 'pending'), allowNull: false, defaultValue: 'confirmed' },
      status: { type: Sequelize.ENUM('pending', 'celebrated'), allowNull: false, defaultValue: 'pending' },
      celebratedAt: { type: Sequelize.DATE, allowNull: true },
      createdByAdminId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'Admins', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('CustomerWins', ['status']);
    await queryInterface.addIndex('CustomerWins', ['createdAt']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('CustomerWins');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_CustomerWins_winType";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_CustomerWins_paymentStatus";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_CustomerWins_status";');
  },
};
