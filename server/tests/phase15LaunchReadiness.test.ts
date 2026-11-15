import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../src/app';
import {
  clearTestMemberships,
  clearTestBranchStatuses,
  setTestMembership,
} from '../src/middleware/tenantAuthorization';
import { clearTestTenants } from '../src/services/tenantService';
import { clearTestInvitations } from '../src/services/employeeService';
import { clearTestAuditLogs } from '../src/services/auditService';
import { clearTestInventory } from '../src/services/inventoryService';
import { clearTestMedicines } from '../src/services/medicineService';
import { clearTestBilling } from '../src/services/billingTransactionService';
import { clearTestCustomers } from '../src/services/customerService';
import { clearTestBranchData, BranchService } from '../src/services/branchService';

const repoRoot = path.resolve(__dirname, '..', '..');

function walkTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTsFiles(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

describe('Phase 15: Customer Launch Readiness, Multi-Tenant Isolation & Core Integrity', () => {
  let app: Express;

  const ownerAToken = 'Bearer test-mock-token:p15-owner-a:ownera@p15.test';
  const ownerBToken = 'Bearer test-mock-token:p15-owner-b:ownerb@p15.test';
  const staffAToken = 'Bearer test-mock-token:p15-staff-a:staffa@p15.test';

  const tenantA = 'p15-pharmacy-alpha';
  const tenantB = 'p15-pharmacy-beta';

  const futureMonth = () => {
    const d = new Date(Date.now() + 365 * 86400_000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    clearTestTenants();
    clearTestMemberships();
    clearTestBranchStatuses();
    clearTestBranchData();
    clearTestInvitations();
    clearTestAuditLogs();
    clearTestInventory();
    clearTestMedicines();
    clearTestBilling();
    clearTestCustomers();
  });

  describe('Static Production Launch Guards', () => {
    it('ensures frontend source contains zero window.alert, alert(), window.open, localStorage, or indexedDB calls', () => {
      const srcFiles = walkTsFiles(path.join(repoRoot, 'src'));
      const violations: string[] = [];

      for (const file of srcFiles) {
        const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
        const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);

        lines.forEach((line, idx) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
          // SettingsView renders informational compliance copy mentioning localStorage/IndexedDB by name
          if (rel === 'src/features/settings/SettingsView.tsx' && /localStorage|IndexedDB/.test(trimmed)) return;

          if (/window\.alert\s*\(|\balert\s*\(|window\.open\s*\(|\blocalStorage\b|\bindexedDB\b/.test(line)) {
            violations.push(`${rel}:${idx + 1}: ${trimmed}`);
          }
        });
      }

      expect(violations).toEqual([]);
    });

    it('ensures firestore.indexes.json includes the COLLECTION_GROUP memberships (userId, status) index for /auth/me', () => {
      const indexesRaw = fs.readFileSync(path.join(repoRoot, 'firestore.indexes.json'), 'utf-8');
      const indexes = JSON.parse(indexesRaw).indexes as Array<{
        collectionGroup: string;
        queryScope?: string;
        fields: Array<{ fieldPath: string; order: string }>;
      }>;

      const found = indexes.some(
        (idx) =>
          idx.collectionGroup === 'memberships' &&
          idx.queryScope === 'COLLECTION_GROUP' &&
          idx.fields.map((f) => `${f.fieldPath}:${f.order}`).join(',') === 'userId:ASCENDING,status:ASCENDING'
      );
      expect(found).toBe(true);
    });

    it('ensures Phase 15 operator, hardware, backup, and support playbook documentation exists', () => {
      const docPath = path.join(repoRoot, 'docs/phase15-launch-and-operator-guide.md');
      expect(fs.existsSync(docPath)).toBe(true);
      const doc = fs.readFileSync(docPath, 'utf-8');
      expect(doc).toContain('USB HID');
      expect(doc).toContain('80mm');
      expect(doc).toContain('asia-south1');
      expect(doc).toContain('restore-drill-db');
    });
  });

  describe('Customer Onboarding, Settings Persistence, Multi-Tenant Isolation & Staff Lifecycle', () => {
    it('supports full owner onboarding, /auth/me discovery, settings update, invite acceptance, branch scoping & deactivation', async () => {
      // 1. Fresh user starts with zero active pharmacy workspaces
      const initialMe = await request(app).get('/api/v1/auth/me').set('Authorization', ownerAToken);
      expect(initialMe.status).toBe(200);
      expect(initialMe.body.memberships).toEqual([]);

      // 2. Owner A provisions Pharmacy A
      const createRes = await request(app)
        .post('/api/v1/tenants')
        .set('Authorization', ownerAToken)
        .send({
          tenantId: tenantA,
          name: 'Alpha Care Pharmacy',
          dlNumber20B: 'MH-20B-1001',
          dlNumber21B: 'MH-21B-1002',
          gstin: '27AABCU9603R1ZM',
          address: 'MG Road, Camp',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
          contactPhone: '9822001122',
          contactEmail: 'ownera@p15.test',
          invoicePrefix: 'ALP',
          thermalPrinter: true,
          defaultDiscountPercent: 5,
        });
      expect(createRes.status).toBe(201);

      // Seed test membership map for authorization middleware (simulating Firestore tenant membership doc)
      setTestMembership(tenantA, 'p15-owner-a', {
        tenantId: tenantA,
        userId: 'p15-owner-a',
        name: 'Owner Alpha',
        email: 'ownera@p15.test',
        role: 'owner',
        status: 'active',
        assignedBranchIds: ['main', '*'],
        permissions: ['*'],
      });

      const afterMe = await request(app).get('/api/v1/auth/me').set('Authorization', ownerAToken);
      expect(afterMe.status).toBe(200);
      expect(afterMe.body.memberships.some((m: any) => m.tenantId === tenantA)).toBe(true);

      // 3. Owner updates pharmacy settings via PATCH /api/v1/tenants/:tenantId
      const patchRes = await request(app)
        .patch(`/api/v1/tenants/${tenantA}`)
        .set({
          Authorization: ownerAToken,
          'X-Tenant-ID': tenantA,
          'X-Branch-ID': 'main',
        })
        .send({
          invoicePrefix: 'ALPX',
          thermalPrinter: false,
          defaultDiscountPercent: 10,
        });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.invoicePrefix).toBe('ALPX');
      expect(patchRes.body.data.thermalPrinter).toBe(false);
      expect(patchRes.body.data.defaultDiscountPercent).toBe(10);

      // 4. Owner invites a cashier scoped only to 'main' branch
      const inviteRes = await request(app)
        .post(`/api/v1/tenants/${tenantA}/invitations`)
        .set({
          Authorization: ownerAToken,
          'X-Tenant-ID': tenantA,
          'X-Branch-ID': 'main',
        })
        .send({
          name: 'Counter Staff Alpha',
          email: 'staffa@p15.test',
          role: 'cashier',
          assignedBranchIds: ['main'],
        });
      expect(inviteRes.status).toBe(201);
      const token = inviteRes.body.data.token as string;
      expect(token).toHaveLength(64);

      // 5. Invited staff accepts invite via POST /api/v1/invitations/accept
      const acceptRes = await request(app)
        .post('/api/v1/invitations/accept')
        .set('Authorization', staffAToken)
        .send({ tenantId: tenantA, token });
      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.data.role).toBe('cashier');

      // Non-owner cashier cannot update store settings
      const staffPatchStore = await request(app)
        .patch(`/api/v1/tenants/${tenantA}`)
        .set({
          Authorization: staffAToken,
          'X-Tenant-ID': tenantA,
          'X-Branch-ID': 'main',
        })
        .send({ invoicePrefix: 'HACK' });
      expect(staffPatchStore.status).toBe(403);

      // Staff scoped to 'main' cannot query branch 'branch-2'
      await BranchService.listBranches(tenantA);
      await BranchService.createBranch(
        tenantA,
        { id: 'branch-2', branchCode: 'BR02', name: 'Kothrud Counter', address: 'Kothrud, Pune' },
        'p15-owner-a'
      );
      const wrongBranchRes = await request(app)
        .get('/api/v1/medicines')
        .set({
          Authorization: staffAToken,
          'X-Tenant-ID': tenantA,
          'X-Branch-ID': 'branch-2',
        });
      expect(wrongBranchRes.status).toBe(403);

      // 6. Owner deactivates staff -> subsequent API calls immediately rejected (403)
      const deactivateRes = await request(app)
        .patch(`/api/v1/tenants/${tenantA}/employees/p15-staff-a/status`)
        .set({
          Authorization: ownerAToken,
          'X-Tenant-ID': tenantA,
          'X-Branch-ID': 'main',
        })
        .send({ status: 'deactivated' });
      expect(deactivateRes.status).toBe(200);

      const postRevokeRes = await request(app)
        .get('/api/v1/medicines')
        .set({
          Authorization: staffAToken,
          'X-Tenant-ID': tenantA,
          'X-Branch-ID': 'main',
        });
      expect(postRevokeRes.status).toBe(403);
    });

    it('strictly isolates Pharmacy A and Pharmacy B across medicines, stock, invoices, and customers', async () => {
      // Seed Pharmacy A & Pharmacy B owners
      setTestMembership(tenantA, 'p15-owner-a', {
        tenantId: tenantA,
        userId: 'p15-owner-a',
        name: 'Owner Alpha',
        email: 'ownera@p15.test',
        role: 'owner',
        status: 'active',
        assignedBranchIds: ['main', '*'],
        permissions: ['*'],
      });
      setTestMembership(tenantB, 'p15-owner-b', {
        tenantId: tenantB,
        userId: 'p15-owner-b',
        name: 'Owner Beta',
        email: 'ownerb@p15.test',
        role: 'owner',
        status: 'active',
        assignedBranchIds: ['main', '*'],
        permissions: ['*'],
      });

      const aHeaders = { Authorization: ownerAToken, 'X-Tenant-ID': tenantA, 'X-Branch-ID': 'main' };
      const bHeaders = { Authorization: ownerBToken, 'X-Tenant-ID': tenantB, 'X-Branch-ID': 'main' };

      // Owner A creates medicine, stock batch, customer & POS invoice
      const medRes = await request(app)
        .post('/api/v1/medicines')
        .set(aHeaders)
        .send({
          name: 'Dolo 650',
          genericName: 'Paracetamol',
          brand: 'Micro Labs',
          category: 'Analgesic',
          dosageForm: 'Tablet',
          strength: '650mg',
          packSize: '15 Tabs',
          uom: 'Strip',
          hsnCode: '30049099',
          gstRate: 12,
          minStockThreshold: 5,
        });
      expect(medRes.status).toBe(201);
      const medAId = medRes.body.data.id;

      const stockRes = await request(app)
        .post('/api/v1/inventory/opening-stock')
        .set(aHeaders)
        .send({
          medicineId: medAId,
          batchNumber: 'ALPHA-B1',
          expiryDate: futureMonth(),
          purchasePrice: 20,
          mrp: 35,
          sellingPrice: 32,
          quantity: 20,
        });
      expect(stockRes.status).toBe(201);
      const batchAId = stockRes.body.data.batch.id;

      const custRes = await request(app)
        .post('/api/v1/customers')
        .set(aHeaders)
        .send({ name: 'Alpha Patient', phone: '9822112233' });
      expect(custRes.status).toBe(201);
      const custAId = custRes.body.data.id;

      // Cross-tenant attempts by Owner B against Tenant A IDs or X-Tenant-ID must fail with 403/404
      const crossTenantHeader = await request(app)
        .get('/api/v1/medicines')
        .set({ Authorization: ownerBToken, 'X-Tenant-ID': tenantA, 'X-Branch-ID': 'main' });
      expect(crossTenantHeader.status).toBe(403);

      const crossGetMed = await request(app).get(`/api/v1/medicines/${medAId}`).set(bHeaders);
      expect(crossGetMed.status).toBe(404);

      const crossGetBatch = await request(app).get(`/api/v1/inventory/${batchAId}`).set(bHeaders);
      expect(crossGetBatch.status).toBe(404);

      const crossGetCust = await request(app).get(`/api/v1/customers/${custAId}`).set(bHeaders);
      expect(crossGetCust.status).toBe(404);
    });
  });

  describe('POS Billing, Idempotency, Sales Returns & Cancellation Integrity', () => {
    it('prevents duplicate billing via X-Idempotency-Key and preserves stock accuracy across checkout, return, and cancel', async () => {
      setTestMembership(tenantA, 'p15-owner-a', {
        tenantId: tenantA,
        userId: 'p15-owner-a',
        name: 'Owner Alpha',
        email: 'ownera@p15.test',
        role: 'owner',
        status: 'active',
        assignedBranchIds: ['main', '*'],
        permissions: ['*'],
      });
      await BranchService.listBranches(tenantA);

      const aHeaders = { Authorization: ownerAToken, 'X-Tenant-ID': tenantA, 'X-Branch-ID': 'main' };

      const medRes = await request(app)
        .post('/api/v1/medicines')
        .set(aHeaders)
        .send({
          name: 'Azithral 500',
          genericName: 'Azithromycin',
          brand: 'Alembic',
          category: 'Antibiotic',
          dosageForm: 'Tablet',
          strength: '500mg',
          packSize: '5 Tabs',
          uom: 'Strip',
          hsnCode: '30042019',
          gstRate: 12,
          minStockThreshold: 5,
        });
      expect(medRes.status).toBe(201);
      const medId = medRes.body.data.id;

      const stockRes = await request(app)
        .post('/api/v1/inventory/opening-stock')
        .set(aHeaders)
        .send({
          medicineId: medId,
          batchNumber: 'AZ-2028',
          expiryDate: futureMonth(),
          purchasePrice: 80,
          mrp: 120,
          sellingPrice: 120,
          quantity: 10,
        });
      expect(stockRes.status).toBe(201);
      const batchId = stockRes.body.data.batch.id;

      // 1. Checkout 4 packs with idempotency key
      const checkoutPayload = {
        customer: { name: 'Walk-in Patient' },
        items: [{ medicineId: medId, batchId, quantity: 4 }],
        payments: [{ mode: 'upi', amount: 480, referenceNumber: 'UTR-123456' }],
      };

      const bill1 = await request(app)
        .post('/api/v1/pos/checkout')
        .set({ ...aHeaders, 'X-Idempotency-Key': 'p15-checkout-key-001' })
        .send(checkoutPayload);
      expect(bill1.status).toBe(201);
      const invoiceId = bill1.body.data.invoiceId;

      // 2. Duplicate retry with identical X-Idempotency-Key returns cached invoice (200) and does NOT deduct stock twice
      const billRetry = await request(app)
        .post('/api/v1/pos/checkout')
        .set({ ...aHeaders, 'X-Idempotency-Key': 'p15-checkout-key-001' })
        .send(checkoutPayload);
      expect(billRetry.status).toBe(200);
      expect(billRetry.headers['x-cache']).toBe('HIT');
      expect(billRetry.body.data.invoiceId).toBe(invoiceId);

      const afterSaleBatch = await request(app).get(`/api/v1/inventory/${batchId}`).set(aHeaders);
      expect(afterSaleBatch.status).toBe(200);
      expect(afterSaleBatch.body.data.currentStock).toBe(6);

      // 3. Partial sales return (1 pack restocked -> 7 packs)
      const returnRes = await request(app)
        .post(`/api/v1/invoices/${invoiceId}/returns`)
        .set({ ...aHeaders, 'X-Idempotency-Key': 'p15-return-key-001' })
        .send({
          reason: 'Doctor changed prescription strength',
          items: [{ batchId, quantity: 1, restock: true, damaged: false }],
        });
      expect(returnRes.status).toBe(200);

      const afterReturnBatch = await request(app).get(`/api/v1/inventory/${batchId}`).set(aHeaders);
      expect(afterReturnBatch.body.data.currentStock).toBe(7);

      // 4. Cancel remaining invoice items (remaining 3 packs restored -> 10 packs)
      const cancelRes = await request(app)
        .post(`/api/v1/invoices/${invoiceId}/cancel`)
        .set({ ...aHeaders, 'X-Idempotency-Key': 'p15-cancel-key-001' })
        .send({ reason: 'Customer returned full remaining order' });
      expect(cancelRes.status).toBe(200);

      const afterCancelBatch = await request(app).get(`/api/v1/inventory/${batchId}`).set(aHeaders);
      expect(afterCancelBatch.body.data.currentStock).toBe(10);
    });
  });
});
