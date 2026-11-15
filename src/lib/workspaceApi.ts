/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BillInvoice,
  Customer,
  CustomerAccount,
  EmployeeInvitation,
  InventoryBatch,
  MedicineCategory,
  MedicineMaster,
  PaymentMode,
  PharmacyStore,
  StockMovement,
  UserProfile,
  UserRole,
} from '../types/pharmacy.ts';
import {
  ApiClientError,
  ApiSessionConfig,
  BackendInvoiceRecord,
  generateIdempotencyKey,
} from './customerApi.ts';
import { resolveApiUrl } from './apiConfig.ts';

export interface ActiveTenantMembership {
  tenantId: string;
  userId: string;
  role: UserRole;
  status: 'active' | 'invited' | 'deactivated' | 'suspended';
  assignedBranchIds: string[];
  permissions?: string[];
  permissionOverrides?: {
    granted?: string[];
    revoked?: string[];
  };
  name?: string;
  email?: string;
  phone?: string;
  tenantName?: string;
}

export interface InactiveTenantMembership {
  tenantId: string;
  tenantName?: string;
  role: UserRole;
  status: 'suspended' | 'deactivated' | string;
}

export interface JoiningCodePreview {
  valid: true;
  pharmacyName: string;
  assignedRole: UserRole;
  assignedRoleLabel: string;
  assignedBranches: Array<{ id: string; name: string }>;
  maskedEmail: string;
  expiresAt: string;
}

