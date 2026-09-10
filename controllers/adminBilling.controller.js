const db = require('../models');
const emailService = require('../services/email.service');

const { Invoice, Receipt, User, PersonalProfile, BusinessProfile } = db;
const { Op } = db.Sequelize;

const allowedStatuses = new Set(['draft', 'open', 'paid', 'overdue', 'void']);
const billableServices = new Set([
  'Disk (per GB / min)',
  'Memory (per MB / min)',
  'Agent Usage',
  'vCPU (per vCPU / min)',
  'Network',
  'Object Storage (per GB-month)',
]);
const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const formatDocumentMoney = (amount, currency) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount || 0));
  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
};

const formatDocumentDate = (value) => {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const parseLineItems = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const formatInvoice = (invoice, receiptSent = Boolean(invoice.receipt)) => {
  const user = invoice.user;
  const profile = user?.personalProfile;
  const businessProfile = user?.businessProfile;
  const customerName = businessProfile?.businessName || [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || user?.email || '';

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
    lineItems: parseLineItems(invoice.lineItems),
    taxRate: Number(invoice.taxRate || 0),
    receiptSent,
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
      {
        model: BusinessProfile,
        as: 'businessProfile',
        required: false,
        attributes: ['businessName', 'contactName', 'phone'],
      },
    ],
  },
  {
    model: Receipt,
    as: 'receipt',
    required: false,
    attributes: ['id'],
  },
];

const buildInvoiceNumber = async (offset = 1) => {
  const year = new Date().getFullYear();
  const prefix = `SPI-${year}-`;
  const invoices = await Invoice.findAll({
    attributes: ['invoiceNumber'],
    where: {
      invoiceNumber: {
        [Op.like]: `${prefix}%`,
      },
    },
  });

  const highestSerial = invoices.reduce((highest, invoice) => {
    const serial = Number(invoice.invoiceNumber.replace(prefix, ''));
    return Number.isInteger(serial) ? Math.max(highest, serial) : highest;
  }, 0);

  return `${prefix}${String(highestSerial + offset).padStart(5, '0')}`;
};

