'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Receipts', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      receiptNumber: { type: Sequelize.STRING(40), allowNull: false, unique: true },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      customerName: { type: Sequelize.STRING(180), allowNull: false },
      customerEmail: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.STRING(180), allowNull: false },
      amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'USD' },
      paidDate: { type: Sequelize.DATEONLY, allowNull: false },
      notes: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('Receipts', ['userId']);
    await queryInterface.addIndex('Receipts', ['paidDate']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Receipts');
  },
};
