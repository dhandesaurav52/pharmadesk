import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import {
  clearTestMemberships,
  clearTestBranchStatuses,
  getTestMemberships,
  setTestMembership,
} from '../src/middleware/tenantAuthorization';
import { clearTestTenants } from '../src/services/tenantService';
import {
  clearTestInvitations,
  getRawStoredTestInvitations,
  setTestInvitation,
} from '../src/services/employeeService';
import { clearTestAuditLogs, getTestAuditLogs } from '../src/services/auditService';
import { BranchService, clearTestBranchData } from '../src/services/branchService';

describe('Employee Onboarding, Unique Joining Codes & Role-Based Login System', () => {
  let app: Express;

  const verifiedOwnerToken = (uid = 'owner-uid-1', email = 'owner@sai.test') =>
    `Bearer test-mock-token:${uid}:${email}`;
  const unverifiedToken = (uid = 'unverified-uid', email = 'unverified@sai.test') =>
    `Bearer test-mock-token:${uid}:${email}:unverified`;
  const staffToken = (uid: string, email: string) =>
    `Bearer test-mock-token:${uid}:${email}`;

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
  });

  const provisionPharmacy = async (
    authHeader: string,
    name = 'Shree Sai Medical & General',
    idempotencyKey = 'setup-key-001'
  ) => {
    const res = await request(app)
      .post('/api/v1/tenants')
      .set({
        Authorization: authHeader,
        'X-Idempotency-Key': idempotencyKey,
      })
      .send({
        name,
        dlNumber20B: 'MH-20B-2026',
        dlNumber21B: 'MH-21B-2027',
        address: 'Shop 4, Station Road',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
        contactPhone: '+91 98220 11223',
        contactEmail: 'owner@sai.test',
        ownerName: 'Rajesh Deshmukh',
      });
    return res;
  };

  describe('1. Owner Account & Idempotent Pharmacy Provisioning', () => {
    it('rejects pharmacy creation when the owner email is not verified (403)', async () => {
      const res = await provisionPharmacy(unverifiedToken('u-unver', 'newowner@sai.test'));
      expect(res.status).toBe(403);
      expect(res.body.detail).toContain('verify your email');
    });

    it('auto-generates workspace slug, creates owner membership + main branch, and replays idempotently', async () => {
      const first = await provisionPharmacy(verifiedOwnerToken(), 'Shree Sai Medical', 'idem-create-1');
      expect(first.status).toBe(201);
      expect(first.body.success).toBe(true);
      expect(first.body.data.tenant.id).toMatch(/^shree-sai-medical-[a-f0-9]{6}$/);
      expect(first.body.data.branch.id).toBe('main');
      expect(first.body.data.membership.role).toBe('owner');
      expect(first.body.data.membership.permissions).toContain('*');

      const tenantId = first.body.data.tenant.id;

      // Retry with identical idempotency key returns 200 replay with exact same tenantId
      const replay = await provisionPharmacy(verifiedOwnerToken(), 'Shree Sai Medical', 'idem-create-1');
      expect(replay.status).toBe(200);
      expect(replay.body.data.tenant.id).toBe(tenantId);

      // Only 1 owner membership exists
      expect(getTestMemberships(tenantId)).toHaveLength(1);

      // Audit event logged
      const logs = getTestAuditLogs(tenantId);
      expect(logs.some((l) => l.action === 'tenant.provisioned')).toBe(true);
    });

    it('does not grant arbitrary registered users owner access to any pharmacy', async () => {
      const created = await provisionPharmacy(verifiedOwnerToken());
      const tenantId = created.body.data.tenant.id;

      const randomUser = staffToken('stranger-uid', 'stranger@example.com');
      const me = await request(app).get('/api/v1/auth/me').set('Authorization', randomUser);
      expect(me.status).toBe(200);
      expect(me.body.memberships).toEqual([]);

      const forbiddenAccess = await request(app)
        .get(`/api/v1/tenants/${tenantId}/employees`)
        .set('Authorization', randomUser);
      expect(forbiddenAccess.status).toBe(403);
    });
  });

  describe('2. Owner Creates Employee & Unique Joining Code Security', () => {
    it('generates PDK-XXXX-XXXX joining codes for allowed roles, stores hashes only, and blocks duplicates', async () => {
      const created = await provisionPharmacy(verifiedOwnerToken());
      const tenantId = created.body.data.tenant.id;
      await BranchService.listBranches(tenantId);

      for (const role of ['pharmacist', 'cashier', 'helper', 'auditor'] as const) {
        const inviteRes = await request(app)
          .post(`/api/v1/tenants/${tenantId}/invitations`)
          .set('Authorization', verifiedOwnerToken())
          .send({
            name: `Staff ${role}`,
            email: `${role}@sai.test`,
            phone: '+91 98220 99000',
            role,
            assignedBranchIds: ['main'],
          });

        expect(inviteRes.status).toBe(201);
        const joiningCode = inviteRes.body.joiningCode as string;
        expect(joiningCode).toMatch(/^PDK-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/);
        expect(inviteRes.body.data.joiningCodeMasked).toBe(`PDK-****-${joiningCode.slice(-4)}`);

        // Stored record must NEVER contain plaintext joiningCode or raw token
        const stored = getRawStoredTestInvitations(tenantId).find(
          (i) => i.id === inviteRes.body.data.id
        );
        expect(stored).toBeDefined();
        expect(stored?.joiningCode).toBeUndefined();
        expect(stored?.token).toBeUndefined();
        expect(stored?.joiningCodeHash).toMatch(/^[a-f0-9]{64}$/);
        expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/);

        // List endpoint returns masked code + human displayStatus, zero plaintext secrets
        const listRes = await request(app)
          .get(`/api/v1/tenants/${tenantId}/invitations`)
          .set('Authorization', verifiedOwnerToken());
        expect(listRes.status).toBe(200);
        const listed = listRes.body.data.find((i: any) => i.id === inviteRes.body.data.id);
        expect(listed.joiningCode).toBeUndefined();
        expect(listed.joiningCodeMasked).toBe(`PDK-****-${joiningCode.slice(-4)}`);
        expect(listed.displayStatus).toBe('Invitation Ready');
        expect(listed.token.startsWith('***')).toBe(true);

        // Audit logs must not contain plaintext joiningCode
        const logs = JSON.stringify(getTestAuditLogs(tenantId));
        expect(logs).not.toContain(joiningCode);

        // Duplicate unexpired pending invite for same email rejected (409)
        const dupRes = await request(app)
          .post(`/api/v1/tenants/${tenantId}/invitations`)
          .set('Authorization', verifiedOwnerToken())
          .send({
            name: `Duplicate ${role}`,
            email: `${role}@sai.test`,
            role,
            assignedBranchIds: ['main'],
          });
        expect(dupRes.status).toBe(409);
      }

      // Non-owner cannot issue joining codes (403)
      setTestMembership(tenantId, 'cashier-temp', {
        tenantId,
        userId: 'cashier-temp',
        role: 'cashier',
        status: 'active',
        assignedBranchIds: ['main'],
      });
      const cashierInvite = await request(app)
        .post(`/api/v1/tenants/${tenantId}/invitations`)
        .set('Authorization', staffToken('cashier-temp', 'c@sai.test'))
        .send({
          name: 'Blocked Staff',
          email: 'blocked@sai.test',
          role: 'helper',
          assignedBranchIds: ['main'],
        });
      expect(cashierInvite.status).toBe(403);
    });
  });

  describe('3. Public Joining Code Validation & Brute-Force Protection', () => {
    it('normalizes code formatting, returns masked preview only, rejects expired/revoked, and enforces lockout', async () => {
      const created = await provisionPharmacy(verifiedOwnerToken());
      const tenantId = created.body.data.tenant.id;

      const inviteRes = await request(app)
        .post(`/api/v1/tenants/${tenantId}/invitations`)
        .set('Authorization', verifiedOwnerToken())
        .send({
          name: 'Ramesh Kulkarni',
          email: 'ramesh.kulkarni@gmail.com',
          role: 'cashier',
          assignedBranchIds: ['main'],
        });
      const joiningCode: string = inviteRes.body.joiningCode;

      // Normalize lowercase & no hyphens
      const compactLower = joiningCode.toLowerCase().replace(/-/g, '');
      const valRes = await request(app)
        .post('/api/v1/joining-codes/validate')
        .send({ joiningCode: `  ${compactLower}  ` });

      expect(valRes.status).toBe(200);
      expect(valRes.body.data).toMatchObject({
        valid: true,
        pharmacyName: 'Shree Sai Medical & General',
        assignedRole: 'cashier',
        assignedRoleLabel: 'Cashier',
        maskedEmail: 'ra***@gmail.com',
      });
      // Must NOT expose full email or internal tenantId publicly
      expect(valRes.body.data.tenantId).toBeUndefined();
      expect(JSON.stringify(valRes.body)).not.toContain('ramesh.kulkarni@gmail.com');
      expect(JSON.stringify(valRes.body)).not.toContain(tenantId);

      // Expired code rejected
      setTestInvitation({
        id: 'inv_expired_code',
        tenantId,
        email: 'expired@sai.test',
        name: 'Expired Staff',
        role: 'helper',
        assignedBranchIds: ['main'],
        joiningCode: 'PDK-2222-3333',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        createdAt: new Date(Date.now() - 73 * 3600_000).toISOString(),
        createdBy: 'owner-uid-1',
      });
      const expiredRes = await request(app)
        .post('/api/v1/joining-codes/validate')
        .send({ joiningCode: 'PDK-2222-3333' });
      expect(expiredRes.status).toBe(400);

      // Invalid guesses trigger generic error then 429 lockout after 8 misses
      for (let i = 0; i < 8; i += 1) {
        const miss = await request(app)
          .post('/api/v1/joining-codes/validate')
          .set('X-Forwarded-For', '203.0.113.77')
          .send({ joiningCode: 'PDK-9999-8888' });
        expect(miss.status).toBe(404);
        expect(miss.body.detail).toBe('This joining code is incorrect.');
      }
      const lockedOut = await request(app)
        .post('/api/v1/joining-codes/validate')
        .set('X-Forwarded-For', '203.0.113.77')
        .send({ joiningCode: joiningCode });
      expect(lockedOut.status).toBe(429);
    });
  });

  describe('4. Code Redemption, Verification, Atomic Concurrency & Multi-Pharmacy Preservation', () => {
    it('enforces verified email, exact invited email match, server-controlled role/branch, and single-use atomic burn', async () => {
      const p1 = await provisionPharmacy(verifiedOwnerToken('owner-a', 'ownera@sai.test'), 'Alpha Pharma', 'k1');
      const tenantA = p1.body.data.tenant.id;
      const p2 = await provisionPharmacy(verifiedOwnerToken('owner-b', 'ownerb@beta.test'), 'Beta Pharma', 'k2');
      const tenantB = p2.body.data.tenant.id;

      await BranchService.listBranches(tenantA);
      await BranchService.createBranch(
        tenantA,
        { id: 'branch-kothrud', branchCode: 'KOT', name: 'Kothrud Branch', address: 'Kothrud' },
        'owner-a'
      );

      const invA = await request(app)
        .post(`/api/v1/tenants/${tenantA}/invitations`)
        .set('Authorization', verifiedOwnerToken('owner-a', 'ownera@sai.test'))
        .send({
          name: 'Priya Pharmacist',
          email: 'Priya@Gmail.com',
          role: 'pharmacist',
          assignedBranchIds: ['branch-kothrud'],
        });
      const codeA = invA.body.joiningCode;

      // 1. Unverified email rejected (403)
      const unverifiedAttempt = await request(app)
        .post('/api/v1/joining-codes/redeem')
        .set('Authorization', unverifiedToken('priya-uid', 'priya@gmail.com'))
        .send({ joiningCode: codeA });
      expect(unverifiedAttempt.status).toBe(403);
      expect(unverifiedAttempt.body.detail).toContain('verify your email');

      // 2. Wrong email rejected (403)
      const wrongEmailAttempt = await request(app)
        .post('/api/v1/joining-codes/redeem')
        .set('Authorization', staffToken('other-uid', 'someoneelse@gmail.com'))
        .send({ joiningCode: codeA });
      expect(wrongEmailAttempt.status).toBe(403);
      expect(wrongEmailAttempt.body.detail).toBe(
        'Please use the email address provided by your pharmacy owner.'
      );

      // 3. Concurrent redemption attempts -> exactly 1 succeeds (200) and 1 fails (409)
      const [r1, r2] = await Promise.all([
        request(app)
          .post('/api/v1/joining-codes/redeem')
          .set('Authorization', staffToken('priya-uid', 'priya@gmail.com'))
          .send({
            joiningCode: codeA,
            role: 'owner', // Attempted tampering must be ignored
            assignedBranchIds: ['main'],
          }),
        request(app)
          .post('/api/v1/joining-codes/redeem')
          .set('Authorization', staffToken('priya-uid', 'priya@gmail.com'))
          .send({ joiningCode: codeA }),
      ]);

      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const winner = r1.status === 200 ? r1 : r2;
      expect(winner.body.data.role).toBe('pharmacist');
      expect(winner.body.data.assignedBranchIds).toEqual(['branch-kothrud']);

      // 4. Subsequent reuse fails cleanly (409)
      const reuse = await request(app)
        .post('/api/v1/joining-codes/redeem')
        .set('Authorization', staffToken('priya-uid', 'priya@gmail.com'))
        .send({ joiningCode: codeA });
      expect(reuse.status).toBe(409);

      // 5. Same employee joins Pharmacy B with a second code -> keeps membership in BOTH
      const invB = await request(app)
        .post(`/api/v1/tenants/${tenantB}/invitations`)
        .set('Authorization', verifiedOwnerToken('owner-b', 'ownerb@beta.test'))
        .send({
          name: 'Priya Pharmacist',
          email: 'priya@gmail.com',
          role: 'auditor',
          assignedBranchIds: ['main'],
        });
      const redeemB = await request(app)
        .post('/api/v1/joining-codes/redeem')
        .set('Authorization', staffToken('priya-uid', 'priya@gmail.com'))
        .send({ joiningCode: invB.body.joiningCode });
      expect(redeemB.status).toBe(200);
      expect(redeemB.body.data.role).toBe('auditor');

      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', staffToken('priya-uid', 'priya@gmail.com'));
      expect(meRes.status).toBe(200);
      expect(meRes.body.memberships.map((m: any) => m.tenantId).sort()).toEqual(
        [tenantA, tenantB].sort()
      );
    });
  });

  describe('5. Owner Staff Lifecycle Actions (Revoke, Regenerate, Role, Suspend, Reactivate, Remove)', () => {
    it('revokes/regenerates joining codes and manages employee status cleanly without deleting history or last owner', async () => {
      const created = await provisionPharmacy(verifiedOwnerToken('owner-main', 'owner@sai.test'));
      const tenantId = created.body.data.tenant.id;
      await BranchService.listBranches(tenantId);
      await BranchService.createBranch(
        tenantId,
        { id: 'counter-2', branchCode: 'C2', name: 'Counter 2', address: 'Annex' },
        'owner-main'
      );

      // Owner issues code, then revokes it -> immediately invalid
      const inv1 = await request(app)
        .post(`/api/v1/tenants/${tenantId}/invitations`)
        .set('Authorization', verifiedOwnerToken('owner-main', 'owner@sai.test'))
        .send({
          name: 'Amit Cashier',
          email: 'amit@sai.test',
          role: 'cashier',
          assignedBranchIds: ['main'],
        });
      const oldCode = inv1.body.joiningCode;
      const invId = inv1.body.data.id;

      const revokeRes = await request(app)
        .post(`/api/v1/tenants/${tenantId}/invitations/${invId}/revoke`)
        .set('Authorization', verifiedOwnerToken('owner-main', 'owner@sai.test'));
      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.data.displayStatus).toBe('Invitation Revoked');

      const validateRevoked = await request(app)
        .post('/api/v1/joining-codes/validate')
        .send({ joiningCode: oldCode });
      expect(validateRevoked.status).toBe(400);

      // Owner regenerates a new code -> old code still dead, new code works
      const regenRes = await request(app)
        .post(`/api/v1/tenants/${tenantId}/invitations/${invId}/regenerate`)
        .set('Authorization', verifiedOwnerToken('owner-main', 'owner@sai.test'));
      expect(regenRes.status).toBe(200);
      const newCode = regenRes.body.joiningCode;
      expect(newCode).not.toBe(oldCode);

      const validateOldAfterRegen = await request(app)
        .post('/api/v1/joining-codes/validate')
        .send({ joiningCode: oldCode });
      expect(validateOldAfterRegen.status).toBe(404);

      const redeemNew = await request(app)
        .post('/api/v1/joining-codes/redeem')
        .set('Authorization', staffToken('amit-uid', 'amit@sai.test'))
        .send({ joiningCode: newCode });
      expect(redeemNew.status).toBe(200);

      // Owner changes Amit role to pharmacist & branch to counter-2
      const roleRes = await request(app)
        .patch(`/api/v1/tenants/${tenantId}/employees/amit-uid/role`)
        .set('Authorization', verifiedOwnerToken('owner-main', 'owner@sai.test'))
        .send({ role: 'pharmacist' });
      expect(roleRes.status).toBe(200);
      expect(roleRes.body.data.role).toBe('pharmacist');
      expect(roleRes.body.data.permissions).toContain('billing.schedule_h1');

      const branchRes = await request(app)
        .patch(`/api/v1/tenants/${tenantId}/employees/amit-uid/branches`)
        .set('Authorization', verifiedOwnerToken('owner-main', 'owner@sai.test'))
        .send({ assignedBranchIds: ['counter-2'] });
      expect(branchRes.status).toBe(200);
      expect(branchRes.body.data.assignedBranchIds).toEqual(['counter-2']);

      // Suspend Amit -> /auth/me moves membership to inactiveMemberships; protected endpoint returns 403
      const suspendRes = await request(app)
        .patch(`/api/v1/tenants/${tenantId}/employees/amit-uid/status`)
        .set('Authorization', verifiedOwnerToken('owner-main', 'owner@sai.test'))
        .send({ status: 'suspended' });
      expect(suspendRes.status).toBe(200);

      const suspendedMe = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', staffToken('amit-uid', 'amit@sai.test'));
      expect(suspendedMe.body.memberships).toEqual([]);
      expect(suspendedMe.body.inactiveMemberships).toHaveLength(1);
      expect(suspendedMe.body.inactiveMemberships[0].status).toBe('suspended');

      const blockedMedRes = await request(app)
        .get('/api/v1/medicines')
        .set({
          Authorization: staffToken('amit-uid', 'amit@sai.test'),
          'X-Tenant-ID': tenantId,
          'X-Branch-ID': 'counter-2',
        });
      expect(blockedMedRes.status).toBe(403);

      // Reactivate Amit -> access restored
      const reactivateRes = await request(app)
        .patch(`/api/v1/tenants/${tenantId}/employees/amit-uid/status`)
        .set('Authorization', verifiedOwnerToken('owner-main', 'owner@sai.test'))
        .send({ status: 'active' });
      expect(reactivateRes.status).toBe(200);

      const restoredMedRes = await request(app)
        .get('/api/v1/medicines')
        .set({
          Authorization: staffToken('amit-uid', 'amit@sai.test'),
          'X-Tenant-ID': tenantId,
          'X-Branch-ID': 'counter-2',
        });
      expect(restoredMedRes.status).toBe(200);

      // Remove Pharmacy Access (deactivated) -> blocked (403) while audit logs remain preserved
      const removeRes = await request(app)
        .patch(`/api/v1/tenants/${tenantId}/employees/amit-uid/status`)
        .set('Authorization', verifiedOwnerToken('owner-main', 'owner@sai.test'))
        .send({ status: 'deactivated' });
      expect(removeRes.status).toBe(200);

      const afterRemoveRes = await request(app)
        .get('/api/v1/medicines')
        .set({
          Authorization: staffToken('amit-uid', 'amit@sai.test'),
          'X-Tenant-ID': tenantId,
          'X-Branch-ID': 'counter-2',
        });
      expect(afterRemoveRes.status).toBe(403);

      expect(getTestAuditLogs(tenantId).length).toBeGreaterThanOrEqual(4);

      // Cannot demote, suspend, or remove last active pharmacy owner
      const demoteLastOwner = await request(app)
        .patch(`/api/v1/tenants/${tenantId}/employees/owner-main/role`)
        .set('Authorization', verifiedOwnerToken('owner-main', 'owner@sai.test'))
        .send({ role: 'pharmacist' });
      expect(demoteLastOwner.status).toBe(400);

      const suspendLastOwner = await request(app)
        .patch(`/api/v1/tenants/${tenantId}/employees/owner-main/status`)
        .set('Authorization', verifiedOwnerToken('owner-main', 'owner@sai.test'))
        .send({ status: 'suspended' });
      expect(suspendLastOwner.status).toBe(400);
    });
  });
});
