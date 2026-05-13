const db = require('../models');

const { Invoice, User, PersonalProfile } = db;
const { Op } = db.Sequelize;

const allowedStatuses = new Set(['draft', 'open', 'paid', 'overdue', 'void']);

const formatInvoice = (invoice) => {
  const user = invoice.user;
  const profile = user?.personalProfile;
  const customerName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || user?.email || '';

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    userId: invoice.userId,
    customerName,
    customerEmail: user?.email || '',
    title: invoice.title,
    amount: Number(invoice.amount),
    currency: invoice.currency,
    status: invoice.status,
    issuedDate: invoice.issuedDate,
    dueDate: invoice.dueDate,
    notes: invoice.notes || '',
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
};

const getInvoiceInclude = () => [
  {
    model: User,
    as: 'user',
    attributes: ['id', 'email'],
    include: [
      {
        model: PersonalProfile,
        as: 'personalProfile',
        required: false,
        attributes: ['firstName', 'lastName', 'displayName', 'phone'],
      },
    ],
  },
];

const buildInvoiceNumber = async () => {
  const count = await Invoice.count();
  const serial = String(count + 1).padStart(5, '0');
  return `SPI-${new Date().getFullYear()}-${serial}`;
};

const validateInvoiceInput = ({ userId, title, amount, status }) => {
  if (!userId) return 'User is required';
  if (!title?.trim()) return 'Invoice title is required';
  if (amount === undefined || amount === null || Number.isNaN(Number(amount))) return 'A valid invoice amount is required';
  if (Number(amount) < 0) return 'Invoice amount cannot be negative';
  if (status && !allowedStatuses.has(status)) return 'Invalid invoice status';
  return null;
};

const toDateKey = (date) => date.toISOString().slice(0, 10);

const getLastSevenDays = () => {
  const days = [];
  const today = new Date();

  for (let index = 6; index >= 0; index -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - index);
    days.push({
      key: toDateKey(date),
      day: date.toLocaleDateString('en-US', { weekday: 'short' }),
    });
  }

  return days;
};

exports.getDashboard = async (req, res) => {
  try {
    const days = getLastSevenDays();
    const startDate = `${days[0].key}T00:00:00.000Z`;

    const [
      totalUsers,
      activeUsers,
      pendingUsers,
      totalInvoices,
      openInvoices,
      paidInvoices,
      overdueInvoices,
      recentInvoices,
    ] = await Promise.all([
      User.count(),
      User.count({ where: { status: 'active' } }),
      User.count({ where: { status: 'pending_verification' } }),
      Invoice.count(),
      Invoice.findAll({ where: { status: { [Op.in]: ['open', 'overdue'] } } }),
      Invoice.findAll({ where: { status: 'paid' } }),
      Invoice.findAll({ where: { status: 'overdue' } }),
      Invoice.findAll({
        where: {
          createdAt: {
            [Op.gte]: new Date(startDate),
          },
        },
        attributes: ['amount', 'status', 'createdAt'],
      }),
    ]);

    const openRevenue = openInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
    const paidRevenue = paidInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
    const overdueRevenue = overdueInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);

    const chart = days.map((day) => {
      const invoicesForDay = recentInvoices.filter((invoice) => toDateKey(invoice.createdAt) === day.key);
      const revenue = invoicesForDay
        .filter((invoice) => invoice.status === 'paid')
        .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);

      return {
        day: day.day,
        revenue,
        invoices: invoicesForDay.length,
      };
    });

    const alerts = [];
    if (overdueInvoices.length > 0) {
      alerts.push(`${overdueInvoices.length} overdue invoice${overdueInvoices.length === 1 ? '' : 's'} need follow-up`);
    }
    if (openInvoices.length > 0) {
      alerts.push(`${openInvoices.length} open invoice${openInvoices.length === 1 ? '' : 's'} awaiting payment`);
    }
    if (pendingUsers > 0) {
      alerts.push(`${pendingUsers} user${pendingUsers === 1 ? '' : 's'} pending email verification`);
    }
    if (alerts.length === 0) {
      alerts.push('No billing or user alerts right now');
    }

    return res.json({
      success: true,
      data: {
        metrics: {
          totalUsers,
          activeUsers,
          totalInvoices,
          openInvoiceCount: openInvoices.length,
          openRevenue,
          paidInvoiceCount: paidInvoices.length,
          paidRevenue,
          overdueInvoiceCount: overdueInvoices.length,
          overdueRevenue,
        },
        chart,
        alerts,
      },
    });
  } catch (error) {
    console.error('Admin dashboard fetch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to fetch dashboard data',
    });
  }
};

