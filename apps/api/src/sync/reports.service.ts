import { Injectable } from '@nestjs/common';

/** Reports center catalog (DEV-PLAN B15/F12) — index of Phase-1 reports. */
@Injectable()
export class ReportsService {
  catalog() {
    return {
      groups: [
        {
          module: 'Production',
          reports: [
            { key: 'production-summary', name: 'Production summary', path: '/production-reports/summary' },
            { key: 'variance', name: 'Batch variance', path: '/production-reports/variance' },
            { key: 'material-consumption', name: 'Material consumption', path: '/production-reports/material-consumption' },
            { key: 'material-reconciliation', name: 'Material reconciliation', path: '/production-reports/material-reconciliation' },
            { key: 'batch-register', name: 'Batch register', path: '/production-reports/batch-register' },
            { key: 'plan-vs-actual', name: 'Plan vs actual', path: '/production-reports/plan-vs-actual' },
          ],
        },
        {
          module: 'Inventory',
          reports: [
            { key: 'low-stock', name: 'Low stock', path: '/inventory-reports/low-stock' },
            { key: 'negative-stock', name: 'Negative stock', path: '/inventory-reports/negative-stock' },
            { key: 'valuation', name: 'Stock valuation', path: '/inventory-reports/valuation' },
            { key: 'movement', name: 'Stock movement', path: '/inventory-reports/movement' },
          ],
        },
        {
          module: 'Billing',
          reports: [
            { key: 'outstanding', name: 'Customer outstanding + aging', path: '/billing-reports/outstanding' },
            { key: 'sales-register', name: 'Sales register', path: '/billing-reports/sales-register' },
            { key: 'gst-summary', name: 'GST summary', path: '/billing-reports/gst-summary' },
            { key: 'hsn-summary', name: 'HSN summary', path: '/billing-reports/hsn-summary' },
            { key: 'gstr-3b', name: 'GSTR-3B summary', path: '/billing-reports/gstr-3b' },
            { key: 'grade-margin', name: 'Gross margin per m³', path: '/billing-reports/grade-margin' },
            { key: 'collection-efficiency', name: 'Collection efficiency & DSO', path: '/billing-reports/collection-efficiency' },
            { key: 'receipts-register', name: 'Receipts register', path: '/billing-reports/receipts-register' },
            { key: 'day-book', name: 'Cash / bank day book', path: '/billing-reports/day-book' },
            { key: 'sales-mis', name: 'Sales MIS', path: '/billing-reports/sales-mis' },
            { key: 'customer-statement', name: 'Customer statement', path: '/billing-reports/customer-statement' },
            { key: 'tally-export', name: 'Tally CSV export', path: '/billing-reports/tally-export' },
          ],
        },
        {
          module: 'Purchase',
          reports: [
            { key: 'itc-register', name: 'ITC register', path: '/purchase-reports/itc-register' },
            { key: 'payables-aging', name: 'Payables aging', path: '/purchase-reports/payables-aging' },
            { key: 'vendor-ledger', name: 'Vendor ledger', path: '/purchase-reports/vendor-ledger' },
            { key: 'purchase-register', name: 'Purchase register', path: '/purchase-reports/purchase-register' },
          ],
        },
        {
          module: 'Operations',
          reports: [
            { key: 'funnel', name: 'Order-to-cash funnel', path: '/dashboard/operations-funnel' },
            { key: 'cycle-times', name: 'Dispatch cycle times', path: '/dispatches/report/cycle-times' },
            { key: 'fleet-utilization', name: 'Fleet utilization', path: '/dispatches/report/fleet-utilization' },
            { key: 'driver-productivity', name: 'Driver productivity', path: '/dispatches/report/driver-productivity' },
            { key: 'delivery-register', name: 'Delivery register', path: '/delivery-challans/report/delivery-register' },
            { key: 'wastage', name: 'Return & wastage', path: '/delivery-challans/report/wastage' },
          ],
        },
        {
          module: 'Fleet',
          reports: [
            { key: 'fleet-running-cost', name: 'Fleet running cost', path: '/fleet-reports/running-cost' },
          ],
        },
      ],
    };
  }
}
