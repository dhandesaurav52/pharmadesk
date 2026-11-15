import { Router, Request, Response } from 'express';
import { firebaseAuthMiddleware } from '../middleware/firebaseAuth';
import { asyncHandler } from '../lib/asyncHandler';
import { adminAuth, firestore } from '../lib/firebaseAdmin';
import { logger } from '../lib/logger';
import { AuditService } from '../services/auditService';
import { getAllTestMembershipsForUser } from '../middleware/tenantAuthorization';
import { getTestTenant } from '../services/tenantService';

export const authRouter = Router();

// Protect all /auth endpoints with Firebase ID token validation
authRouter.use(firebaseAuthMiddleware);

/**
 * GET /api/v1/auth/me
 * Returns the currently authenticated user's profile, active pharmacy memberships,
 * and paused/inactive membership summaries so the client can show appropriate status messages.
 */
authRouter.get(
  '/me',
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

    const memberships: any[] = [];
    const inactiveMemberships: Array<{
      tenantId: string;
      tenantName?: string;
      role: string;
      status: string;
    }> = [];

    if (isTestEnv) {
      const all = getAllTestMembershipsForUser(user.uid);
      for (const m of all) {
        const tenant = getTestTenant(m.tenantId);
        if (m.status === 'active') {
          memberships.push({
            ...m,
            tenantName: (m as any).tenantName || tenant?.name || undefined,
          });
        } else {
          inactiveMemberships.push({
            tenantId: m.tenantId,
            tenantName: (m as any).tenantName || tenant?.name || undefined,
            role: m.role,
            status: m.status,
          });
        }
      }
    } else {
      const db = firestore();
      try {
        const snap = await db
          .collectionGroup('memberships')
          .where('userId', '==', user.uid)
          .get();

        const rawDocs = snap.docs.map((doc) => doc.data() as any);
        const tenantIds = Array.from(new Set(rawDocs.map((d) => String(d.tenantId || '')).filter(Boolean)));
        const tenantNames = new Map<string, string>();
        await Promise.all(
          tenantIds.map(async (tId) => {
            try {
              const tSnap = await db.collection('tenants').doc(tId).get();
              if (tSnap.exists) {
                const tData = tSnap.data() as { name?: string; status?: string } | undefined;
                if (tData?.name) tenantNames.set(tId, tData.name);
              }
            } catch {
              // Best-effort tenant name lookup
            }
          })
        );

        for (const m of rawDocs) {
          const tenantName = m.tenantName || tenantNames.get(m.tenantId);
          if (m.status === 'active') {
            memberships.push({
              ...m,
              ...(tenantName ? { tenantName } : {}),
            });
          } else if (m.status === 'suspended' || m.status === 'deactivated') {
            inactiveMemberships.push({
              tenantId: m.tenantId,
              tenantName,
              role: m.role,
              status: m.status,
            });
          }
        }
      } catch (err: any) {
        logger.warn(
          { requestId: req.id, uid: user.uid, err: err?.message },
          'Failed to query memberships collectionGroup in /auth/me'
        );
      }
    }

    res.status(200).json({
      uid: user.uid,
      email: user.email || null,
      emailVerified: user.emailVerified ?? false,
      phoneNumber: user.phoneNumber || null,
      memberships,
      inactiveMemberships,
    });
  })
);

/**
 * POST /api/v1/auth/logout
 * Revokes Firebase refresh tokens for the authenticated session and logs an audit event.
 */
authRouter.post(
  '/logout',
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

    let tokensRevoked = false;
    if (!isTestEnv) {
      try {
        await adminAuth().revokeRefreshTokens(user.uid);
        tokensRevoked = true;
      } catch (err: any) {
        logger.warn(
          { requestId: req.id, uid: user.uid, err: err?.message },
          'Best-effort Firebase refresh token revocation failed during logout'
        );
      }
    }

    const headerTenantId = String(req.headers['x-tenant-id'] || '').trim();
    if (/^[a-zA-Z0-9_-]{3,64}$/.test(headerTenantId)) {
      await AuditService.log({
        tenantId: headerTenantId,
        category: 'auth',
        severity: 'info',
        requestId: req.id,
        actingUserId: user.uid,
        action: 'auth.logout',
        ip: req.ip,
        metadata: { tokensRevoked },
      });
    } else {
      logger.info(
        { requestId: req.id, uid: user.uid, tokensRevoked, ip: req.ip },
        'User logged out and session revocation processed'
      );
    }

    res.status(200).json({
      success: true,
      message: 'Session revoked and signed out cleanly',
      data: {
        uid: user.uid,
        tokensRevoked,
      },
    });
  })
);
