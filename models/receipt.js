'use strict';

module.exports = (sequelize, DataTypes) => {
  const Receipt = sequelize.define('Receipt', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    receiptNumber: {
      type: DataTypes.STRING(40),
      allowNull: false,
      unique: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'Users', key: 'id' },
    },
    sourceInvoiceId: {
      type: DataTypes.UUID,
      allowNull: true,
      unique: true,
      references: { model: 'Invoices', key: 'id' },
    },
    customerName: {
      type: DataTypes.STRING(180),
      allowNull: false,
    },
    customerEmail: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING(180),
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'USD',
    },
    paidDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    tableName: 'Receipts',
    timestamps: true,
    indexes: [
      { fields: ['receiptNumber'], unique: true },
      { fields: ['userId'] },
      { fields: ['paidDate'] },
    ],
  });

  Receipt.associate = function(models) {
    Receipt.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    Receipt.belongsTo(models.Invoice, { foreignKey: 'sourceInvoiceId', as: 'sourceInvoice' });
  };

  return Receipt;
};
