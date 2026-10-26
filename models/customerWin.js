'use strict';

module.exports = (sequelize, DataTypes) => {
  const CustomerWin = sequelize.define('CustomerWin', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    companyName: {
      type: DataTypes.STRING(180),
      allowNull: false,
    },
    contactName: {
      type: DataTypes.STRING(180),
      allowNull: false,
    },
    winType: {
      type: DataTypes.ENUM('subscription', 'service', 'both'),
      allowNull: false,
    },
    useCase: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    paymentStatus: {
      type: DataTypes.ENUM('confirmed', 'pending'),
      allowNull: false,
      defaultValue: 'confirmed',
    },
    status: {
      type: DataTypes.ENUM('pending', 'celebrated'),
      allowNull: false,
      defaultValue: 'pending',
    },
    celebratedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    createdByAdminId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'Admins', key: 'id' },
    },
  }, {
    tableName: 'CustomerWins',
    timestamps: true,
    indexes: [
      { fields: ['status'] },
      { fields: ['createdAt'] },
    ],
  });

  CustomerWin.associate = function(models) {
    CustomerWin.belongsTo(models.Admin, { foreignKey: 'createdByAdminId', as: 'createdBy' });
  };

  return CustomerWin;
};