const buildAvailableDocumentNumber = async (type, requestedNumber) => {
  const model = type === 'invoice' ? Invoice : Receipt;
  const field = type === 'invoice' ? 'invoiceNumber' : 'receiptNumber';
  const requested = requestedNumber.trim();

  if (!await model.findOne({ where: { [field]: requested } })) return requested;

  if (type === 'invoice') {
    // The normal SPI numbers are sequential. buildInvoiceNumber reads the current
    // maximum, while this loop also handles gaps/races left by older data.
    for (let offset = 1; offset <= 100; offset += 1) {
      const candidate = await buildInvoiceNumber(offset);
      if (!await Invoice.findOne({ where: { invoiceNumber: candidate } })) return candidate;
    }
  }

  for (let suffix = 2; suffix <= 1000; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${requested.slice(0, 40 - suffixText.length)}${suffixText}`;
    if (!await model.findOne({ where: { [field]: candidate } })) return candidate;
  }

  throw new Error(`Unable to allocate a unique ${type} number`);
};

const validateInvoiceInput = ({ userId, title, amount, status }) => {
  if (!userId) return 'User is required';
  if (!title?.trim()) return 'Invoice title is required';
  if (amount === undefined || amount === null || Number.isNaN(Number(amount))) return 'A valid invoice amount is required';
  if (Number(amount) < 0) return 'Invoice amount cannot be negative';
  if (status && !allowedStatuses.has(status)) return 'Invalid invoice status';
  return null;
};

exports.getDashboard = async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      accountTypeCounts,
      pendingUsers,
      totalInvoices,
      openInvoices,
      paidInvoices,
      overdueInvoices,
    ] = await Promise.all([
      User.count(),
      User.count({ where: { status: 'active' } }),
      db.sequelize.query(`
        SELECT
          COUNT(*) FILTER (WHERE "userType"::text IN ('personal', 'creator')) AS personal,
          COUNT(*) FILTER (WHERE "userType"::text IN ('business', 'brand')) AS business
        FROM "Users"
      `, {
        type: db.Sequelize.QueryTypes.SELECT,
        plain: true,
      }),
      User.count({ where: { status: 'pending_verification' } }),
      Invoice.count(),
      Invoice.findAll({ where: { status: { [Op.in]: ['open', 'overdue'] } } }),
      Invoice.findAll({ where: { status: 'paid' } }),
      Invoice.findAll({ where: { status: 'overdue' } }),
    ]);

    const openRevenue = openInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
    const paidRevenue = paidInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
    const overdueRevenue = overdueInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);

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
        accountTypes: {
          personal: Number(accountTypeCounts?.personal || 0),
          business: Number(accountTypeCounts?.business || 0),
        },
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

exports.listReceipts = async (req, res) => {
  try {
    const receipts = await Receipt.findAll({
      order: [['paidDate', 'DESC'], ['createdAt', 'DESC']],
    });

    return res.json({
      success: true,
      data: {
        receipts: receipts.map((receipt) => ({
          id: receipt.id,
          receiptNumber: receipt.receiptNumber,
          sourceInvoiceId: receipt.sourceInvoiceId,
          customerName: receipt.customerName,
          customerEmail: receipt.customerEmail,
          description: receipt.description,
          amount: Number(receipt.amount),
          currency: receipt.currency,
          paidDate: receipt.paidDate,
          notes: receipt.notes || '',
        })),
      },
    });
  } catch (error) {
    console.error('Admin receipts fetch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to fetch receipts',
    });
  }
};

exports.getNextDocumentNumber = async (req, res) => {
  try {
    const type = req.query.type === 'receipt' ? 'receipt' : 'invoice';
    const year = new Date().getFullYear();
    const requested = type === 'invoice' ? `SPI-${year}-00001` : `RCT-${year}-00001`;
    const documentNumber = await buildAvailableDocumentNumber(type, requested);

    return res.json({ success: true, data: { documentNumber } });
  } catch (error) {
    console.error('Next document number error:', error);
    return res.status(500).json({ success: false, message: 'Unable to generate a document number' });
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

    const invoicePayload = {
      userId: req.body.userId,
      title: req.body.title.trim(),
      amount: Number(req.body.amount).toFixed(2),
      currency: (req.body.currency || 'USD').toUpperCase(),
      status: req.body.status || 'open',
      issuedDate: req.body.issuedDate || new Date().toISOString().slice(0, 10),
      dueDate: req.body.dueDate || null,
      notes: req.body.notes?.trim() || null,
    };

    const manualInvoiceNumber = req.body.invoiceNumber?.trim();
    let invoice;

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        invoice = await Invoice.create({
          ...invoicePayload,
          invoiceNumber: manualInvoiceNumber || await buildInvoiceNumber(attempt),
        });
        break;
      } catch (error) {
        const isDuplicate = error.name === 'SequelizeUniqueConstraintError';
        if (!isDuplicate || manualInvoiceNumber || attempt === 5) {
          throw error;
        }
      }
    }

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

exports.sendDocument = async (req, res) => {
  try {
    const {
      type,
      recipientUserId,
      sourceInvoiceId,
      documentNumber,
      issueDate,
      dueDate,
      currency = 'USD',
      taxRate = 0,
      notes = '',
      items = [],
    } = req.body;

    if (!['invoice', 'receipt'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Document type must be invoice or receipt' });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recipientUserId || '')) {
      return res.status(400).json({ success: false, message: 'Select a recipient from the customer accounts' });
    }
    if (!documentNumber?.trim()) {
      return res.status(400).json({ success: false, message: 'Document number is required' });
    }
    if (!Array.isArray(items) || items.length === 0 || items.some((item) => !billableServices.has(item.description) || Number(item.quantity) <= 0 || Number(item.rate) < 0)) {
      return res.status(400).json({ success: false, message: 'Every line item needs a valid service, positive quantity, and valid rate' });
    }
    if (type === 'receipt' && sourceInvoiceId) {
      const sourceInvoice = await Invoice.findOne({ where: { id: sourceInvoiceId, userId: recipientUserId } });
      if (!sourceInvoice) return res.status(400).json({ success: false, message: 'The source invoice is invalid' });
    }

    const recipient = await User.findByPk(recipientUserId, {
      attributes: ['id', 'email'],
      include: [
        {
          model: PersonalProfile,
          as: 'personalProfile',
          required: false,
          attributes: ['firstName', 'lastName', 'displayName'],
        },
        {
          model: BusinessProfile,
          as: 'businessProfile',
          required: false,
          attributes: ['businessName', 'contactName'],
        },
      ],
    });

    if (!recipient) {
      return res.status(400).json({ success: false, message: 'The selected customer account no longer exists' });
    }

    const personalName = [recipient.personalProfile?.firstName, recipient.personalProfile?.lastName].filter(Boolean).join(' ');
    const recipientName = recipient.businessProfile?.businessName || personalName || recipient.personalProfile?.displayName || recipient.email;
    const recipientEmail = recipient.email;

    const normalizedCurrency = String(currency || 'USD').toUpperCase().slice(0, 3);
    const subtotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.rate), 0);
    const tax = subtotal * (Math.max(0, Number(taxRate) || 0) / 100);
    const total = subtotal + tax;
    const label = type === 'invoice' ? 'Invoice' : 'Receipt';
    let resolvedDocumentNumber = await buildAvailableDocumentNumber(type, documentNumber);
    const itemSummary = items.length === 1
      ? items[0].description
      : `${items[0].description} + ${items.length - 1} more`;
    let savedInvoice = null;
    let savedReceipt = null;

    // Reserve the number in billing before sending so the unique database index
    // remains the final authority when multiple admins submit concurrently.
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      try {
        if (type === 'invoice') {
          savedInvoice = await Invoice.create({
            invoiceNumber: resolvedDocumentNumber,
            userId: recipient.id,
            title: itemSummary.slice(0, 180),
            amount: total.toFixed(2),
            currency: normalizedCurrency,
            status: 'open',
            issuedDate: issueDate || new Date().toISOString().slice(0, 10),
            dueDate: dueDate || null,
            notes: notes?.trim() || null,
            lineItems: items.map(({ description, quantity, rate }) => ({ description, quantity: Number(quantity), rate: Number(rate) })),
            taxRate: Math.max(0, Number(taxRate) || 0),
          });
        } else {
          savedReceipt = await Receipt.create({
            receiptNumber: resolvedDocumentNumber,
            userId: recipient.id,
            sourceInvoiceId: sourceInvoiceId || null,
            customerName: recipientName.trim(),
            customerEmail: recipientEmail.trim(),
            description: itemSummary.slice(0, 180),
            amount: total.toFixed(2),
            currency: normalizedCurrency,
            paidDate: dueDate || issueDate || new Date().toISOString().slice(0, 10),
            notes: notes?.trim() || null,
          });
        }
        break;
      } catch (error) {
        if (error.name !== 'SequelizeUniqueConstraintError' || attempt === 10) throw error;
        resolvedDocumentNumber = await buildAvailableDocumentNumber(type, resolvedDocumentNumber);
      }
    }

    const lineItems = items.map((item) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #eeeeee;font-size:12px;font-weight:500;color:#111111">${escapeHtml(item.description)}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #eeeeee;font-size:12px;color:#808080;text-align:center">${Number(item.quantity)}</td>
        <td style="padding:12px 0;border-bottom:1px solid #eeeeee;font-size:12px;font-weight:500;color:#111111;text-align:right">${escapeHtml(formatDocumentMoney(Number(item.quantity) * Number(item.rate), normalizedCurrency))}</td>
      </tr>`).join('');

    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#ececec;font-family:Inter,Arial,sans-serif;color:#0a0a0a">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#ececec"><tr><td align="center" style="padding:28px 12px">
        <table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 14px 45px rgba(0,0,0,0.12)">
          <tr><td style="padding:24px 28px;background:#000000;color:#ffffff">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
              <td><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="width:32px;height:32px;background:#ffffff;border-radius:4px;text-align:center;color:#000000;font-size:14px;font-weight:900">S</td><td style="padding-left:12px;color:#ffffff;font-size:16px;font-weight:600">spilight</td></tr></table></td>
              <td align="right" style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#8c8c8c">${type}</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:36px">
            <p style="margin:0;color:#808080;font-size:14px">Hello ${escapeHtml(recipientName.trim())},</p>
            <h1 style="margin:12px 0 0;color:#0a0a0a;font-size:24px;font-weight:600;line-height:1.25;letter-spacing:-0.8px">Your ${type} is ready.</h1>
            <p style="margin:12px 0 0;color:#737373;font-size:14px;line-height:24px">${type === 'invoice' ? 'Please review the billing details and amount due below.' : 'We received your payment. Here is your receipt for your records.'}</p>

            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:28px;border:1px solid #e5e5e5;border-radius:8px;border-collapse:separate;overflow:hidden">
              <tr><td style="padding:20px;background:#f7f7f7;border-bottom:1px solid #e5e5e5">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="50%" valign="top" style="padding:0 12px 20px 0"><p style="margin:0;color:#9e9e9e;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${label} number</p><p style="margin:8px 0 0;color:#0a0a0a;font-size:12px;font-weight:700">${escapeHtml(resolvedDocumentNumber)}</p></td>
                    <td width="50%" valign="top" style="padding:0 0 20px 12px"><p style="margin:0;color:#9e9e9e;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px">Issued</p><p style="margin:8px 0 0;color:#0a0a0a;font-size:12px;font-weight:700">${formatDocumentDate(issueDate)}</p></td>
                  </tr>
                  <tr>
                    <td width="50%" valign="top" style="padding:0 12px 0 0"><p style="margin:0;color:#9e9e9e;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px">Billed to</p><p style="margin:8px 0 0;color:#0a0a0a;font-size:12px;font-weight:700">${escapeHtml(recipientName.trim())}</p><p style="margin:4px 0 0;color:#858585;font-size:12px">${escapeHtml(recipientEmail.trim())}</p></td>
                    <td width="50%" valign="top" style="padding:0 0 0 12px"><p style="margin:0;color:#9e9e9e;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${type === 'invoice' ? 'Due' : 'Paid'}</p><p style="margin:8px 0 0;color:#0a0a0a;font-size:12px;font-weight:700">${formatDocumentDate(dueDate)}</p></td>
                  </tr>
                </table>
              </td></tr>
              <tr><td style="padding:20px">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <thead><tr><th align="left" style="padding:0 0 12px;border-bottom:1px solid #e5e5e5;color:#a3a3a3;font-size:10px;text-transform:uppercase;letter-spacing:1px">Description</th><th width="48" align="center" style="padding:0 8px 12px;border-bottom:1px solid #e5e5e5;color:#a3a3a3;font-size:10px;text-transform:uppercase;letter-spacing:1px">Qty</th><th width="90" align="right" style="padding:0 0 12px;border-bottom:1px solid #e5e5e5;color:#a3a3a3;font-size:10px;text-transform:uppercase;letter-spacing:1px">Amount</th></tr></thead>
                  <tbody>${lineItems}</tbody>
                </table>
                <table role="presentation" width="224" align="right" cellspacing="0" cellpadding="0" border="0" style="margin-top:20px">
                  <tr><td style="padding:0 0 8px;color:#808080;font-size:12px">Subtotal</td><td align="right" style="padding:0 0 8px;color:#808080;font-size:12px">${escapeHtml(formatDocumentMoney(subtotal, normalizedCurrency))}</td></tr>
                  <tr><td style="padding:0 0 12px;color:#808080;font-size:12px">Tax (${Math.max(0, Number(taxRate) || 0)}%)</td><td align="right" style="padding:0 0 12px;color:#808080;font-size:12px">${escapeHtml(formatDocumentMoney(tax, normalizedCurrency))}</td></tr>
                  <tr><td style="padding:12px 0 0;border-top:1px solid #e5e5e5;color:#0a0a0a;font-size:14px;font-weight:700">${type === 'invoice' ? 'Amount due' : 'Total paid'}</td><td align="right" style="padding:12px 0 0;border-top:1px solid #e5e5e5;color:#0a0a0a;font-size:14px;font-weight:700">${escapeHtml(formatDocumentMoney(total, normalizedCurrency))}</td></tr>
                </table>
              </td></tr>
            </table>
            ${notes ? `<p style="margin:24px 0 0;padding:16px;background:#f7f7f7;border-radius:6px;color:#808080;font-size:12px;line-height:20px">${escapeHtml(notes)}</p>` : ''}
            <p style="margin:32px 0 0;color:#9e9e9e;font-size:12px;line-height:20px">Questions? Reply to this email and the Spilight team will help.</p>
          </td></tr>
        </table>
      </td></tr></table>
    </body></html>`;

    let result;
    try {
      result = await emailService.sendEmail({
        to: recipientEmail.trim(),
        subject: `${label} ${resolvedDocumentNumber} from Spilight`,
        html,
        text: `${label} ${resolvedDocumentNumber} for ${recipientName.trim()}. ${type === 'invoice' ? 'Amount due' : 'Total paid'}: ${formatDocumentMoney(total, normalizedCurrency)}.`,
      });
    } catch (error) {
      await (savedInvoice || savedReceipt)?.destroy();
      throw error;
    }

    if (!result.success) {
      await (savedInvoice || savedReceipt)?.destroy();
      return res.status(502).json({ success: false, message: result.error || `Unable to send ${type}` });
    }

    if (type === 'invoice') {
      savedInvoice = await Invoice.findByPk(savedInvoice.id, { include: getInvoiceInclude() });
    }

    return res.json({
      success: true,
      message: `${label} sent to ${recipientEmail.trim()}${savedInvoice || savedReceipt ? ' and added to billing' : ''}`,
      data: {
        documentNumber: resolvedDocumentNumber,
        ...(savedInvoice ? { invoice: formatInvoice(savedInvoice) } : {}),
      },
    });
  } catch (error) {
    console.error('Admin document send error:', error);
    const isDuplicate = error.name === 'SequelizeUniqueConstraintError';
    if (isDuplicate) {
      return res.status(409).json({ success: false, message: `This ${req.body.type === 'receipt' ? 'receipt' : 'invoice'} number already exists in billing` });
    }
    return res.status(500).json({ success: false, message: 'Unable to send document email' });
  }
};
