import crypto from 'node:crypto';
import { adminAuth, firestore } from '../lib/firebaseAdmin';
import { BadRequestError, NotFoundError, ConflictError } from '../lib/errors';
import { UserRole } from '../types/express';
import { logger } from '../lib/logger';
import {
  getDefaultRolePermissions,
  getTestMemberships,
  hasRegisteredTestBranches,
  MembershipRecord,
  setTestMembership,
} from '../middleware/tenantAuthorization';
import { sanitizeGrantedPermissions } from '../lib/permissions';
import { AuditService } from './auditService';
import { BranchService } from './branchService';

export interface CreateTenantInput {
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

export interface UpdateTenantInput {
  name?: string;
  legalName?: string;
  dlNumber20B?: string;
  dlNumber21B?: string;
  gstin?: string | null;
  pan?: string | null;
  fssaiNumber?: string | null;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  contactPhone?: string;
  contactEmail?: string;
  invoicePrefix?: string;
  thermalPrinter?: boolean;
  defaultDiscountPercent?: number;
}

export interface InviteMemberInput {
  userId: string;
  email: string;
  name?: string;
  role: UserRole;
  assignedBranchIds: string[];
  permissions?: string[];
}

const testTenantStore = new Map<string, Record<string, any>>();
const testTenantIdempotency = new Map<
  string,
  { tenant: Record<string, any>; branch: Record<string, any>; membership: MembershipRecord }
>();

export function setTestTenant(tenantId: string, data: Record<string, any>) {
  testTenantStore.set(tenantId, data);
}

export function getTestTenant(tenantId: string): Record<string, any> | undefined {
  return testTenantStore.get(tenantId);
}

export function clearTestTenants() {
  testTenantStore.clear();
  testTenantIdempotency.clear();
}

function generateTenantSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base || 'pharmacy'}-${suffix}`;
}

export class TenantService {
  /**
   * Onboards a new pharmacy tenant in Cloud Firestore:
   * 1. Creates top-level `tenants/{tenantId}` document.
   * 2. Creates the default primary branch `tenants/{tenantId}/branches/main`.
   * 3. Creates the owner membership `tenants/{tenantId}/memberships/{ownerId}`.
   * 4. Updates the user's global registry in `users/{ownerId}`.
   * Supports idempotent retries when `idempotencyKey` is supplied by the same owner.
   */
  public static async createTenant(ownerId: string, input: CreateTenantInput) {
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    const idempotencyKey = input.idempotencyKey?.trim();
    const idempMapKey = idempotencyKey ? `${ownerId}:${idempotencyKey}` : null;

    if (idempMapKey && isTestEnv && testTenantIdempotency.has(idempMapKey)) {
      return { ...testTenantIdempotency.get(idempMapKey)!, idempotentReplay: true };
    }

    const resolvedTenantId = input.tenantId?.trim()
      ? input.tenantId.trim().toLowerCase()
      : generateTenantSlug(input.name);

    const now = new Date().toISOString();

    const invoicePrefix = (
      input.invoicePrefix ||
      input.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3) ||
      'INV'
    ).toUpperCase();

    const tenantData = {
      id: resolvedTenantId,
      name: input.name.trim(),
      legalName: (input.legalName || input.name).trim(),
      dlNumber20B: input.dlNumber20B.trim(),
      dlNumber21B: input.dlNumber21B.trim(),
      gstin: input.gstin?.trim() || null,
      pan: input.pan?.trim() || null,
      fssaiNumber: input.fssaiNumber?.trim() || null,
      address: input.address.trim(),
      city: input.city.trim(),
      state: input.state.trim(),
      pincode: input.pincode.trim(),
      contactPhone: input.contactPhone.trim(),
      contactEmail: input.contactEmail.trim(),
      invoicePrefix,
      thermalPrinter: input.thermalPrinter ?? true,
      defaultDiscountPercent: input.defaultDiscountPercent ?? 0,
      ownerId,
      status: 'active',
      plan: 'standard',
      createdAt: now,
      updatedAt: now,
    };

    const mainBranchData = {
      id: 'main',
      tenantId: resolvedTenantId,
      name: `${input.name.trim()} (Main Store)`,
      branchCode: 'MAIN',
      branchType: 'MAIN',
      isMain: true,
      isPrimary: true,
      dlNumber20B: input.dlNumber20B.trim(),
      dlNumber21B: input.dlNumber21B.trim(),
      gstin: input.gstin?.trim() || null,
      address: input.address.trim(),
      city: input.city.trim(),
      state: input.state.trim(),
      pincode: input.pincode.trim(),
      phone: input.contactPhone.trim(),
      email: input.contactEmail.trim(),
      managerUserId: ownerId,
      operatingHours: '09:00 AM - 10:00 PM',
      timezone: 'Asia/Kolkata',
      transferPolicy: {
        requireApproval: true,
        allowSelfApproval: false,
        approvalThresholdAmount: 25000,
        approvalThresholdQty: 500,
        defaultPriceBasis: 'PTR',
      },
      status: 'ACTIVE',
      createdBy: ownerId,
      updatedBy: ownerId,
      createdAt: now,
      updatedAt: now,
    };

    const ownerMembership: MembershipRecord = {
      tenantId: resolvedTenantId,
      userId: ownerId,
      role: 'owner',
      status: 'active',
      assignedBranchIds: ['main', '*'],
      permissions: ['*'],
      email: input.contactEmail.trim(),
      name: (input.ownerName || `${input.name.trim()} Owner`).trim(),
      createdAt: now,
      updatedAt: now,
    };

    if (isTestEnv) {
      if (testTenantStore.has(resolvedTenantId)) {
        throw new ConflictError(`Pharmacy with ID '${resolvedTenantId}' already exists.`);
      }
      testTenantStore.set(resolvedTenantId, tenantData);
      setTestMembership(resolvedTenantId, ownerId, ownerMembership);
      if (idempMapKey) {
        testTenantIdempotency.set(idempMapKey, {
          tenant: tenantData,
          branch: mainBranchData,
          membership: ownerMembership,
        });
      }
    } else {
      const db = firestore();

      if (idempotencyKey) {
        const idempHash = crypto
          .createHash('sha256')
          .update(`${ownerId}:${idempotencyKey}`)
          .digest('hex');
        const idempRef = db.collection('users').doc(ownerId).collection('provision_keys').doc(idempHash);

        const replayResult = await db.runTransaction(async (tx) => {
          const idempSnap = await tx.get(idempRef);
          if (idempSnap.exists) {
            const existingTenantId = String(idempSnap.data()?.tenantId || '');
            if (existingTenantId) {
              const existingTenantRef = db.collection('tenants').doc(existingTenantId);
              const [tSnap, bSnap, mSnap] = await Promise.all([
                tx.get(existingTenantRef),
                tx.get(existingTenantRef.collection('branches').doc('main')),
                tx.get(existingTenantRef.collection('memberships').doc(ownerId)),
              ]);
              if (tSnap.exists && mSnap.exists) {
                return {
                  tenant: tSnap.data(),
                  branch: bSnap.data(),
                  membership: mSnap.data() as MembershipRecord,
                  idempotentReplay: true,
                };
              }
            }
          }

          const tenantRef = db.collection('tenants').doc(resolvedTenantId);
          const existingSnap = await tx.get(tenantRef);
          if (existingSnap.exists) {
            throw new ConflictError(`Pharmacy with ID '${resolvedTenantId}' already exists.`);
          }

          tx.set(tenantRef, tenantData);
          tx.set(tenantRef.collection('branches').doc('main'), mainBranchData);
          tx.set(tenantRef.collection('memberships').doc(ownerId), ownerMembership);
          tx.set(
            db.collection('users').doc(ownerId),
            {
              uid: ownerId,
              lastActiveTenantId: resolvedTenantId,
              updatedAt: now,
            },
            { merge: true }
          );
          tx.set(idempRef, {
            tenantId: resolvedTenantId,
            createdAt: now,
          });
          return null;
        });

        if (replayResult) {
          return replayResult;
        }
      } else {
        const tenantRef = db.collection('tenants').doc(resolvedTenantId);
        const existingSnap = await tenantRef.get();
        if (existingSnap.exists) {
          throw new ConflictError(`Pharmacy with ID '${resolvedTenantId}' already exists.`);
        }

        const batch = db.batch();
        batch.set(tenantRef, tenantData);
        batch.set(tenantRef.collection('branches').doc('main'), mainBranchData);
        batch.set(tenantRef.collection('memberships').doc(ownerId), ownerMembership);

        const userRef = db.collection('users').doc(ownerId);
        batch.set(
          userRef,
          {
            uid: ownerId,
            lastActiveTenantId: resolvedTenantId,
            updatedAt: now,
          },
          { merge: true }
        );

        await batch.commit();
      }
    }

    await AuditService.log({
      tenantId: resolvedTenantId,
      branchId: 'main',
      category: 'auth',
      severity: 'info',
      actingUserId: ownerId,
      action: 'tenant.provisioned',
      metadata: {
        name: input.name,
        city: input.city,
        state: input.state,
      },
    });

    logger.info({ tenantId: resolvedTenantId, ownerId }, 'Successfully provisioned new pharmacy tenant in Cloud Firestore');

    return {
      tenant: tenantData,
      branch: mainBranchData,
      membership: ownerMembership,
      idempotentReplay: false,
    };
  }

  /**
   * Retrieves tenant profile by ID.
   */
  public static async getTenant(tenantId: string) {
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    if (isTestEnv) {
      const t = testTenantStore.get(tenantId);
      if (!t) {
        throw new NotFoundError(`Pharmacy tenant '${tenantId}' does not exist.`);
      }
      return t;
    }

    const db = firestore();
    const doc = await db.collection('tenants').doc(tenantId).get();
    if (!doc.exists) {
      throw new NotFoundError(`Pharmacy tenant '${tenantId}' does not exist.`);
    }
    return doc.data();
  }

  /**
   * Updates pharmacy tenant profile and billing settings.
   */
  public static async updateTenant(
    tenantId: string,
    ownerId: string,
    input: UpdateTenantInput
  ) {
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    const now = new Date().toISOString();

    const patch: Record<string, unknown> = { updatedAt: now };
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.legalName !== undefined) patch.legalName = input.legalName.trim();
    if (input.dlNumber20B !== undefined) patch.dlNumber20B = input.dlNumber20B.trim();
    if (input.dlNumber21B !== undefined) patch.dlNumber21B = input.dlNumber21B.trim();
    if (input.gstin !== undefined) patch.gstin = input.gstin ? input.gstin.trim().toUpperCase() : null;
    if (input.pan !== undefined) patch.pan = input.pan ? input.pan.trim().toUpperCase() : null;
    if (input.fssaiNumber !== undefined) patch.fssaiNumber = input.fssaiNumber ? input.fssaiNumber.trim() : null;
    if (input.address !== undefined) patch.address = input.address.trim();
    if (input.city !== undefined) patch.city = input.city.trim();
    if (input.state !== undefined) patch.state = input.state.trim();
    if (input.pincode !== undefined) patch.pincode = input.pincode.trim();
    if (input.contactPhone !== undefined) patch.contactPhone = input.contactPhone.trim();
    if (input.contactEmail !== undefined) patch.contactEmail = input.contactEmail.trim();
    if (input.invoicePrefix !== undefined) patch.invoicePrefix = input.invoicePrefix.trim().toUpperCase();
    if (input.thermalPrinter !== undefined) patch.thermalPrinter = Boolean(input.thermalPrinter);
    if (input.defaultDiscountPercent !== undefined) {
      patch.defaultDiscountPercent = Math.max(0, Math.min(50, Number(input.defaultDiscountPercent) || 0));
    }

    let updated: Record<string, any>;
    if (isTestEnv) {
      const existing = testTenantStore.get(tenantId);
      if (!existing) {
        throw new NotFoundError(`Pharmacy tenant '${tenantId}' does not exist.`);
      }
      updated = { ...existing, ...patch };
      testTenantStore.set(tenantId, updated);
    } else {
      const db = firestore();
      const tenantRef = db.collection('tenants').doc(tenantId);
      const snap = await tenantRef.get();
      if (!snap.exists) {
        throw new NotFoundError(`Pharmacy tenant '${tenantId}' does not exist.`);
      }
      await tenantRef.update(patch);
      updated = { ...snap.data(), ...patch };
    }

    await AuditService.log({
      tenantId,
      category: 'security',
      severity: 'info',
      actingUserId: ownerId,
      action: 'tenant.updated',
      metadata: { updatedFields: Object.keys(patch).filter((k) => k !== 'updatedAt') },
    });

    return updated;
  }

  /**
   * Invites or adds an employee to the pharmacy tenant.
   */
  public static async addMember(tenantId: string, invitedBy: string, input: InviteMemberInput) {
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

    if (isTestEnv) {
      const existing = getTestMemberships(tenantId).find((m) => m.userId === input.userId);
      if (existing) {
        throw new ConflictError(`User '${input.userId}' is already a member of this pharmacy.`);
      }
    } else {
      const db = firestore();
      const tenantRef = db.collection('tenants').doc(tenantId);

      // Verify tenant exists
      const tenantDoc = await tenantRef.get();
      if (!tenantDoc.exists) {
        throw new NotFoundError(`Pharmacy tenant '${tenantId}' not found.`);
      }

      const existingSnap = await tenantRef.collection('memberships').doc(input.userId).get();
      if (existingSnap.exists) {
        throw new ConflictError(`User '${input.userId}' is already a member of this pharmacy.`);
      }
    }

    const cleanBranches = (input.assignedBranchIds || [])
      .map((b) => b.trim())
      .filter((b) => b.length > 0);
    if (input.role !== 'owner' && (cleanBranches.length === 0 || cleanBranches.includes('*'))) {
      throw new BadRequestError(
        'Non-owner employees must be assigned to explicit branch IDs; empty or wildcard "*" branch access is prohibited.'
      );
    }

    if (!isTestEnv || hasRegisteredTestBranches(tenantId)) {
      await BranchService.validateBranchesExist(tenantId, cleanBranches);
    }

    const sanitizedPermissions = sanitizeGrantedPermissions(
      input.role,
      input.permissions && input.permissions.length > 0
        ? input.permissions
        : getDefaultRolePermissions(input.role)
    );

    const now = new Date().toISOString();
    const membership: MembershipRecord = {
      tenantId,
      userId: input.userId,
      role: input.role,
      status: 'active',
      assignedBranchIds: cleanBranches.length > 0 ? cleanBranches : ['main'],
      permissions: sanitizedPermissions,
      invitedBy,
      createdAt: now,
      updatedAt: now,
    };

    if (isTestEnv) {
      setTestMembership(tenantId, input.userId, {
        ...membership,
        email: input.email,
        name: input.name || undefined,
      });
    } else {
      await firestore()
        .collection('tenants')
        .doc(tenantId)
        .collection('memberships')
        .doc(input.userId)
        .set({
          ...membership,
          email: input.email,
          name: input.name || null,
        });
    }

    await AuditService.log({
      tenantId,
      actingUserId: invitedBy,
      targetUserId: input.userId,
      action: 'employee.member_added',
      metadata: {
        role: input.role,
        assignedBranchIds: membership.assignedBranchIds,
      },
    });

    logger.info(
      { tenantId, userId: input.userId, role: input.role },
      'Added new employee membership to pharmacy'
    );

    return membership;
  }

  /**
   * Updates employee membership status (active, deactivated, suspended).
   */
  public static async updateMemberStatus(
    tenantId: string,
    targetUserId: string,
    status: 'active' | 'deactivated' | 'suspended',
    actingOwnerId: string
  ) {
    if (targetUserId === actingOwnerId && status !== 'active') {
      throw new BadRequestError('Pharmacy owner account cannot be deactivated.');
    }

    const db = firestore();
    const membershipRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('memberships')
      .doc(targetUserId);

    const doc = await membershipRef.get();
    if (!doc.exists) {
      throw new NotFoundError(`Employee membership '${targetUserId}' not found in this pharmacy.`);
    }

    const memberData = doc.data() as MembershipRecord;
    if (memberData.role === 'owner' && memberData.status === 'active' && status !== 'active') {
      const ownersSnap = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('memberships')
        .where('role', '==', 'owner')
        .where('status', '==', 'active')
        .get();
      if (ownersSnap.size <= 1) {
        throw new BadRequestError('Cannot suspend or remove the last active pharmacy owner.');
      }
    }

    const now = new Date().toISOString();
    await membershipRef.update({
      status,
      updatedAt: now,
      statusUpdatedBy: actingOwnerId,
    });

    let tokensRevoked = false;
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    if (!isTestEnv && (status === 'deactivated' || status === 'suspended')) {
      try {
        await adminAuth().revokeRefreshTokens(targetUserId);
        tokensRevoked = true;
      } catch (err: any) {
        logger.warn(
          { tenantId, targetUserId, err: err?.message },
          'Best-effort Firebase refresh token revocation failed during member status update'
        );
      }
    }

    const actionMap = {
      active: 'employee.reactivated',
      suspended: 'employee.suspended',
      deactivated: 'employee.deactivated',
    } as const;

    await AuditService.log({
      tenantId,
      category: 'auth',
      severity: status === 'active' ? 'info' : 'warning',
      actingUserId: actingOwnerId,
      targetUserId,
      action: actionMap[status],
      metadata: { status, tokensRevoked },
    });

    logger.info(
      { tenantId, targetUserId, status, actingOwnerId, tokensRevoked },
      'Updated employee membership status in Cloud Firestore'
    );

    return {
      userId: targetUserId,
      tenantId,
      status,
      tokensRevoked,
      updatedAt: now,
    };
  }

  /**
   * Lists all employee memberships in a tenant.
   */
  public static async listMembers(tenantId: string) {
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    if (isTestEnv) {
      const { getTestMemberships } = await import('../middleware/tenantAuthorization');
      return getTestMemberships(tenantId);
    }

    const db = firestore();
    const snapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('memberships')
      .get();

    return snapshot.docs.map((doc) => doc.data() as MembershipRecord);
  }
}
