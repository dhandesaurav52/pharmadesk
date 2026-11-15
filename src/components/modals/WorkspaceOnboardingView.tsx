/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  KeyRound,
  LogOut,
  Mail,
  RefreshCw,
  AlertCircle,
  ArrowLeft,
} from 'lucide-react';
import { usePharmacy } from '../../context/PharmacyContext.tsx';
import { JoiningCodePreview, workspaceApi } from '../../lib/workspaceApi.ts';
import { generateIdempotencyKey } from '../../lib/customerApi.ts';
import { reloadFirebaseUser, resendVerificationEmail } from '../../lib/firebaseClient.ts';

interface WorkspaceOnboardingViewProps {
  onReturnToSite: () => void;
  onOpenJoinPharmacy?: () => void;
}

export const WorkspaceOnboardingView: React.FC<WorkspaceOnboardingViewProps> = ({
  onReturnToSite,
  onOpenJoinPharmacy,
}) => {
  const {
    firebaseSession,
    apiSession,
    signOutSession,
    refreshMemberships,
    switchWorkspace,
  } = usePharmacy();

  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verificationBusy, setVerificationBusy] = useState(false);

  // Create Pharmacy Form State (no manual slug exposed)
  const [name, setName] = useState('');
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
  const createKeyRef = useRef<string>(generateIdempotencyKey('tenant_setup'));

  // Join via Joining Code State
  const [joiningCode, setJoiningCode] = useState('');
  const [codePreview, setCodePreview] = useState<JoiningCodePreview | null>(null);

  const handleNameChange = (value: string) => {
    setName(value);
    createKeyRef.current = generateIdempotencyKey('tenant_setup');
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
    setNotice(null);
    try {
      const res = await reloadFirebaseUser();
      await refreshMemberships(
        res.idToken ? { bearerToken: res.idToken } : undefined
      );
      if (res.emailVerified) {
        setNotice('Email address verified. You can now set up your pharmacy.');
      } else {
        setNotice('Email is still pending verification. Please check your inbox or spam folder.');
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

    if (!firebaseSession.emailVerified) {
      setError('Please verify your email address before setting up your pharmacy.');
      return;
    }
    if (!name.trim() || name.trim().length < 2) {
      setError('Please enter your pharmacy name.');
      return;
    }
    if (!/^\d{6}$/.test(pincode.trim())) {
      setError('Please enter a valid 6-digit PIN code.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await workspaceApi.createTenant(
        {
          bearerToken: apiSession.bearerToken,
          appCheckToken: apiSession.appCheckToken,
        },
        {
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
        },
        createKeyRef.current
      );
      const newTenantId = created.tenant.id;
      await refreshMemberships({ preferredTenantId: newTenantId });
      await switchWorkspace(newTenantId);
    } catch (err: any) {
      setError(err?.detail || err?.message || 'Unable to create your pharmacy right now.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const cleaned = joiningCode.trim().toUpperCase();
    if (!cleaned) {
      setError('Please enter the joining code provided by your pharmacy owner.');
      return;
    }

    setSubmitting(true);
    try {
      const preview = await workspaceApi.validateJoiningCode(cleaned);
      setCodePreview(preview);
    } catch (err: any) {
      setCodePreview(null);
      setError(err?.detail || err?.message || 'This joining code is incorrect.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRedeemCode = async () => {
    if (!codePreview) return;
    setError(null);
    setNotice(null);
    if (!firebaseSession.emailVerified) {
      setError('Please verify your email address first, then click Join Pharmacy.');
      return;
    }
    setSubmitting(true);
    try {
      const membership = await workspaceApi.redeemJoiningCode(
        {
          bearerToken: apiSession.bearerToken,
          appCheckToken: apiSession.appCheckToken,
        },
        joiningCode.trim().toUpperCase()
      );
      await refreshMemberships({ preferredTenantId: membership.tenantId });
      await switchWorkspace(membership.tenantId);
    } catch (err: any) {
      setError(err?.detail || err?.message || 'Unable to join pharmacy with this code.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header Bar */}
        <div className="bg-white border border-slate-200 rounded-2xl px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold">
              P+
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900">
                Set Up Your Pharmacy
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
                <p className="font-bold">Verify your email address to continue</p>
                <p className="text-amber-800 mt-0.5">
                  We sent a verification link to {firebaseSession.email}. Click the link in your inbox, then click Refresh.
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
                <span>I&apos;ve Verified</span>
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
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
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
              <span>Set Up New Pharmacy</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode('join');
              }}
              className={`py-3.5 px-4 text-xs font-bold flex items-center justify-center gap-2 border-b-2 transition-colors ${
                mode === 'join'
                  ? 'border-blue-600 text-blue-700 bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <KeyRound className="w-4 h-4" />
              <span>Join Existing Pharmacy</span>
            </button>
          </div>

          {mode === 'create' ? (
            <form onSubmit={handleCreatePharmacy} className="p-6 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Enter your medical store details below to set up billing, medicine stock, and your main store counter.
              </p>

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
                    Bill Prefix
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
                  <span>Use 80mm Thermal Receipt format by default (uncheck for A4/A5 Tax Invoice)</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={submitting || !firebaseSession.emailVerified}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-50"
              >
                {submitting
                  ? 'Setting Up Your Pharmacy...'
                  : 'Create Pharmacy & Start Billing'}
              </button>
            </form>
          ) : (
            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Enter the joining code shared by your pharmacy owner. You must be signed in with the invited email address ({firebaseSession.email}).
              </p>

              {!codePreview ? (
                <form onSubmit={handleValidateCode} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Employee Joining Code *
                    </label>
                    <input
                      type="text"
                      required
                      value={joiningCode}
                      onChange={(e) => setJoiningCode(e.target.value.toUpperCase())}
                      placeholder="PDK-XXXX-XXXX"
                      className="w-full px-3 py-2.5 text-sm font-mono uppercase tracking-wider border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-60"
                  >
                    {submitting ? 'Checking Code...' : 'Continue'}
                  </button>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Pharmacy</span>
                      <span className="font-bold text-slate-900">{codePreview.pharmacyName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Assigned Role</span>
                      <span className="font-semibold text-slate-900">{codePreview.assignedRoleLabel}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Assigned Branch</span>
                      <span className="font-medium text-slate-900">
                        {codePreview.assignedBranches.map((b) => b.name).join(', ')}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Invited Email</span>
                      <span className="font-mono text-slate-700">{codePreview.maskedEmail}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCodePreview(null);
                        setError(null);
                      }}
                      className="px-4 py-2.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50"
                    >
                      Change Code
                    </button>
                    <button
                      type="button"
                      disabled={submitting || !firebaseSession.emailVerified}
                      onClick={handleRedeemCode}
                      className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-50"
                    >
                      {submitting ? 'Joining Pharmacy...' : `Join ${codePreview.pharmacyName}`}
                    </button>
                  </div>
                </div>
              )}

              {onOpenJoinPharmacy && (
                <div className="pt-2 border-t border-slate-100 text-center">
                  <button
                    type="button"
                    onClick={onOpenJoinPharmacy}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    Open full Join Pharmacy page
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
