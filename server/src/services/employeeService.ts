import crypto from 'node:crypto';
import { adminAuth, firestore } from '../lib/firebaseAdmin';
import { env } from '../config/env';
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  RateLimitError,
} from '../lib/errors';
import { UserRole } from '../types/express';
import { logger } from '../lib/logger';
import {
  MembershipRecord,
  setTestMembership,
  getTestMemberships,
  hasRegisteredTestBranches,
} from '../middleware/tenantAuthorization';
import { BranchService } from './branchService';
import { getTestTenant } from './tenantService';
import {
  resolveEffectivePermissions,
  validatePermissionOverrides,
  PermissionOverrides,
} from '../lib/permissions';
import { AuditService } from './auditService';

export interface CreateInvitationInput {
  email: string;
  name: string;
  phone?: string;
  role: UserRole;
  assignedBranchIds: string[];
  permissionOverrides?: PermissionOverrides;
}

export type StaffDisplayStatus =
  | 'Invitation Ready'
  | 'Awaiting Account Setup'
  | 'Active'
  | 'Suspended'
  | 'Invitation Expired'
  | 'Invitation Revoked';

export interface InvitationRecord {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  phone?: string | null;
  role: UserRole;
  assignedBranchIds: string[];
  permissionOverrides?: PermissionOverrides;
  // Cryptographic HMAC-SHA256 digests only — raw codes/tokens are never persisted
  tokenHash?: string;
  tokenLast6?: string;
  joiningCodeHash?: string;
  codeLast4?: string;
  // Returned only one-time during create/regenerate/resend, or masked on list
  token?: string;
  joiningCode?: string;
  joiningCodeMasked?: string;
  displayStatus?: StaffDisplayStatus;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled' | 'revoked';
  expiresAt: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  acceptedByUserId?: string;
  acceptedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
}

export interface JoiningCodeLookupRecord {
  codeHash: string;
  tenantId: string;
  invitationId: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled' | 'revoked';
  expiresAt: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ValidatedJoiningCodePreview {
  valid: true;
  pharmacyName: string;
  assignedRole: UserRole;
  assignedRoleLabel: string;
  assignedBranches: Array<{ id: string; name: string }>;
  maskedEmail: string;
  expiresAt: string;
}

const JOINING_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  pharmacist: 'Pharmacist',
  cashier: 'Cashier',
  helper: 'Store Helper',
  auditor: 'Auditor',
};

// In-memory stores for unit test execution
const testInvitations = new Map<string, InvitationRecord>();
const testJoiningCodeLookup = new Map<string, JoiningCodeLookupRecord>();
const activeRedemptionLocks = new Set<string>();
const failedCodeAttempts = new Map<string, { count: number; resetAt: number }>();

const FAILED_CODE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_CODE_ATTEMPTS = 8;

function getJoiningCodePepper(): string {
  return (
    env.JOINING_CODE_HASH_PEPPER ||
    env.FIREBASE_PROJECT_ID ||
    'pharmadesk-joining-code-pepper'
  );
}

export function hashSecretValue(raw: string): string {
  return crypto.createHmac('sha256', getJoiningCodePepper()).update(raw).digest('hex');
}

