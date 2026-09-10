'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Invoices', 'lineItems', { type: Sequelize.JSONB, allowNull: true });
    await queryInterface.addColumn('Invoices', 'taxRate', {
      type: Sequelize.DECIMAL(7, 4), allowNull: false, defaultValue: 0,
    });
    await queryInterface.addColumn('Receipts', 'sourceInvoiceId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'Invoices', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('Receipts', ['sourceInvoiceId'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Receipts', ['sourceInvoiceId']);
    await queryInterface.removeColumn('Receipts', 'sourceInvoiceId');
    await queryInterface.removeColumn('Invoices', 'taxRate');
    await queryInterface.removeColumn('Invoices', 'lineItems');
  },
};
