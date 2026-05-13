const db = require('../models');

const { Invoice } = db;

const formatInvoice = (invoice) => ({
  id: invoice.id,
  invoiceNumber: invoice.invoiceNumber,
  title: invoice.title,
  amount: Number(invoice.amount),
  currency: invoice.currency,
  status: invoice.status,
  issuedDate: invoice.issuedDate,
  dueDate: invoice.dueDate,
  notes: invoice.notes || '',
  createdAt: invoice.createdAt,
});

const sumInvoices = (invoices, statuses) =>
  invoices
    .filter((invoice) => statuses.includes(invoice.status))
    .reduce((total, invoice) => total + Number(invoice.amount || 0), 0);

exports.getBillingSummary = async (req, res) => {
  try {
    const invoices = await Invoice.findAll({
      where: { userId: req.userId },
      order: [['createdAt', 'DESC']],
    });

    const openInvoices = invoices.filter((invoice) => ['open', 'overdue'].includes(invoice.status));
    const paidInvoices = invoices.filter((invoice) => invoice.status === 'paid');
    const nextInvoice = openInvoices[0] || null;

    return res.json({
      success: true,
      data: {
        stats: {
          currentSpend: sumInvoices(invoices, ['open', 'overdue', 'paid']),
          paidTotal: sumInvoices(invoices, ['paid']),
          openTotal: sumInvoices(invoices, ['open', 'overdue']),
          openInvoiceCount: openInvoices.length,
          paidInvoiceCount: paidInvoices.length,
          invoiceCount: invoices.length,
          nextInvoice: nextInvoice ? formatInvoice(nextInvoice) : null,
        },
        invoices: invoices.map(formatInvoice),
      },
    });
  } catch (error) {
    console.error('Billing summary error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to load billing information',
    });
  }
};