export function normalizeJoiningCode(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.startsWith('PDK') && cleaned.length === 11) {
    const body = cleaned.slice(3);
    return `PDK-${body.slice(0, 4)}-${body.slice(4, 8)}`;
  }
  if (cleaned.length === 8) {
    return `PDK-${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
  }
  return input.trim().toUpperCase();
}

export function maskEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) return '***';
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const prefix = local.length >= 3 ? local.slice(0, 2) : local.slice(0, 1);
  return `${prefix}***@${domain}`;
}

export function setTestInvitation(invitation: InvitationRecord) {
  const persisted: InvitationRecord = { ...invitation };
  const rawToken = persisted.token;
  const rawCode = persisted.joiningCode;

  if (rawToken && !persisted.tokenHash) {
    persisted.tokenHash = hashSecretValue(rawToken);
    persisted.tokenLast6 = rawToken.slice(-6);
  }
  if (rawCode && !persisted.joiningCodeHash) {
    const normalized = normalizeJoiningCode(rawCode);
    persisted.joiningCodeHash = hashSecretValue(normalized);
    persisted.codeLast4 = normalized.slice(-4);
  }

  // Never persist raw token or raw joining code in stored record
  delete persisted.token;
  delete persisted.joiningCode;

  testInvitations.set(`${persisted.tenantId}:${persisted.id}`, persisted);
  if (persisted.tokenHash) {
    testInvitations.set(`${persisted.tenantId}:hash:${persisted.tokenHash}`, persisted);
  }
  if (persisted.joiningCodeHash) {
    testJoiningCodeLookup.set(persisted.joiningCodeHash, {
      codeHash: persisted.joiningCodeHash,
      tenantId: persisted.tenantId,
      invitationId: persisted.id,
      status: persisted.status,
      expiresAt: persisted.expiresAt,
      createdAt: persisted.createdAt,
      updatedAt: persisted.updatedAt,
    });
  }
}

export function getRawStoredTestInvitations(tenantId: string): InvitationRecord[] {
  const result: InvitationRecord[] = [];
  for (const [key, value] of testInvitations.entries()) {
    if (key.startsWith(`${tenantId}:`) && key === `${tenantId}:${value.id}`) {
      result.push({ ...value });
    }
  }
  return result;
}

export function clearTestInvitations() {
  testInvitations.clear();
  testJoiningCodeLookup.clear();
  activeRedemptionLocks.clear();
  failedCodeAttempts.clear();
}

function recordFailedCodeAttempt(clientKey: string) {
  const now = Date.now();
  const existing = failedCodeAttempts.get(clientKey);
  if (!existing || now > existing.resetAt) {
    failedCodeAttempts.set(clientKey, {
      count: 1,
      resetAt: now + FAILED_CODE_WINDOW_MS,
    });
    return;
  }
  existing.count += 1;
}

function assertNotBruteForceLocked(clientKey: string) {
  const now = Date.now();
  const existing = failedCodeAttempts.get(clientKey);
  if (existing && now <= existing.resetAt && existing.count >= MAX_FAILED_CODE_ATTEMPTS) {
    throw new RateLimitError(
      'Too many incorrect joining code attempts. Please wait 15 minutes before trying again.'
    );
  }
  if (existing && now > existing.resetAt) {
    failedCodeAttempts.delete(clientKey);
  }
}

export class EmployeeService {
  /**
   * Generates a cryptographically secure legacy token.
   */
  private static generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Generates an unambiguous human-shareable joining code: PDK-XXXX-XXXX.
   */
  private static generateJoiningCode(): string {
    let chars = '';
    for (let i = 0; i < 8; i += 1) {
      chars += JOINING_CODE_ALPHABET[crypto.randomInt(0, JOINING_CODE_ALPHABET.length)];
    }
    return `PDK-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
  }

  /**
   * Creates and stores a new employee invitation + unique joining code (72-hour TTL).
   * Only HMAC-SHA256 digests are persisted; the plaintext joiningCode & token are returned once.
   */
  public static async createInvitation(
    tenantId: string,
    actingUserId: string,
    input: CreateInvitationInput
  ): Promise<InvitationRecord> {
    const email = input.email.trim().toLowerCase();
    const token = this.generateToken();
    const joiningCode = this.generateJoiningCode();
    const tokenHash = hashSecretValue(token);
    const joiningCodeHash = hashSecretValue(joiningCode);
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString();

    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

    if (!isTestEnv) {
      const db = firestore();
      const tenantDoc = await db.collection('tenants').doc(tenantId).get();
      if (!tenantDoc.exists) {
        throw new NotFoundError(`Pharmacy tenant '${tenantId}' does not exist.`);
      }
    }

    const cleanBranches = (input.assignedBranchIds || [])
      .map((b) => b.trim())
      .filter((b) => b.length > 0);

    if (input.role !== 'owner' && (cleanBranches.length === 0 || cleanBranches.includes('*'))) {
      throw new BadRequestError(
        'Non-owner employees must be assigned to explicit branch IDs; empty or wildcard "*" branch access is not allowed.'
      );
    }

    if (!isTestEnv || hasRegisteredTestBranches(tenantId)) {
      await BranchService.validateBranchesExist(tenantId, cleanBranches);
    }

    let validatedOverrides: PermissionOverrides;
    try {
      validatedOverrides = validatePermissionOverrides(input.role, input.permissionOverrides);
    } catch (err: any) {
      throw new BadRequestError(err.message);
    }

    // Check duplicate active employee or duplicate pending unexpired invitation for same email
    if (isTestEnv) {
      const activeMember = getTestMemberships(tenantId).find(
        (m) => m.email?.toLowerCase() === email && m.status === 'active'
      );
      if (activeMember) {
        throw new ConflictError('An active employee with this email already belongs to this pharmacy.');
      }
      const existingPending = getRawStoredTestInvitations(tenantId).find(
        (inv) =>
          inv.email.toLowerCase() === email &&
          inv.status === 'pending' &&
          new Date(inv.expiresAt).getTime() > now.getTime()
      );
      if (existingPending) {
        throw new ConflictError(
          'An active joining code already exists for this email. Generate a new code or revoke the existing one.'
        );
      }
    } else {
      const db = firestore();
      const [memberSnap, pendingSnap] = await Promise.all([
        db
          .collection('tenants')
          .doc(tenantId)
          .collection('memberships')
          .where('email', '==', email)
          .where('status', '==', 'active')
          .limit(1)
          .get(),
        db
          .collection('tenants')
          .doc(tenantId)
          .collection('invitations')
          .where('email', '==', email)
          .where('status', '==', 'pending')
          .get(),
      ]);

      if (!memberSnap.empty) {
        throw new ConflictError('An active employee with this email already belongs to this pharmacy.');
      }

      const hasUnexpired = pendingSnap.docs.some(
        (doc) => new Date((doc.data() as InvitationRecord).expiresAt).getTime() > now.getTime()
      );
      if (hasUnexpired) {
        throw new ConflictError(
          'An active joining code already exists for this email. Generate a new code or revoke the existing one.'
        );
      }
    }

    const invitationId = `inv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const persistedInvitation: InvitationRecord = {
      id: invitationId,
      tenantId,
      email,
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      role: input.role,
      assignedBranchIds:
        input.role === 'owner' && cleanBranches.length === 0 ? ['*'] : cleanBranches,
      permissionOverrides: validatedOverrides,
      tokenHash,
      tokenLast6: token.slice(-6),
      joiningCodeHash,
      codeLast4: joiningCode.slice(-4),
      joiningCodeMasked: `PDK-****-${joiningCode.slice(-4)}`,
      status: 'pending',
      expiresAt,
      createdAt: nowIso,
      createdBy: actingUserId,
    };

    const lookupRecord: JoiningCodeLookupRecord = {
      codeHash: joiningCodeHash,
      tenantId,
      invitationId,
      status: 'pending',
      expiresAt,
      createdAt: nowIso,
    };

    if (isTestEnv) {
      setTestInvitation(persistedInvitation);
    } else {
      const db = firestore();
      const batch = db.batch();
      batch.set(
        db
          .collection('tenants')
          .doc(tenantId)
          .collection('invitations')
          .doc(invitationId),
        persistedInvitation
      );
      batch.set(db.collection('joining_code_lookup').doc(joiningCodeHash), lookupRecord);
      await batch.commit();
    }

    await AuditService.log({
      tenantId,
      actingUserId,
      action: 'employee.invited',
      metadata: {
        invitationId,
        email,
        name: input.name.trim(),
        role: input.role,
        assignedBranchIds: persistedInvitation.assignedBranchIds,
      },
    });

    logger.info(
      { tenantId, invitationId, email, role: input.role },
      'Generated secure employee joining code and invitation'
    );

    return {
      ...persistedInvitation,
      token,
      joiningCode,
      displayStatus: 'Invitation Ready',
    };
  }

  /**
   * Lists all invitations for a tenant with masked secrets and clear human display statuses.
   */
  public static async listInvitations(tenantId: string): Promise<InvitationRecord[]> {
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    const now = Date.now();

    const deriveDisplayStatus = async (
      invite: InvitationRecord,
      membersByUserId: Map<string, MembershipRecord>,
      membersByEmail: Map<string, MembershipRecord>
    ): Promise<StaffDisplayStatus> => {
      if (invite.status === 'revoked' || invite.status === 'cancelled') {
        return 'Invitation Revoked';
      }
      if (invite.status === 'expired' || (invite.status === 'pending' && now > new Date(invite.expiresAt).getTime())) {
        return 'Invitation Expired';
      }
      if (invite.status === 'accepted') {
        const linkedMember =
          (invite.acceptedByUserId ? membersByUserId.get(invite.acceptedByUserId) : undefined) ||
          membersByEmail.get(invite.email.toLowerCase());
        if (linkedMember?.status === 'suspended' || linkedMember?.status === 'deactivated') {
          return 'Suspended';
        }
        return 'Active';
      }

      // Pending invitation: check if Firebase account exists with unverified email
      if (!isTestEnv) {
        try {
          const authUser = await adminAuth().getUserByEmail(invite.email);
          if (authUser && !authUser.emailVerified) {
            return 'Awaiting Account Setup';
          }
        } catch {
          // User does not exist yet -> Invitation Ready
        }
      }
      return 'Invitation Ready';
    };

    const sanitizeForList = (
      invite: InvitationRecord,
      displayStatus: StaffDisplayStatus
    ): InvitationRecord => {
      const effectiveStatus =
        invite.status === 'pending' && now > new Date(invite.expiresAt).getTime()
          ? 'expired'
          : invite.status;
      const last6 = invite.tokenLast6 || (invite.token ? invite.token.slice(-6) : '******');
      const last4 = invite.codeLast4 || (invite.joiningCode ? invite.joiningCode.slice(-4) : '');
      const copy: InvitationRecord = {
        ...invite,
        status: effectiveStatus,
        token: `***${last6}`,
        joiningCodeMasked: last4 ? `PDK-****-${last4}` : invite.joiningCodeMasked,
        displayStatus,
      };
      delete copy.joiningCode;
      return copy;
    };

    if (isTestEnv) {
      const members = getTestMemberships(tenantId);
      const membersByUserId = new Map(members.map((m) => [m.userId, m]));
      const membersByEmail = new Map(
        members.filter((m) => m.email).map((m) => [m.email!.toLowerCase(), m])
      );

      const list: InvitationRecord[] = [];
      for (const invite of getRawStoredTestInvitations(tenantId)) {
        if (invite.status === 'pending' && now > new Date(invite.expiresAt).getTime()) {
          invite.status = 'expired';
        }
        const displayStatus = await deriveDisplayStatus(invite, membersByUserId, membersByEmail);
        list.push(sanitizeForList(invite, displayStatus));
      }
      return list;
    }

    const db = firestore();
    const [invSnap, memberSnap] = await Promise.all([
      db
        .collection('tenants')
        .doc(tenantId)
        .collection('invitations')
        .orderBy('createdAt', 'desc')
        .get(),
      db.collection('tenants').doc(tenantId).collection('memberships').get(),
    ]);

    const members = memberSnap.docs.map((d) => d.data() as MembershipRecord);
    const membersByUserId = new Map(members.map((m) => [m.userId, m]));
    const membersByEmail = new Map(
      members.filter((m) => m.email).map((m) => [m.email!.toLowerCase(), m])
    );

    return Promise.all(
      invSnap.docs.map(async (doc) => {
        const data = doc.data() as InvitationRecord;
        if (data.status === 'pending' && now > new Date(data.expiresAt).getTime()) {
          data.status = 'expired';
        }
        const displayStatus = await deriveDisplayStatus(data, membersByUserId, membersByEmail);
        return sanitizeForList(data, displayStatus);
      })
    );
  }

  /**
   * Regenerates / resends an invitation: invalidates the old joining code immediately,
   * issues a brand new PDK-XXXX-XXXX joining code and 72-hour expiration window,
   * and returns the new code once for private sharing.
   */
  public static async resendInvitation(
    tenantId: string,
    invitationId: string,
    actingUserId: string
  ): Promise<InvitationRecord> {
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    let invitation: InvitationRecord | null = null;

    if (isTestEnv) {
      invitation = testInvitations.get(`${tenantId}:${invitationId}`) || null;
    } else {
      const db = firestore();
      const doc = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('invitations')
        .doc(invitationId)
        .get();
      if (doc.exists) {
        invitation = doc.data() as InvitationRecord;
      }
    }

    if (!invitation) {
      throw new NotFoundError(`Invitation '${invitationId}' not found.`);
    }

    if (invitation.status === 'accepted') {
      throw new BadRequestError('Invitation has already been accepted.');
    }

    const oldCodeHash = invitation.joiningCodeHash;
    const oldTokenHash = invitation.tokenHash;

    const newToken = this.generateToken();
    const newJoiningCode = this.generateJoiningCode();
    const newTokenHash = hashSecretValue(newToken);
    const newCodeHash = hashSecretValue(newJoiningCode);
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString();

    const updatedRecord: InvitationRecord = {
      ...invitation,
      tokenHash: newTokenHash,
      tokenLast6: newToken.slice(-6),
      joiningCodeHash: newCodeHash,
      codeLast4: newJoiningCode.slice(-4),
      joiningCodeMasked: `PDK-****-${newJoiningCode.slice(-4)}`,
      expiresAt,
      status: 'pending',
      updatedAt: nowIso,
    };
    delete updatedRecord.token;
    delete updatedRecord.joiningCode;

    if (isTestEnv) {
      if (oldTokenHash) {
        testInvitations.delete(`${tenantId}:hash:${oldTokenHash}`);
      }
      if (oldCodeHash) {
        testJoiningCodeLookup.delete(oldCodeHash);
      }
      setTestInvitation(updatedRecord);
    } else {
      const db = firestore();
      const batch = db.batch();
      const invRef = db
        .collection('tenants')
        .doc(tenantId)
        .collection('invitations')
        .doc(invitationId);

      batch.update(invRef, {
        tokenHash: newTokenHash,
        tokenLast6: newToken.slice(-6),
        joiningCodeHash: newCodeHash,
        codeLast4: newJoiningCode.slice(-4),
        joiningCodeMasked: updatedRecord.joiningCodeMasked,
        expiresAt,
        status: 'pending',
        updatedAt: nowIso,
      });

      if (oldCodeHash) {
        batch.delete(db.collection('joining_code_lookup').doc(oldCodeHash));
      }

      batch.set(db.collection('joining_code_lookup').doc(newCodeHash), {
        codeHash: newCodeHash,
        tenantId,
        invitationId,
        status: 'pending',
        expiresAt,
        createdAt: updatedRecord.createdAt,
        updatedAt: nowIso,
      });

      await batch.commit();
    }

    await AuditService.log({
      tenantId,
      actingUserId,
      action: 'employee.invitation_regenerated',
      metadata: { invitationId, email: updatedRecord.email },
    });

    return {
      ...updatedRecord,
      token: newToken,
      joiningCode: newJoiningCode,
      displayStatus: 'Invitation Ready',
    };
  }

  /**
   * Revokes or cancels a pending/expired invitation and invalidates its joining code lookup entry.
   */
  public static async cancelInvitation(
    tenantId: string,
    invitationId: string,
    actingUserId: string,
    targetStatus: 'cancelled' | 'revoked' = 'cancelled'
  ): Promise<InvitationRecord> {
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    let invitation: InvitationRecord | null = null;

    if (isTestEnv) {
      invitation = testInvitations.get(`${tenantId}:${invitationId}`) || null;
    } else {
      const db = firestore();
      const doc = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('invitations')
        .doc(invitationId)
        .get();
      if (doc.exists) {
        invitation = doc.data() as InvitationRecord;
      }
    }

    if (!invitation) {
      throw new NotFoundError(`Invitation '${invitationId}' not found.`);
    }

    if (invitation.status === 'accepted') {
      throw new BadRequestError('Cannot revoke an already accepted invitation.');
    }

    const nowIso = new Date().toISOString();
    invitation.status = targetStatus;
    invitation.updatedAt = nowIso;
    if (targetStatus === 'revoked') {
      invitation.revokedAt = nowIso;
      invitation.revokedBy = actingUserId;
    }

    if (isTestEnv) {
      setTestInvitation(invitation);
      if (invitation.joiningCodeHash && testJoiningCodeLookup.has(invitation.joiningCodeHash)) {
        const lookup = testJoiningCodeLookup.get(invitation.joiningCodeHash)!;
        lookup.status = targetStatus;
        lookup.updatedAt = nowIso;
      }
    } else {
      const db = firestore();
      const batch = db.batch();
      batch.update(
        db
          .collection('tenants')
          .doc(tenantId)
          .collection('invitations')
          .doc(invitationId),
        {
          status: targetStatus,
          updatedAt: nowIso,
          ...(targetStatus === 'revoked'
            ? { revokedAt: nowIso, revokedBy: actingUserId }
            : { cancelledAt: nowIso, cancelledBy: actingUserId }),
        }
      );
      if (invitation.joiningCodeHash) {
        batch.set(
          db.collection('joining_code_lookup').doc(invitation.joiningCodeHash),
          { status: targetStatus, updatedAt: nowIso },
          { merge: true }
        );
      }
      await batch.commit();
    }

    await AuditService.log({
      tenantId,
      actingUserId,
      action: targetStatus === 'revoked' ? 'employee.invitation_revoked' : 'employee.invitation_cancelled',
      metadata: { invitationId, email: invitation.email },
    });

    return {
      ...invitation,
      displayStatus: 'Invitation Revoked',
    };
  }

  /**
   * Public step-1 endpoint backing POST /api/v1/joining-codes/validate.
   * Validates normalized joining code against hashed lookup without exposing tenantId or full PII.
   */
  public static async validateJoiningCode(options: {
    joiningCode: string;
    clientIp?: string;
  }): Promise<ValidatedJoiningCodePreview> {
    const clientKey = options.clientIp || 'unknown';
    assertNotBruteForceLocked(clientKey);

    const normalized = normalizeJoiningCode(options.joiningCode);
    const codeHash = hashSecretValue(normalized);
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

    let lookup: JoiningCodeLookupRecord | null = null;
    let invitation: InvitationRecord | null = null;
    let pharmacyName = 'PharmaDesk Pharmacy';
    let assignedBranches: Array<{ id: string; name: string }> = [];

    if (isTestEnv) {
      lookup = testJoiningCodeLookup.get(codeHash) || null;
      if (!lookup) {
        recordFailedCodeAttempt(clientKey);
        throw new NotFoundError('This joining code is incorrect.');
      }
      invitation = testInvitations.get(`${lookup.tenantId}:${lookup.invitationId}`) || null;
      if (!invitation) {
        recordFailedCodeAttempt(clientKey);
        throw new NotFoundError('This joining code is incorrect.');
      }
      const tenant = getTestTenant(lookup.tenantId);
      if (tenant?.name) {
        pharmacyName = String(tenant.name);
      }
      const branches = await BranchService.listBranches(lookup.tenantId);
      assignedBranches = (invitation.assignedBranchIds || []).map((branchId) => {
        const matched = branches.find((b) => b.id === branchId);
        return {
          id: branchId,
          name: matched?.name || (branchId === 'main' ? 'Main Store' : branchId),
        };
      });
    } else {
      const db = firestore();
      const lookupSnap = await db.collection('joining_code_lookup').doc(codeHash).get();
      if (!lookupSnap.exists) {
        recordFailedCodeAttempt(clientKey);
        throw new NotFoundError('This joining code is incorrect.');
      }
      lookup = lookupSnap.data() as JoiningCodeLookupRecord;

      const [invSnap, tenantSnap, branchSnap] = await Promise.all([
        db
          .collection('tenants')
          .doc(lookup.tenantId)
          .collection('invitations')
          .doc(lookup.invitationId)
          .get(),
        db.collection('tenants').doc(lookup.tenantId).get(),
        db.collection('tenants').doc(lookup.tenantId).collection('branches').get(),
      ]);

      if (!invSnap.exists) {
        recordFailedCodeAttempt(clientKey);
        throw new NotFoundError('This joining code is incorrect.');
      }
      invitation = invSnap.data() as InvitationRecord;
      if (tenantSnap.exists && tenantSnap.data()?.name) {
        pharmacyName = String(tenantSnap.data()!.name);
      }
      const branchDocs = branchSnap.docs.map((d) => d.data() as { id: string; name?: string });
      assignedBranches = (invitation.assignedBranchIds || []).map((branchId) => {
        const matched = branchDocs.find((b) => b.id === branchId);
        return {
          id: branchId,
          name: matched?.name || (branchId === 'main' ? 'Main Store' : branchId),
        };
      });
    }

    if (invitation.status === 'revoked' || invitation.status === 'cancelled') {
      throw new BadRequestError('This joining code has been revoked by the pharmacy owner.');
    }
    if (invitation.status === 'accepted') {
      throw new ConflictError('This joining code has already been used.');
    }
    if (
      invitation.status === 'expired' ||
      Date.now() > new Date(invitation.expiresAt).getTime()
    ) {
      throw new BadRequestError('This joining code has expired. Ask your pharmacy owner for a new code.');
    }

    // Valid code clears failure count for this IP
    failedCodeAttempts.delete(clientKey);

    return {
      valid: true,
      pharmacyName,
      assignedRole: invitation.role,
      assignedRoleLabel: ROLE_LABELS[invitation.role] || invitation.role,
      assignedBranches,
      maskedEmail: maskEmail(invitation.email),
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * Redeems a single-use joining code on behalf of an authenticated, email-verified user.
   * Atomically activates the owner-chosen role & branch access and burns the joining code.
   */
  public static async redeemJoiningCode(options: {
    joiningCode: string;
    userId: string;
    userEmail?: string;
    emailVerified: boolean;
  }): Promise<MembershipRecord> {
    if (!options.emailVerified) {
      throw new ForbiddenError('Please verify your email address before joining this pharmacy.');
    }

    const normalized = normalizeJoiningCode(options.joiningCode);
    const codeHash = hashSecretValue(normalized);
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    const now = Date.now();
    const nowIso = new Date().toISOString();

    if (isTestEnv) {
      const lookup = testJoiningCodeLookup.get(codeHash);
      if (!lookup) {
        throw new NotFoundError('This joining code is incorrect.');
      }

      const lockKey = `${lookup.tenantId}:${lookup.invitationId}`;
      if (activeRedemptionLocks.has(lockKey)) {
        throw new ConflictError('This joining code has already been used.');
      }
      activeRedemptionLocks.add(lockKey);

      try {
        const invitation = testInvitations.get(`${lookup.tenantId}:${lookup.invitationId}`);
        if (!invitation) {
          throw new NotFoundError('This joining code is incorrect.');
        }
        if (invitation.status === 'revoked' || invitation.status === 'cancelled') {
          throw new BadRequestError('This joining code has been revoked by the pharmacy owner.');
        }
        if (invitation.status === 'accepted') {
          throw new ConflictError('This joining code has already been used.');
        }
        if (invitation.status === 'expired' || now > new Date(invitation.expiresAt).getTime()) {
          invitation.status = 'expired';
          throw new BadRequestError('This joining code has expired. Ask your pharmacy owner for a new code.');
        }
        if (
          !options.userEmail ||
          invitation.email.toLowerCase() !== options.userEmail.trim().toLowerCase()
        ) {
          throw new ForbiddenError('Please use the email address provided by your pharmacy owner.');
        }

        const existingMember = getTestMemberships(lookup.tenantId).find(
          (m) => m.userId === options.userId
        );
        if (existingMember && existingMember.status === 'active') {
          throw new ConflictError('You already have an active membership in this pharmacy.');
        }

        const cleanBranches = (invitation.assignedBranchIds || [])
          .map((b) => b.trim())
          .filter(Boolean);
        if (invitation.role !== 'owner' && (cleanBranches.length === 0 || cleanBranches.includes('*'))) {
          throw new BadRequestError('Invitation is missing valid branch assignments for non-owner role.');
        }

        const effectivePermissions = resolveEffectivePermissions(
          invitation.role,
          invitation.permissionOverrides
        );

        const membership: MembershipRecord = {
          tenantId: lookup.tenantId,
          userId: options.userId,
          role: invitation.role,
          status: 'active',
          assignedBranchIds: cleanBranches,
          permissionOverrides: invitation.permissionOverrides,
          permissions: effectivePermissions,
          name: invitation.name,
          email: invitation.email,
          phone: invitation.phone || undefined,
          invitedBy: invitation.createdBy,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        invitation.status = 'accepted';
        invitation.acceptedByUserId = options.userId;
        invitation.acceptedAt = nowIso;
        lookup.status = 'accepted';
        lookup.updatedAt = nowIso;

        setTestMembership(lookup.tenantId, options.userId, membership);
        setTestInvitation(invitation);

        await AuditService.log({
          tenantId: lookup.tenantId,
          actingUserId: options.userId,
          targetUserId: options.userId,
          action: 'employee.joining_code_redeemed',
          metadata: {
            invitationId: invitation.id,
            role: membership.role,
            assignedBranchIds: membership.assignedBranchIds,
          },
        });

        return membership;
      } finally {
        activeRedemptionLocks.delete(lockKey);
      }
    }

    const db = firestore();
    const lookupRef = db.collection('joining_code_lookup').doc(codeHash);

    const newMembership = await db.runTransaction(async (tx) => {
      const lookupSnap = await tx.get(lookupRef);
      if (!lookupSnap.exists) {
        throw new NotFoundError('This joining code is incorrect.');
      }
      const lookup = lookupSnap.data() as JoiningCodeLookupRecord;

      const tenantRef = db.collection('tenants').doc(lookup.tenantId);
      const invRef = tenantRef.collection('invitations').doc(lookup.invitationId);
      const memberRef = tenantRef.collection('memberships').doc(options.userId);
      const userRef = db.collection('users').doc(options.userId);

      const [invSnap, memberSnap] = await Promise.all([tx.get(invRef), tx.get(memberRef)]);
      if (!invSnap.exists) {
        throw new NotFoundError('This joining code is incorrect.');
      }

      const invData = invSnap.data() as InvitationRecord;
      if (invData.status === 'revoked' || invData.status === 'cancelled') {
        throw new BadRequestError('This joining code has been revoked by the pharmacy owner.');
      }
      if (invData.status === 'accepted' || lookup.status === 'accepted') {
        throw new ConflictError('This joining code has already been used.');
      }
      if (invData.status === 'expired' || now > new Date(invData.expiresAt).getTime()) {
        throw new BadRequestError('This joining code has expired. Ask your pharmacy owner for a new code.');
      }
      if (
        !options.userEmail ||
        invData.email.toLowerCase() !== options.userEmail.trim().toLowerCase()
      ) {
        throw new ForbiddenError('Please use the email address provided by your pharmacy owner.');
      }

      if (memberSnap.exists) {
        const existingMember = memberSnap.data() as MembershipRecord;
        if (existingMember.status === 'active') {
          throw new ConflictError('You already have an active membership in this pharmacy.');
        }
      }

      const cleanBranches = (invData.assignedBranchIds || []).map((b) => b.trim()).filter(Boolean);
      if (invData.role !== 'owner' && (cleanBranches.length === 0 || cleanBranches.includes('*'))) {
        throw new BadRequestError('Invitation is missing valid branch assignments for non-owner role.');
      }

      const effectivePermissions = resolveEffectivePermissions(
        invData.role,
        invData.permissionOverrides
      );

      const membershipPayload: MembershipRecord = {
        tenantId: lookup.tenantId,
        userId: options.userId,
        role: invData.role,
        status: 'active',
        assignedBranchIds: cleanBranches,
        permissionOverrides: invData.permissionOverrides,
        permissions: effectivePermissions,
        name: invData.name,
        email: invData.email,
        phone: invData.phone || undefined,
        invitedBy: invData.createdBy,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      tx.set(memberRef, membershipPayload);
      tx.update(invRef, {
        status: 'accepted',
        acceptedByUserId: options.userId,
        acceptedAt: nowIso,
        updatedAt: nowIso,
      });
      tx.update(lookupRef, {
        status: 'accepted',
        updatedAt: nowIso,
      });
      tx.set(
        userRef,
        {
          uid: options.userId,
          lastActiveTenantId: lookup.tenantId,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      return membershipPayload;
    });

    await AuditService.log({
      tenantId: newMembership.tenantId,
      actingUserId: options.userId,
      targetUserId: options.userId,
      action: 'employee.joining_code_redeemed',
      metadata: {
        role: newMembership.role,
        assignedBranchIds: newMembership.assignedBranchIds,
      },
    });

    logger.info(
      { tenantId: newMembership.tenantId, userId: options.userId, role: newMembership.role },
      'Employee joining code redeemed and membership activated'
    );

    return newMembership;
  }

  /**
   * Legacy token-based invitation acceptance kept compatible for existing integrations/tests.
   */
  public static async acceptInvitation(options: {
    tenantId: string;
    token: string;
    userId: string;
    userEmail?: string;
  }) {
    const { tenantId, token, userId, userEmail } = options;
    const tokenHash = hashSecretValue(token);
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

    const now = Date.now();
    const nowIso = new Date().toISOString();
    let newMembership: MembershipRecord;

    if (isTestEnv) {
      const invitation = testInvitations.get(`${tenantId}:hash:${tokenHash}`) || null;

      if (!invitation) {
        throw new NotFoundError('Invalid invitation token or pharmacy tenant.');
      }
      if (invitation.status === 'cancelled' || invitation.status === 'revoked') {
        throw new BadRequestError('This invitation has been cancelled by the pharmacy owner.');
      }
      if (invitation.status === 'accepted') {
        throw new ConflictError('This invitation has already been accepted.');
      }
      if (invitation.status === 'expired' || now > new Date(invitation.expiresAt).getTime()) {
        invitation.status = 'expired';
        throw new BadRequestError('This invitation has expired. Please ask your pharmacy administrator to resend it.');
      }
      if (invitation.email && userEmail && invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
        throw new ForbiddenError(
          `This invitation was issued to '${invitation.email}', but you are signed in as '${userEmail}'.`
        );
      }

      const existingMember = getTestMemberships(tenantId).find((m) => m.userId === userId);
      if (existingMember && existingMember.status === 'active') {
        throw new ConflictError('You already have an active membership in this pharmacy.');
      }

      const cleanBranches = (invitation.assignedBranchIds || []).map((b) => b.trim()).filter(Boolean);
      if (invitation.role !== 'owner' && (cleanBranches.length === 0 || cleanBranches.includes('*'))) {
        throw new BadRequestError('Invitation is missing valid branch assignments for non-owner role.');
      }

      const effectivePermissions = resolveEffectivePermissions(
        invitation.role,
        invitation.permissionOverrides
      );

      newMembership = {
        tenantId,
        userId,
        role: invitation.role,
        status: 'active',
        assignedBranchIds: cleanBranches,
        permissionOverrides: invitation.permissionOverrides,
        permissions: effectivePermissions,
        name: invitation.name,
        email: invitation.email,
        phone: invitation.phone || undefined,
        invitedBy: invitation.createdBy,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      invitation.status = 'accepted';
      invitation.acceptedByUserId = userId;
      invitation.acceptedAt = nowIso;

      setTestMembership(tenantId, userId, newMembership);
      setTestInvitation(invitation);
      if (invitation.joiningCodeHash && testJoiningCodeLookup.has(invitation.joiningCodeHash)) {
        testJoiningCodeLookup.get(invitation.joiningCodeHash)!.status = 'accepted';
      }
    } else {
      const db = firestore();
      const tenantRef = db.collection('tenants').doc(tenantId);
      const inviteQuery = tenantRef.collection('invitations').where('tokenHash', '==', tokenHash).limit(1);
      const memberRef = tenantRef.collection('memberships').doc(userId);
      const userRef = db.collection('users').doc(userId);

      newMembership = await db.runTransaction(async (tx) => {
        const [inviteSnap, memberSnap] = await Promise.all([
          tx.get(inviteQuery),
          tx.get(memberRef),
        ]);

        if (inviteSnap.empty || !inviteSnap.docs[0]) {
          throw new NotFoundError('Invalid invitation token or pharmacy tenant.');
        }

        const invDoc = inviteSnap.docs[0];
        const invData = invDoc.data() as InvitationRecord;

        if (invData.status === 'cancelled' || invData.status === 'revoked') {
          throw new BadRequestError('This invitation has been cancelled by the pharmacy owner.');
        }
        if (invData.status === 'accepted') {
          throw new ConflictError('This invitation has already been accepted.');
        }
        if (invData.status === 'expired' || now > new Date(invData.expiresAt).getTime()) {
          throw new BadRequestError('This invitation has expired. Please ask your pharmacy administrator to resend it.');
        }
        if (invData.email && userEmail && invData.email.toLowerCase() !== userEmail.toLowerCase()) {
          throw new ForbiddenError(
            `This invitation was issued to '${invData.email}', but you are signed in as '${userEmail}'.`
          );
        }

        if (memberSnap.exists) {
          const existingMember = memberSnap.data() as MembershipRecord;
          if (existingMember.status === 'active') {
            throw new ConflictError('You already have an active membership in this pharmacy.');
          }
        }

        const cleanBranches = (invData.assignedBranchIds || []).map((b) => b.trim()).filter(Boolean);
        if (invData.role !== 'owner' && (cleanBranches.length === 0 || cleanBranches.includes('*'))) {
          throw new BadRequestError('Invitation is missing valid branch assignments for non-owner role.');
        }

        const effectivePermissions = resolveEffectivePermissions(
          invData.role,
          invData.permissionOverrides
        );

        const membershipPayload: MembershipRecord = {
          tenantId,
          userId,
          role: invData.role,
          status: 'active',
          assignedBranchIds: cleanBranches,
          permissionOverrides: invData.permissionOverrides,
          permissions: effectivePermissions,
          name: invData.name,
          email: invData.email,
          phone: invData.phone || undefined,
          invitedBy: invData.createdBy,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        tx.set(memberRef, membershipPayload);
        tx.update(invDoc.ref, {
          status: 'accepted',
          acceptedByUserId: userId,
          acceptedAt: nowIso,
        });
        if (invData.joiningCodeHash) {
          tx.set(
            db.collection('joining_code_lookup').doc(invData.joiningCodeHash),
            { status: 'accepted', updatedAt: nowIso },
            { merge: true }
          );
        }
        tx.set(
          userRef,
          {
            uid: userId,
            lastActiveTenantId: tenantId,
            updatedAt: nowIso,
          },
          { merge: true }
        );

        return membershipPayload;
      });
    }

    await AuditService.log({
      tenantId,
      actingUserId: userId,
      targetUserId: userId,
      action: 'employee.invitation_accepted',
      metadata: {
        role: newMembership.role,
        assignedBranchIds: newMembership.assignedBranchIds,
      },
    });

    logger.info(
      { tenantId, userId, role: newMembership.role },
      'Employee invitation successfully accepted and membership activated'
    );

    return newMembership;
  }

  /**
   * Updates an employee's role. Recomputes effective permissions with existing overrides.
   * Prevents demoting the last active pharmacy owner.
   */
  public static async updateRole(
    tenantId: string,
    targetUserId: string,
    newRole: UserRole,
    actingUserId: string
  ) {
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    let member: MembershipRecord | null = null;
    let allMembers: MembershipRecord[] = [];

    if (isTestEnv) {
      allMembers = getTestMemberships(tenantId);
      member = allMembers.find((m) => m.userId === targetUserId) || null;
    } else {
      const db = firestore();
      const snap = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('memberships')
        .get();
      allMembers = snap.docs.map((d) => d.data() as MembershipRecord);
      member = allMembers.find((m) => m.userId === targetUserId) || null;
    }

    if (!member) {
      throw new NotFoundError(`Employee '${targetUserId}' not found in this pharmacy.`);
    }

    if (member.role === 'owner' && targetUserId === actingUserId && newRole !== 'owner') {
      throw new BadRequestError('Primary pharmacy owner cannot demote their own role.');
    }

    if (member.role === 'owner' && member.status === 'active' && newRole !== 'owner') {
      const activeOwners = allMembers.filter((m) => m.role === 'owner' && m.status === 'active');
      if (activeOwners.length <= 1) {
        throw new BadRequestError('Cannot demote the last active pharmacy owner.');
      }
    }

    const previousRole = member.role;
    member.role = newRole;
    member.permissions = resolveEffectivePermissions(newRole, member.permissionOverrides);
    member.updatedAt = new Date().toISOString();

    if (isTestEnv) {
      setTestMembership(tenantId, targetUserId, member);
    } else {
      const db = firestore();
      await db
        .collection('tenants')
        .doc(tenantId)
        .collection('memberships')
        .doc(targetUserId)
        .update({
          role: newRole,
          permissions: member.permissions,
          updatedAt: member.updatedAt,
        });
    }

    await AuditService.log({
      tenantId,
      actingUserId,
      targetUserId,
      action: 'employee.role_changed',
      metadata: { previousRole, newRole },
    });

    return member;
  }

  /**
   * Updates branch assignments for an employee.
   */
  public static async updateBranches(
    tenantId: string,
    targetUserId: string,
    assignedBranchIds: string[],
    actingUserId: string
  ) {
    if (!assignedBranchIds || assignedBranchIds.length === 0) {
      throw new BadRequestError('Employee must be assigned to at least one branch.');
    }

    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    let member: MembershipRecord | null = null;

    if (isTestEnv) {
      member = getTestMemberships(tenantId).find((m) => m.userId === targetUserId) || null;
    } else {
      const db = firestore();
      const doc = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('memberships')
        .doc(targetUserId)
        .get();
      if (doc.exists) {
        member = doc.data() as MembershipRecord;
      }
    }

    if (!member) {
      throw new NotFoundError(`Employee '${targetUserId}' not found in this pharmacy.`);
    }

    const cleanBranches = (assignedBranchIds || []).map((b) => b.trim()).filter(Boolean);
    if (member.role !== 'owner' && (cleanBranches.length === 0 || cleanBranches.includes('*'))) {
      throw new BadRequestError('Non-owner employees must have explicit non-wildcard branch assignments.');
    }

    if (!isTestEnv || hasRegisteredTestBranches(tenantId)) {
      await BranchService.validateBranchesExist(tenantId, cleanBranches);
    }

    const previousBranches = member.assignedBranchIds || [];
    member.assignedBranchIds = cleanBranches;
    member.updatedAt = new Date().toISOString();

    if (isTestEnv) {
      setTestMembership(tenantId, targetUserId, member);
    } else {
      const db = firestore();
      await db
        .collection('tenants')
        .doc(tenantId)
        .collection('memberships')
        .doc(targetUserId)
        .update({
          assignedBranchIds: cleanBranches,
          updatedAt: member.updatedAt,
        });
    }

    await AuditService.log({
      tenantId,
      actingUserId,
      targetUserId,
      action: 'employee.branches_changed',
      metadata: { previousBranches, newBranches: cleanBranches },
    });

    return member;
  }

  /**
   * Updates custom permission overrides (granted and revoked) for an employee.
   */
  public static async updatePermissions(
    tenantId: string,
    targetUserId: string,
    permissionOverrides: PermissionOverrides,
    actingUserId: string
  ) {
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    let member: MembershipRecord | null = null;

    if (isTestEnv) {
      member = getTestMemberships(tenantId).find((m) => m.userId === targetUserId) || null;
    } else {
      const db = firestore();
      const doc = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('memberships')
        .doc(targetUserId)
        .get();
      if (doc.exists) {
        member = doc.data() as MembershipRecord;
      }
    }

    if (!member) {
      throw new NotFoundError(`Employee '${targetUserId}' not found in this pharmacy.`);
    }

    if (member.role === 'owner') {
      throw new BadRequestError('Cannot override permissions for pharmacy owner.');
    }

    let sanitizedOverrides: PermissionOverrides;
    try {
      sanitizedOverrides = validatePermissionOverrides(member.role, permissionOverrides);
    } catch (err: any) {
      throw new BadRequestError(err.message);
    }

    member.permissionOverrides = sanitizedOverrides;
    member.permissions = resolveEffectivePermissions(member.role, sanitizedOverrides);
    member.updatedAt = new Date().toISOString();

    if (isTestEnv) {
      setTestMembership(tenantId, targetUserId, member);
    } else {
      const db = firestore();
      await db
        .collection('tenants')
        .doc(tenantId)
        .collection('memberships')
        .doc(targetUserId)
        .update({
          permissionOverrides,
          permissions: member.permissions,
          updatedAt: member.updatedAt,
        });
    }

    await AuditService.log({
      tenantId,
      actingUserId,
      targetUserId,
      action: 'employee.permissions_changed',
      metadata: { permissionOverrides },
    });

    return member;
  }

  /**
   * Updates employee status: 'active', 'suspended', or 'deactivated'.
   * Protects the last active pharmacy owner and preserves other pharmacy memberships & historical records.
   */
  public static async updateStatus(
    tenantId: string,
    targetUserId: string,
    status: 'active' | 'suspended' | 'deactivated',
    actingUserId: string
  ) {
    if (targetUserId === actingUserId && status !== 'active') {
      throw new BadRequestError('Pharmacy owner cannot deactivate or suspend their own account.');
    }

    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    let member: MembershipRecord | null = null;
    let allMembers: MembershipRecord[] = [];

    if (isTestEnv) {
      allMembers = getTestMemberships(tenantId);
      member = allMembers.find((m) => m.userId === targetUserId) || null;
    } else {
      const db = firestore();
      const snap = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('memberships')
        .get();
      allMembers = snap.docs.map((d) => d.data() as MembershipRecord);
      member = allMembers.find((m) => m.userId === targetUserId) || null;
    }

    if (!member) {
      throw new NotFoundError(`Employee '${targetUserId}' not found in this pharmacy.`);
    }

    if (member.role === 'owner' && member.status === 'active' && status !== 'active') {
      const activeOwners = allMembers.filter((m) => m.role === 'owner' && m.status === 'active');
      if (activeOwners.length <= 1) {
        throw new BadRequestError('Cannot suspend or remove the last active pharmacy owner.');
      }
    }

    member.status = status;
    member.updatedAt = new Date().toISOString();
    member.statusUpdatedBy = actingUserId;

    if (isTestEnv) {
      setTestMembership(tenantId, targetUserId, member);
    } else {
      const db = firestore();
      await db
        .collection('tenants')
        .doc(tenantId)
        .collection('memberships')
        .doc(targetUserId)
        .update({
          status,
          updatedAt: member.updatedAt,
          statusUpdatedBy: actingUserId,
        });
    }

    let tokensRevoked = false;
    if (!isTestEnv && (status === 'suspended' || status === 'deactivated')) {
      try {
        await adminAuth().revokeRefreshTokens(targetUserId);
        tokensRevoked = true;
      } catch (err: any) {
        logger.warn(
          { tenantId, targetUserId, err: err?.message },
          'Best-effort Firebase refresh token revocation failed during employee status change'
        );
      }
    }

    const actionMap = {
      active: 'employee.reactivated',
      suspended: 'employee.suspended',
      deactivated: 'employee.deactivated',
    };

    await AuditService.log({
      tenantId,
      category: 'auth',
      severity: status === 'active' ? 'info' : 'warning',
      actingUserId,
      targetUserId,
      action: actionMap[status],
      metadata: { status, tokensRevoked },
    });

    logger.info(
      { tenantId, targetUserId, status, actingUserId, tokensRevoked },
      `Employee status transitioned to ${status}`
    );

    return member;
  }
}
