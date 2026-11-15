/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  KeyRound,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  ArrowLeft,
} from 'lucide-react';
import { usePharmacy } from '../../context/PharmacyContext.tsx';
import { workspaceApi } from '../../lib/workspaceApi.ts';
import { reloadFirebaseUser, resendVerificationEmail } from '../../lib/firebaseClient.ts';

interface WorkspaceOnboardingViewProps {
  initialInviteToken?: string | null;
  initialInviteTenantId?: string | null;
  onClearPendingInvite?: () => void;
  onReturnToSite: () => void;
}

export const WorkspaceOnboardingView: React.FC<WorkspaceOnboardingViewProps> = ({
  initialInviteToken,
  initialInviteTenantId,
  onClearPendingInvite,
  onReturnToSite,
}) => {
  const {
    firebaseSession,
    apiSession,
    signOutSession,
    refreshMemberships,
    switchWorkspace,
  } = usePharmacy();

  const [mode, setMode] = useState<'create' | 'invite'>(
    initialInviteToken || initialInviteTenantId ? 'invite' : 'create'
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verificationBusy, setVerificationBusy] = useState(false);

  // Create Pharmacy Form State
  const [name, setName] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [tenantIdEdited, setTenantIdEdited] = useState(false);
  const [dlNumber20B, setDlNumber20B] = useState('');
  const [dlNumber21B, setDlNumber21B] = useState('');
  const [gstin, setGstin] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('Maharashtra');
  const [pincode, setPincode] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState(firebaseSession.email || '');
  const [invoicePrefix, setInvoicePrefix] = useState('INV');
  const [thermalPrinter, setThermalPrinter] = useState(true);

  // Join via Staff Invitation State
  const [inviteTenantId, setInviteTenantId] = useState(initialInviteTenantId || '');
  const [inviteToken, setInviteToken] = useState(initialInviteToken || '');

  const suggestedSlug = useMemo(() => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }, [name]);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!tenantIdEdited) {
      const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
      setTenantId(slug);
    }
    if (invoicePrefix === 'INV' && value.trim().length >= 3) {
      const autoPrefix = value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
      if (autoPrefix.length >= 2) {
        setInvoicePrefix(autoPrefix);
      }
    }
  };

  const handleResendVerification = async () => {
    setVerificationBusy(true);
    setError(null);
    setNotice(null);
    try {
      await resendVerificationEmail();
      setNotice(`Verification link sent to ${firebaseSession.email || 'your email'}.`);
    } catch (err: any) {
      setError(err?.message || 'Unable to resend verification email.');
    } finally {
      setVerificationBusy(false);
    }
  };

  const handleCheckVerification = async () => {
    setVerificationBusy(true);
    setError(null);
    try {
      const res = await reloadFirebaseUser();
      await refreshMemberships();
      if (res.emailVerified) {
        setNotice('Email address verified.');
      } else {
        setNotice('Email is still pending verification. Please check your inbox/spam folder.');
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to refresh verification status.');
    } finally {
      setVerificationBusy(false);
    }
  };

  const handleCreatePharmacy = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const cleanTenantId = (tenantId || suggestedSlug).trim().toLowerCase();
    if (!/^[a-z0-9-]{3,64}$/.test(cleanTenantId)) {
      setError('Workspace ID must be 3–64 lowercase letters, numbers, or hyphens.');
      return;
    }
    if (!/^\d{6}$/.test(pincode.trim())) {
      setError('Enter a valid 6-digit PIN code.');
      return;
    }

    setSubmitting(true);
    try {
      await workspaceApi.createTenant(
        {
          bearerToken: apiSession.bearerToken,
          appCheckToken: apiSession.appCheckToken,
        },
        {
          tenantId: cleanTenantId,
          name: name.trim(),
          dlNumber20B: dlNumber20B.trim(),
          dlNumber21B: dlNumber21B.trim(),
          gstin: gstin.trim().toUpperCase() || undefined,
          address: address.trim(),
          city: city.trim(),
          state: state.trim(),
          pincode: pincode.trim(),
          contactPhone: contactPhone.trim(),
          contactEmail: contactEmail.trim(),
          invoicePrefix: invoicePrefix.trim().toUpperCase() || 'INV',
          thermalPrinter,
        }
      );
      await refreshMemberships();
      switchWorkspace(cleanTenantId);
    } catch (err: any) {
      setError(err?.detail || err?.message || 'Failed to create pharmacy workspace.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcceptInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!inviteTenantId.trim() || !inviteToken.trim()) {
      setError('Enter both Pharmacy Workspace ID and Invitation Token.');
      return;
    }

    setSubmitting(true);
    try {
      const membership = await workspaceApi.acceptInvitation(
        {
          bearerToken: apiSession.bearerToken,
          appCheckToken: apiSession.appCheckToken,
        },
        {
          tenantId: inviteTenantId.trim(),
          token: inviteToken.trim(),
        }
      );
      onClearPendingInvite?.();
      await refreshMemberships();
      switchWorkspace(membership.tenantId);
    } catch (err: any) {
      setError(err?.detail || err?.message || 'Invalid or expired staff invitation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header Bar */}
        <div className="bg-white border border-slate-200 rounded-2xl px-6 py-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold">
              P+
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900">
                Complete Pharmacy Workspace Setup
              </h1>
              <p className="text-xs text-slate-500">
                Signed in as <span className="font-medium text-slate-700">{firebaseSession.email}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onReturnToSite}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Website</span>
            </button>
            <button
              type="button"
              onClick={() => void signOutSession()}
              className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg inline-flex items-center gap-1"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Email Verification Notice */}
        {!firebaseSession.emailVerified && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 text-xs text-amber-900">
              <Mail className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Verify your email address</p>
                <p className="text-amber-800 mt-0.5">
                  Check your inbox for the Firebase verification link so you can recover your account cleanly if needed.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={verificationBusy}
                onClick={handleResendVerification}
                className="px-3 py-1.5 bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 rounded-lg text-xs font-semibold"
              >
                Resend Email
              </button>
              <button
                type="button"
                disabled={verificationBusy}
                onClick={handleCheckVerification}
                className="px-3 py-1.5 bg-amber-900 text-white hover:bg-amber-800 rounded-lg text-xs font-semibold inline-flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Refresh</span>
              </button>
            </div>
          </div>
        )}

        {notice && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-medium text-rose-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Onboarding Card */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50/70">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode('create');
              }}
              className={`py-3.5 px-4 text-xs font-bold flex items-center justify-center gap-2 border-b-2 transition-colors ${
                mode === 'create'
                  ? 'border-blue-600 text-blue-700 bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>Create New Pharmacy Store</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode('invite');
              }}
              className={`py-3.5 px-4 text-xs font-bold flex items-center justify-center gap-2 border-b-2 transition-colors ${
                mode === 'invite'
                  ? 'border-blue-600 text-blue-700 bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <KeyRound className="w-4 h-4" />
              <span>Join Existing Pharmacy (Invite)</span>
            </button>
          </div>

          {mode === 'create' ? (
            <form onSubmit={handleCreatePharmacy} className="p-6 space-y-4">
              <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span>
                  Provisioning creates your isolated Cloud Firestore tenant, default <strong>Main Store</strong> branch, and Owner permissions.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Pharmacy Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="e.g. Shree Sai Medical & General"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Workspace ID (URL Slug) *
                  </label>
                  <input
                    type="text"
                    required
                    value={tenantId}
                    onChange={(e) => {
                      setTenantIdEdited(true);
                      setTenantId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                    }}
                    placeholder="shree-sai-medical"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Drug License 20B *
                  </label>
                  <input
                    type="text"
                    required
                    value={dlNumber20B}
                    onChange={(e) => setDlNumber20B(e.target.value)}
                    placeholder="MH-MZ4-20B-1024"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Drug License 21B *
                  </label>
                  <input
                    type="text"
                    required
                    value={dlNumber21B}
                    onChange={(e) => setDlNumber21B(e.target.value)}
                    placeholder="MH-MZ4-21B-1025"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    GSTIN (Optional)
                  </label>
                  <input
                    type="text"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    placeholder="27AABCS1429B1Z8"
                    className="w-full px-3 py-2 text-xs font-mono uppercase border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Shop Address *
                </label>
                <input
                  type="text"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Shop 4, Station Road, Near City Hospital"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">City *</label>
                  <input
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Pune"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">State *</label>
                  <input
                    type="text"
                    required
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    placeholder="Maharashtra"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    PIN Code *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={pincode}
                    onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
                    placeholder="411001"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Store Phone *
                  </label>
                  <input
                    type="tel"
                    required
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="+91 98201 44820"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Contact Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="owner@pharmacy.in"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Invoice Prefix
                  </label>
                  <input
                    type="text"
                    maxLength={10}
                    value={invoicePrefix}
                    onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 text-xs font-mono uppercase border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={thermalPrinter}
                    onChange={(e) => setThermalPrinter(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Use 80mm Thermal POS Receipt layout by default (uncheck for A4/A5 Tax Invoice)</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-60"
              >
                {submitting ? 'Creating Pharmacy Workspace...' : 'Create Pharmacy Workspace & Start Billing'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleAcceptInvitation} className="p-6 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Ask your pharmacy owner to share your staff invitation link or paste your Pharmacy Workspace ID and Invitation Token below. You must be signed in with the invited email ({firebaseSession.email}).
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Pharmacy Workspace ID *
                </label>
                <input
                  type="text"
                  required
                  value={inviteTenantId}
                  onChange={(e) => setInviteTenantId(e.target.value.trim())}
                  placeholder="e.g. shree-sai-medical"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Invitation Token *
                </label>
                <input
                  type="text"
                  required
                  value={inviteToken}
                  onChange={(e) => setInviteToken(e.target.value.trim())}
                  placeholder="Paste 64-character token from invitation link"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-60"
              >
                {submitting ? 'Activating Membership...' : 'Accept Staff Invitation'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