exports.listInvoices = async (req, res) => {
  try {
    const invoices = await Invoice.findAll({
      include: getInvoiceInclude(),
      order: [['createdAt', 'DESC']],
    });

    return res.json({
      success: true,
      data: {
        invoices: invoices.map(formatInvoice),
      },
    });
  } catch (error) {
    console.error('Admin invoices fetch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to fetch invoices',
    });
  }
};

exports.createInvoice = async (req, res) => {
  try {
    const validationError = validateInvoiceInput(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const user = await User.findByPk(req.body.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const invoice = await Invoice.create({
      invoiceNumber: req.body.invoiceNumber?.trim() || await buildInvoiceNumber(),
      userId: req.body.userId,
      title: req.body.title.trim(),
      amount: Number(req.body.amount).toFixed(2),
      currency: (req.body.currency || 'USD').toUpperCase(),
      status: req.body.status || 'open',
      issuedDate: req.body.issuedDate || new Date().toISOString().slice(0, 10),
      dueDate: req.body.dueDate || null,
      notes: req.body.notes?.trim() || null,
    });

    const savedInvoice = await Invoice.findByPk(invoice.id, { include: getInvoiceInclude() });

    return res.status(201).json({
      success: true,
      message: 'Invoice created',
      data: {
        invoice: formatInvoice(savedInvoice),
      },
    });
  } catch (error) {
    console.error('Admin invoice create error:', error);
    const isDuplicate = error.name === 'SequelizeUniqueConstraintError';
    return res.status(isDuplicate ? 409 : 500).json({
      success: false,
      message: isDuplicate ? 'Invoice number already exists' : 'Unable to create invoice',
    });
  }
};

exports.updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findByPk(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const nextInput = {
      userId: req.body.userId ?? invoice.userId,
      title: req.body.title ?? invoice.title,
      amount: req.body.amount ?? invoice.amount,
      status: req.body.status ?? invoice.status,
    };
    const validationError = validateInvoiceInput(nextInput);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    if (req.body.userId) {
      const user = await User.findByPk(req.body.userId);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
    }

    await invoice.update({
      invoiceNumber: req.body.invoiceNumber?.trim() || invoice.invoiceNumber,
      userId: nextInput.userId,
      title: nextInput.title.trim(),
      amount: Number(nextInput.amount).toFixed(2),
      currency: (req.body.currency || invoice.currency || 'USD').toUpperCase(),
      status: nextInput.status,
      issuedDate: req.body.issuedDate || invoice.issuedDate,
      dueDate: req.body.dueDate === undefined ? invoice.dueDate : req.body.dueDate || null,
      notes: req.body.notes === undefined ? invoice.notes : req.body.notes?.trim() || null,
    });

    const savedInvoice = await Invoice.findByPk(invoice.id, { include: getInvoiceInclude() });

    return res.json({
      success: true,
      message: 'Invoice updated',
      data: {
        invoice: formatInvoice(savedInvoice),
      },
    });
  } catch (error) {
    console.error('Admin invoice update error:', error);
    const isDuplicate = error.name === 'SequelizeUniqueConstraintError';
    return res.status(isDuplicate ? 409 : 500).json({
      success: false,
      message: isDuplicate ? 'Invoice number already exists' : 'Unable to update invoice',
    });
  }
};

exports.updateInvoiceStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!allowedStatuses.has(status)) {
      return res.status(400).json({ success: false, message: 'Invalid invoice status' });
    }

    const invoice = await Invoice.findByPk(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    await invoice.update({ status });
    const savedInvoice = await Invoice.findByPk(invoice.id, { include: getInvoiceInclude() });

    return res.json({
      success: true,
      message: 'Invoice status updated',
      data: {
        invoice: formatInvoice(savedInvoice),
      },
    });
  } catch (error) {
    console.error('Admin invoice status update error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to update invoice status',
    });
  }
};
