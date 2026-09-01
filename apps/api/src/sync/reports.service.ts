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
            { key: 'grade-margin', name: 'Gross margin per m³', path: '/billing-reports/grade-margin' },
            { key: 'collection-efficiency', name: 'Collection efficiency & DSO', path: '/billing-reports/collection-efficiency' },
            { key: 'receipts-register', name: 'Receipts register', path: '/billing-reports/receipts-register' },
            { key: 'tally-export', name: 'Tally CSV export', path: '/billing-reports/tally-export' },
          ],
        },
        {
          module: 'Operations',
          reports: [
            { key: 'funnel', name: 'Order-to-cash funnel', path: '/dashboard/operations-funnel' },
            { key: 'driver-productivity', name: 'Driver productivity', path: '/dispatches/report/driver-productivity' },
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