async function workspaceRequest<T>(
  session: Pick<ApiSessionConfig, 'bearerToken' | 'appCheckToken'> & {
    tenantId?: string;
    branchId?: string;
  },
  path: string,
  init: RequestInit & { idempotencyKey?: string; omitTenantHeader?: boolean } = {}
): Promise<T> {
  if (!session.bearerToken) {
    throw new ApiClientError(
      401,
      'Authentication Required',
      'No Firebase Auth bearer token is configured.'
    );
  }

  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${session.bearerToken}`);
  if (!init.omitTenantHeader && session.tenantId) {
    headers.set('X-Tenant-ID', session.tenantId);
  }
  if (!init.omitTenantHeader && session.branchId) {
    headers.set('X-Branch-ID', session.branchId);
  }
  if (session.appCheckToken) {
    headers.set('X-Firebase-AppCheck', session.appCheckToken);
  }
  if (init.idempotencyKey) {
    headers.set('X-Idempotency-Key', init.idempotencyKey);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(resolveApiUrl(path), { ...init, headers });
  const ct = response.headers.get('content-type') || '';
  const payload = ct.includes('json') ? await response.json() : { detail: await response.text() };

  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      payload?.title || `HTTP ${response.status}`,
      payload?.detail || payload?.message || 'Workspace request failed',
      payload?.errors
    );
  }

  return payload as T;
}

const VALID_CATEGORIES = new Set<MedicineCategory>([
  'Tablet',
  'Capsule',
  'Syrup',
  'Injection',
  'Ointment',
  'Drops',
  'Inhaler',
  'Powder',
  'Surgical',
]);

export function mapApiTenantToStore(t: any, fallbackBranchName = 'Main Store'): PharmacyStore {
  return {
    id: String(t.id || ''),
    name: String(t.name || 'My Pharmacy'),
    branchName: fallbackBranchName,
    address: String(t.address || ''),
    city: String(t.city || ''),
    state: String(t.state || ''),
    pincode: String(t.pincode || ''),
    phone: String(t.contactPhone || t.phone || ''),
    email: String(t.contactEmail || t.email || ''),
    dlNumber20B: String(t.dlNumber20B || ''),
    dlNumber21B: String(t.dlNumber21B || ''),
    gstin: String(t.gstin || ''),
    fssaiNumber: String(t.fssaiNumber || ''),
    invoicePrefix: String(t.invoicePrefix || 'INV'),
    thermalPrinter: t.thermalPrinter !== undefined ? Boolean(t.thermalPrinter) : true,
    defaultDiscountPercent: Number(t.defaultDiscountPercent ?? 0),
  };
}

export function mapApiMedicineToUi(m: any): MedicineMaster {
  const cat = VALID_CATEGORIES.has(m.category) ? (m.category as MedicineCategory) : 'Tablet';
  return {
    id: m.id,
    brandName: m.name || '',
    saltComposition: m.genericName || '',
    manufacturer: m.brand || '',
    category: cat,
    schedule: m.prescriptionRequired ? 'Schedule H' : 'OTC',
    rackLocation: m.rackLocation || 'Rack A-1',
    packSize: m.packSize || '10 Tablets',
    hsnCode: m.hsnCode || '300490',
    gstSlab: Number(m.gstRate ?? 12),
    prescriptionRequired: Boolean(m.prescriptionRequired),
    minStockLevel: Number(m.minStockThreshold ?? 10),
    dosageForm: m.dosageForm,
    strength: m.strength,
    uom: m.uom,
    barcode: m.barcode || undefined,
    description: m.description || undefined,
    status: m.status || 'active',
    createdBy: m.createdBy,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

export function mapUiMedicineToApiCreate(med: Omit<MedicineMaster, 'id'>) {
  return {
    name: med.brandName.trim(),
    genericName: med.saltComposition.trim(),
    brand: (med.manufacturer || 'Standard Pharma').trim(),
    category: med.category || 'Tablet',
    dosageForm: (med.dosageForm || med.category || 'tablet').toLowerCase(),
    strength: (med.strength || med.brandName.split(' ').slice(-1)[0] || 'Standard').trim(),
    packSize: (med.packSize || '10 Tablets').trim(),
    uom: (med.uom || 'strip').trim(),
    hsnCode: (med.hsnCode || '300490').trim(),
    gstRate: Number(med.gstSlab ?? 12),
    barcode: med.barcode?.trim() || null,
    prescriptionRequired: Boolean(med.prescriptionRequired),
    minStockThreshold: Math.max(0, Math.round(Number(med.minStockLevel ?? 10))),
    description: med.description?.trim() || null,
    status: (med.status === 'inactive' ? 'inactive' : 'active') as 'active' | 'inactive',
  };
}

export function mapApiBatchToUi(b: any): InventoryBatch {
  return {
    id: b.id,
    medicineId: b.medicineId,
    brandName: b.medicineName || '',
    saltComposition: b.genericName || '',
    batchNumber: b.batchNumber || '',
    expiryDate: b.expiryDate || '',
    mfgDate: b.manufacturingDate || undefined,
    packSize: b.packSize || 'Strip',
    mrp: Number(b.mrp || 0),
    ptr: Number(b.purchasePrice || 0),
    sellingPrice: Number(b.sellingPrice ?? b.mrp ?? 0),
    currentStock: Number(b.currentStock ?? 0),
    quantityReceived: b.quantityReceived !== undefined ? Number(b.quantityReceived) : undefined,
    freeQuantity: b.freeQuantity !== undefined ? Number(b.freeQuantity) : undefined,
    supplierId: b.supplierId || undefined,
    supplierName: b.supplierName || undefined,
    purchaseReferenceId: b.purchaseReferenceId || undefined,
    rackLocation: b.rackLocation || 'Main Shelf',
    barcode: b.barcode || undefined,
    status: b.status || 'normal',
    branchId: b.branchId || 'main',
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

export function mapApiMovementToUi(m: any): StockMovement {
  return {
    id: m.id,
    tenantId: m.tenantId,
    branchId: m.branchId || 'main',
    medicineId: m.medicineId,
    batchId: m.batchId,
    batchNumber: m.batchNumber || '',
    medicineName: m.medicineName || '',
    movementType: m.movementType,
    quantityChange: Number(m.quantityChange || 0),
    previousQuantity: Number(m.previousQuantity ?? 0),
    newQuantity: Number(m.newQuantity ?? 0),
    referenceType: m.referenceType,
    referenceId: m.referenceId,
    reason: m.reason,
    performedBy: m.performedBy || 'System',
    timestamp: m.timestamp,
  };
}

export function mapApiCustomerToUi(c: CustomerAccount): Customer {
  return {
    id: c.id,
    name: c.name || '',
    phone: c.phone || '',
    alternatePhone: c.alternatePhone ?? null,
    email: c.email ?? null,
    customerType: c.customerType,
    address: c.address ?? undefined,
    city: c.city ?? undefined,
    state: c.state ?? undefined,
    pincode: c.pincode ?? undefined,
    dateOfBirth: c.dateOfBirth ?? undefined,
    gender: c.gender ?? undefined,
    doctorName: c.preferredDoctorName ?? undefined,
    allergies: c.allergies ?? undefined,
    chronicConditions: c.chronicConditions ?? undefined,
    gstin: c.gstin ?? undefined,
    creditEnabled: c.creditEnabled,
    creditLimit: c.creditLimit ?? undefined,
    creditTermsDays: c.creditTermsDays,
    khataBalance: Number(c.currentOutstandingBalance ?? 0),
    advanceBalance: c.advanceBalance ?? undefined,
    status: c.status,
    isArchived: c.isArchived,
    totalVisits: Number(c.totalVisits ?? 0),
    totalPurchased: Number(c.totalPurchases ?? 0),
    totalPayments: c.totalPayments ?? undefined,
    lastVisit: String(c.lastPurchaseDate || c.updatedAt || c.createdAt || '').split('T')[0],
    lastPaymentDate: c.lastPaymentDate ?? null,
    notes: c.notes ?? undefined,
  };
}

export function mapApiInvoiceToUi(inv: BackendInvoiceRecord & Record<string, any>): BillInvoice {
  const items = Array.isArray(inv.items)
    ? inv.items.map((item: any) => ({
        batchId: item.batchId,
        medicineId: item.medicineId,
        brandName: item.medicineName || item.brandName || '',
        saltComposition: item.saltComposition || '',
        batchNumber: item.batchNumber || '',
        expiryDate: item.expiryDate || '',
        packSize: item.packSize || 'Strip',
        mrp: Number(item.mrp ?? item.unitPrice ?? 0),
        discountPercent: Number(item.discountPercent ?? 0),
        gstSlab: Number(item.gstRate ?? 12),
        quantity: Number(item.quantity ?? 1),
        availableStock: Number(item.availableStock ?? item.quantity ?? 0),
        schedule: (item.schedule || 'OTC') as BillInvoice['items'][number]['schedule'],
      }))
    : [];

  const payments = Array.isArray(inv.payments) ? inv.payments : [];
  const primaryMode: PaymentMode =
    (inv.paymentMode as PaymentMode) ||
    (payments[0]?.mode as PaymentMode) ||
    ((inv.balanceDue || 0) > 0 && (inv.amountPaid || 0) === 0 ? 'khata_credit' : 'cash');

  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    timestamp: inv.createdAt || new Date().toISOString(),
    branchId: inv.branchId || 'main',
    customerId: inv.customerId,
    customerName: inv.customer?.name || 'Walk-in Customer',
    customerPhone: inv.customer?.phone || '',
    doctorName: inv.customer?.doctorName,
    doctorRegNumber: inv.customer?.doctorRegNumber,
    items,
    subtotal: Number(inv.subtotal || 0),
    totalDiscount: Number(inv.totalDiscount || 0),
    taxableAmount: Number(inv.taxableAmount || 0),
    cgst: Number(inv.cgst || 0),
    sgst: Number(inv.sgst || 0),
    igst: Number(inv.igst || 0),
    roundOff: Number(inv.roundOff || 0),
    grandTotal: Number(inv.grandTotal || 0),
    amountPaid: Number(inv.amountPaid || 0),
    khataCreditAmount: inv.khataCreditAmount !== undefined ? Number(inv.khataCreditAmount) : undefined,
    balanceDue: Number(inv.balanceDue || 0),
    creditTermsDays: inv.creditTermsDays as BillInvoice['creditTermsDays'],
    dueDate: inv.dueDate,
    paymentStatus: inv.paymentStatus || 'paid',
    payments,
    paymentMode: primaryMode,
    status: inv.status || 'completed',
    cashierName: inv.cashierName || inv.createdByName || inv.createdBy || 'Staff',
    returns: Array.isArray(inv.returns) ? inv.returns : undefined,
    notes: inv.notes,
  };
}

export function mapApiMemberToUserProfile(m: any): UserProfile {
  return {
    id: m.userId || m.id,
    name: m.name || m.email || 'Team Member',
    email: m.email || '',
    phone: m.phone || '',
    role: m.role || 'cashier',
    storeId: m.tenantId || '',
    status: m.status || 'active',
    assignedBranchIds: Array.isArray(m.assignedBranchIds) ? m.assignedBranchIds : ['main'],
    permissions: Array.isArray(m.permissions) ? m.permissions : undefined,
    permissionOverrides: m.permissionOverrides,
  };
}

export interface CreateTenantPayload {
  tenantId?: string;
  name: string;
  legalName?: string;
  dlNumber20B: string;
  dlNumber21B: string;
  gstin?: string;
  pan?: string;
  fssaiNumber?: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  contactPhone: string;
  contactEmail: string;
  invoicePrefix?: string;
  thermalPrinter?: boolean;
  defaultDiscountPercent?: number;
  idempotencyKey?: string;
  ownerName?: string;
}

async function publicWorkspaceRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(resolveApiUrl(path), { ...init, headers });
  const ct = response.headers.get('content-type') || '';
  const payload = ct.includes('json') ? await response.json() : { detail: await response.text() };
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      payload?.title || `HTTP ${response.status}`,
      payload?.detail || payload?.message || 'Request failed',
      payload?.errors
    );
  }
  return payload as T;
}

export const workspaceApi = {
  async createTenant(
    auth: Pick<ApiSessionConfig, 'bearerToken' | 'appCheckToken'>,
    payload: CreateTenantPayload,
    idempotencyKey = payload.idempotencyKey || generateIdempotencyKey('tenant_create')
  ) {
    const res = await workspaceRequest<{
      success: boolean;
      data: { tenant: any; branch: any; membership: ActiveTenantMembership };
    }>(auth, '/api/v1/tenants', {
      method: 'POST',
      omitTenantHeader: true,
      idempotencyKey,
      body: JSON.stringify({ ...payload, idempotencyKey }),
    });
    return res.data;
  },

  async validateJoiningCode(joiningCode: string): Promise<JoiningCodePreview> {
    const res = await publicWorkspaceRequest<{
      success: boolean;
      data: JoiningCodePreview;
    }>('/api/v1/joining-codes/validate', {
      method: 'POST',
      body: JSON.stringify({ joiningCode }),
    });
    return res.data;
  },

  async redeemJoiningCode(
    auth: Pick<ApiSessionConfig, 'bearerToken' | 'appCheckToken'>,
    joiningCode: string
  ): Promise<ActiveTenantMembership> {
    const res = await workspaceRequest<{
      success: boolean;
      data: ActiveTenantMembership;
    }>(auth, '/api/v1/joining-codes/redeem', {
      method: 'POST',
      omitTenantHeader: true,
      body: JSON.stringify({ joiningCode }),
    });
    return res.data;
  },

  async getTenant(session: ApiSessionConfig, tenantId = session.tenantId) {
    const res = await workspaceRequest<{ success: boolean; data: any }>(
      session,
      `/api/v1/tenants/${encodeURIComponent(tenantId)}`
    );
    return res.data;
  },

  async updateTenant(
    session: ApiSessionConfig,
    patch: Partial<Omit<CreateTenantPayload, 'tenantId'>>
  ) {
    const res = await workspaceRequest<{ success: boolean; data: any }>(
      session,
      `/api/v1/tenants/${encodeURIComponent(session.tenantId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }
    );
    return res.data;
  },

  async acceptInvitation(
    auth: Pick<ApiSessionConfig, 'bearerToken' | 'appCheckToken'>,
    payload: { tenantId: string; token: string }
  ): Promise<ActiveTenantMembership> {
    const res = await workspaceRequest<{ success: boolean; data: ActiveTenantMembership }>(
      auth,
      '/api/v1/invitations/accept',
      {
        method: 'POST',
        omitTenantHeader: true,
        body: JSON.stringify(payload),
      }
    );
    return res.data;
  },

  // Medicines
  async listMedicines(session: ApiSessionConfig, limit = 100): Promise<MedicineMaster[]> {
    const res = await workspaceRequest<{ success: boolean; data: any[] }>(
      session,
      `/api/v1/medicines?limit=${limit}`
    );
    return (res.data || []).map(mapApiMedicineToUi);
  },

  async createMedicine(
    session: ApiSessionConfig,
    med: Omit<MedicineMaster, 'id'>
  ): Promise<MedicineMaster> {
    const res = await workspaceRequest<{ success: boolean; data: any }>(
      session,
      '/api/v1/medicines',
      {
        method: 'POST',
        body: JSON.stringify(mapUiMedicineToApiCreate(med)),
      }
    );
    return mapApiMedicineToUi(res.data);
  },

  async updateMedicine(
    session: ApiSessionConfig,
    id: string,
    patch: Partial<MedicineMaster>
  ): Promise<MedicineMaster> {
    const payload: Record<string, unknown> = {};
    if (patch.brandName !== undefined) payload.name = patch.brandName;
    if (patch.saltComposition !== undefined) payload.genericName = patch.saltComposition;
    if (patch.manufacturer !== undefined) payload.brand = patch.manufacturer;
    if (patch.category !== undefined) payload.category = patch.category;
    if (patch.packSize !== undefined) payload.packSize = patch.packSize;
    if (patch.hsnCode !== undefined) payload.hsnCode = patch.hsnCode;
    if (patch.gstSlab !== undefined) payload.gstRate = patch.gstSlab;
    if (patch.prescriptionRequired !== undefined) payload.prescriptionRequired = patch.prescriptionRequired;
    if (patch.minStockLevel !== undefined) payload.minStockThreshold = patch.minStockLevel;
    if (patch.barcode !== undefined) payload.barcode = patch.barcode || null;
    if (patch.status !== undefined) payload.status = patch.status;

    const res = await workspaceRequest<{ success: boolean; data: any }>(
      session,
      `/api/v1/medicines/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
    return mapApiMedicineToUi(res.data);
  },

  async archiveMedicine(
    session: ApiSessionConfig,
    id: string,
    archive = true
  ): Promise<MedicineMaster> {
    const res = await workspaceRequest<{ success: boolean; data: any }>(
      session,
      `/api/v1/medicines/${encodeURIComponent(id)}/archive`,
      {
        method: 'PATCH',
        body: JSON.stringify({ archive }),
      }
    );
    return mapApiMedicineToUi(res.data);
  },

  // Inventory & Stock Movements
  async listInventory(session: ApiSessionConfig, limit = 100): Promise<InventoryBatch[]> {
    const res = await workspaceRequest<{ success: boolean; data: any[] }>(
      session,
      `/api/v1/inventory?limit=${limit}`
    );
    return (res.data || []).map(mapApiBatchToUi);
  },

  async listStockMovements(session: ApiSessionConfig, limit = 100): Promise<StockMovement[]> {
    const res = await workspaceRequest<{ success: boolean; data: any[] }>(
      session,
      `/api/v1/inventory/movements?limit=${limit}`
    );
    return (res.data || []).map(mapApiMovementToUi);
  },

  async createOpeningStock(
    session: ApiSessionConfig,
    batch: Omit<InventoryBatch, 'id' | 'status'>
  ) {
    const res = await workspaceRequest<{
      success: boolean;
      data: { batch: any; movement: any };
    }>(session, '/api/v1/inventory/opening-stock', {
      method: 'POST',
      body: JSON.stringify({
        medicineId: batch.medicineId,
        batchNumber: batch.batchNumber,
        manufacturingDate: batch.mfgDate || null,
        expiryDate: batch.expiryDate,
        purchasePrice: batch.ptr,
        mrp: batch.mrp,
        sellingPrice: batch.sellingPrice ?? batch.mrp,
        quantity: batch.currentStock,
        freeQuantity: batch.freeQuantity ?? 0,
        supplierId: batch.supplierId || null,
        supplierName: batch.supplierName || null,
        rackLocation: batch.rackLocation || null,
        barcode: batch.barcode || null,
        branchId: batch.branchId || session.branchId,
      }),
    });
    return {
      batch: mapApiBatchToUi(res.data.batch),
      movement: mapApiMovementToUi(res.data.movement),
    };
  },

  async adjustStock(
    session: ApiSessionConfig,
    params: {
      batchId: string;
      movementType: 'MANUAL_ADJUSTMENT' | 'DAMAGE' | 'EXPIRY' | 'SALE_RETURN' | 'PURCHASE_RETURN';
      quantityChange: number;
      reason: string;
    }
  ) {
    const res = await workspaceRequest<{ success: boolean; data: any }>(
      session,
      '/api/v1/inventory/adjustments',
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    );
    return res.data;
  },

  // Invoices & Counter Billing Lifecycle
  async listInvoices(session: ApiSessionConfig, limit = 50): Promise<BillInvoice[]> {
    const res = await workspaceRequest<{ success: boolean; data: BackendInvoiceRecord[] }>(
      session,
      `/api/v1/invoices?limit=${limit}`
    );
    return (res.data || []).map((inv) => mapApiInvoiceToUi(inv));
  },

  async cancelInvoice(
    session: ApiSessionConfig,
    invoiceId: string,
    reason: string,
    idempotencyKey = generateIdempotencyKey('inv_cancel')
  ): Promise<BillInvoice> {
    const res = await workspaceRequest<{ success: boolean; data: BackendInvoiceRecord }>(
      session,
      `/api/v1/invoices/${encodeURIComponent(invoiceId)}/cancel`,
      {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify({ reason, idempotencyKey }),
      }
    );
    return mapApiInvoiceToUi(res.data);
  },

  async recordInvoicePayment(
    session: ApiSessionConfig,
    invoiceId: string,
    payment: { mode: PaymentMode; amount: number; referenceNumber?: string },
    idempotencyKey = generateIdempotencyKey('inv_pay')
  ): Promise<BillInvoice> {
    const res = await workspaceRequest<{ success: boolean; data: BackendInvoiceRecord }>(
      session,
      `/api/v1/invoices/${encodeURIComponent(invoiceId)}/payments`,
      {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify({ ...payment, idempotencyKey }),
      }
    );
    return mapApiInvoiceToUi(res.data);
  },

  async processSalesReturn(
    session: ApiSessionConfig,
    invoiceId: string,
    payload: {
      items: Array<{ batchId: string; quantity: number; reason?: string; restock?: boolean }>;
      reason: string;
    },
    idempotencyKey = generateIdempotencyKey('inv_ret')
  ) {
    const res = await workspaceRequest<{ success: boolean; data: any }>(
      session,
      `/api/v1/invoices/${encodeURIComponent(invoiceId)}/returns`,
      {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify({ ...payload, idempotencyKey }),
      }
    );
    return res.data;
  },

  // Employees & Invitations
  async listEmployees(session: ApiSessionConfig): Promise<UserProfile[]> {
    const res = await workspaceRequest<{ success: boolean; data: any[] }>(
      session,
      `/api/v1/tenants/${encodeURIComponent(session.tenantId)}/employees`
    );
    return (res.data || []).map(mapApiMemberToUserProfile);
  },

  async listInvitations(session: ApiSessionConfig): Promise<EmployeeInvitation[]> {
    const res = await workspaceRequest<{ success: boolean; data: EmployeeInvitation[] }>(
      session,
      `/api/v1/tenants/${encodeURIComponent(session.tenantId)}/invitations`
    );
    return res.data || [];
  },

  async createInvitation(
    session: ApiSessionConfig,
    payload: {
      email: string;
      name: string;
      phone?: string;
      role: UserRole;
      assignedBranchIds: string[];
      permissionOverrides?: { granted?: string[]; revoked?: string[] };
    }
  ): Promise<{ invitation: EmployeeInvitation; joiningCode: string; inviteLink: string }> {
    const res = await workspaceRequest<{
      success: boolean;
      data: EmployeeInvitation;
      joiningCode?: string;
      inviteLink?: string;
    }>(session, `/api/v1/tenants/${encodeURIComponent(session.tenantId)}/invitations`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return {
      invitation: res.data,
      joiningCode: res.joiningCode || res.data.joiningCode || '',
      inviteLink: res.inviteLink || '/join-pharmacy',
    };
  },

  async regenerateInvitation(session: ApiSessionConfig, invitationId: string): Promise<{
    invitation: EmployeeInvitation;
    joiningCode: string;
    inviteLink?: string;
  }> {
    const res = await workspaceRequest<{
      success: boolean;
      data: EmployeeInvitation;
      joiningCode?: string;
      inviteLink?: string;
    }>(
      session,
      `/api/v1/tenants/${encodeURIComponent(session.tenantId)}/invitations/${encodeURIComponent(
        invitationId
      )}/regenerate`,
      { method: 'POST' }
    );
    return {
      invitation: res.data,
      joiningCode: res.joiningCode || res.data.joiningCode || '',
      inviteLink: res.inviteLink,
    };
  },

  async resendInvitation(session: ApiSessionConfig, invitationId: string) {
    return this.regenerateInvitation(session, invitationId);
  },

  async revokeInvitation(session: ApiSessionConfig, invitationId: string) {
    const res = await workspaceRequest<{ success: boolean; data: EmployeeInvitation }>(
      session,
      `/api/v1/tenants/${encodeURIComponent(session.tenantId)}/invitations/${encodeURIComponent(
        invitationId
      )}/revoke`,
      { method: 'POST' }
    );
    return res.data;
  },

  async cancelInvitation(session: ApiSessionConfig, invitationId: string) {
    const res = await workspaceRequest<{ success: boolean; data: EmployeeInvitation }>(
      session,
      `/api/v1/tenants/${encodeURIComponent(session.tenantId)}/invitations/${encodeURIComponent(
        invitationId
      )}`,
      { method: 'DELETE' }
    );
    return res.data;
  },

  async updateEmployeeRole(session: ApiSessionConfig, userId: string, role: UserRole) {
    const res = await workspaceRequest<{ success: boolean; data: any }>(
      session,
      `/api/v1/tenants/${encodeURIComponent(session.tenantId)}/employees/${encodeURIComponent(
        userId
      )}/role`,
      { method: 'PATCH', body: JSON.stringify({ role }) }
    );
    return mapApiMemberToUserProfile(res.data);
  },

  async updateEmployeeBranches(
    session: ApiSessionConfig,
    userId: string,
    assignedBranchIds: string[]
  ) {
    const res = await workspaceRequest<{ success: boolean; data: any }>(
      session,
      `/api/v1/tenants/${encodeURIComponent(session.tenantId)}/employees/${encodeURIComponent(
        userId
      )}/branches`,
      { method: 'PATCH', body: JSON.stringify({ assignedBranchIds }) }
    );
    return mapApiMemberToUserProfile(res.data);
  },

  async updateEmployeePermissions(
    session: ApiSessionConfig,
    userId: string,
    permissionOverrides: { granted?: string[]; revoked?: string[] }
  ) {
    const res = await workspaceRequest<{ success: boolean; data: any }>(
      session,
      `/api/v1/tenants/${encodeURIComponent(session.tenantId)}/employees/${encodeURIComponent(
        userId
      )}/permissions`,
      { method: 'PATCH', body: JSON.stringify({ permissionOverrides }) }
    );
    return mapApiMemberToUserProfile(res.data);
  },

  async updateEmployeeStatus(
    session: ApiSessionConfig,
    userId: string,
    status: 'active' | 'suspended' | 'deactivated'
  ) {
    const res = await workspaceRequest<{ success: boolean; data: any }>(
      session,
      `/api/v1/tenants/${encodeURIComponent(session.tenantId)}/employees/${encodeURIComponent(
        userId
      )}/status`,
      { method: 'PATCH', body: JSON.stringify({ status }) }
    );
    return mapApiMemberToUserProfile(res.data);
  },
};
