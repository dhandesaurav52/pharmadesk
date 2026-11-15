/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Mail,
  RefreshCw,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { usePharmacy } from '../context/PharmacyContext.tsx';
import { JoiningCodePreview, workspaceApi } from '../lib/workspaceApi.ts';
import {
  reloadFirebaseUser,
  resendVerificationEmail,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from '../lib/firebaseClient.ts';

interface JoinPharmacyPageProps {
  onBackToSite: () => void;
  onJoinedWorkspace: (tenantId: string) => void;
}

export const JoinPharmacyPage: React.FC<JoinPharmacyPageProps> = ({
  onBackToSite,
  onJoinedWorkspace,
}) => {
  const {
    firebaseSession,
    apiSession,
    refreshMemberships,
    switchWorkspace,
    signOutSession,
  } = usePharmacy();

  const [step, setStep] = useState<'code' | 'account' | 'verify'>('code');
  const [joiningCode, setJoiningCode] = useState('');
  const [preview, setPreview] = useState<JoiningCodePreview | null>(null);
  const [authTab, setAuthTab] = useState<'signup' | 'signin'>('signup');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleValidateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const cleaned = joiningCode.trim().toUpperCase();
    if (!cleaned) {
      setError('Please enter your joining code.');
      return;
    }

    setBusy(true);
    try {
      const data = await workspaceApi.validateJoiningCode(cleaned);
      setJoiningCode(cleaned);
      setPreview(data);
      setStep('account');
    } catch (err: any) {
      setError(err?.detail || err?.message || 'This joining code is incorrect.');
    } finally {
      setBusy(false);
    }
  };

  const redeemWithToken = async (bearerToken: string, appCheckToken: string | null) => {
    const membership = await workspaceApi.redeemJoiningCode(
      { bearerToken, appCheckToken },
      joiningCode
    );
    await refreshMemberships({
      bearerToken,
      appCheckToken,
      preferredTenantId: membership.tenantId,
    });
    await switchWorkspace(membership.tenantId);
    onJoinedWorkspace(membership.tenantId);
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!fullName.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const res = await signUpWithEmail({
        email: email.trim(),
        password,
        displayName: fullName.trim(),
      });
      setPassword('');
      setConfirmPassword('');
      if (res.user.emailVerified) {
        await redeemWithToken(res.idToken, res.appCheckToken);
      } else {
        setNotice(`Verification link sent to ${res.user.email}. Check your email to verify, then continue.`);
        setStep('verify');
      }
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/email-already-in-use') {
        setError('An account with this email already exists. Switch to Sign In instead.');
      } else if (code === 'auth/weak-password') {
        setError('Please choose a stronger password (at least 6 characters).');
      } else if (code === 'auth/operation-not-allowed') {
        setError(
          'Email/password sign-up is not yet enabled in Firebase Console. Use "Continue with Google" below or enable Email/Password under Authentication → Sign-in method.'
        );
      } else {
        setError(err?.detail || err?.message || 'Unable to create your account right now.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await signInWithEmail(email.trim(), password);
      setPassword('');
      if (res.user.emailVerified) {
        await redeemWithToken(res.idToken, res.appCheckToken);
      } else {
        setNotice('Please verify your email address before joining the pharmacy.');
        setStep('verify');
      }
    } catch (err: any) {
      const code = err?.code || '';
      if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found'
      ) {
        setError('Incorrect email or password.');
      } else if (code === 'auth/operation-not-allowed') {
        setError(
          'Email/password sign-in is not yet enabled in Firebase Console. Use "Continue with Google" below or enable Email/Password under Authentication → Sign-in method.'
        );
      } else {
        setError(err?.detail || err?.message || 'Unable to sign in.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleJoin = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await signInWithGoogle();
      if (res.user.emailVerified) {
        await redeemWithToken(res.idToken, res.appCheckToken);
      } else {
        setNotice('Please verify your email address before joining the pharmacy.');
        setStep('verify');
      }
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError('Google sign-in was cancelled. Please try again.');
      } else if (code === 'auth/popup-blocked') {
        setError('Pop-up was blocked by your browser. Please allow pop-ups and try again.');
      } else {
        setError(err?.detail || err?.message || 'Unable to sign in with Google.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleJoinAsSignedInUser = async () => {
    setError(null);
    setNotice(null);
    if (!firebaseSession.emailVerified) {
      setStep('verify');
      return;
    }
    if (!apiSession.bearerToken) {
      setError('Please sign in again to continue.');
      return;
    }
    setBusy(true);
    try {
      await redeemWithToken(apiSession.bearerToken, apiSession.appCheckToken ?? null);
    } catch (err: any) {
      setError(err?.detail || err?.message || 'Unable to join pharmacy with this code.');
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await resendVerificationEmail();
      setNotice(`Verification email sent to ${firebaseSession.email || email}.`);
    } catch (err: any) {
      setError(err?.message || 'Unable to send verification email.');
    } finally {
      setBusy(false);
    }
  };

  const handleContinueAfterVerify = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await reloadFirebaseUser();
      if (!res.emailVerified || !res.idToken) {
        setError('Your email is not verified yet. Please open the verification link sent to your email.');
        return;
      }
      await redeemWithToken(res.idToken, apiSession.appCheckToken ?? null);
    } catch (err: any) {
      setError(err?.detail || err?.message || 'Unable to complete onboarding.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4">
      <div className="max-w-lg w-full mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBackToSite}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Home</span>
          </button>
          <span className="text-xs font-bold text-slate-900">PharmaDesk</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/70 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900">Join Your Pharmacy</h1>
              <p className="text-xs text-slate-500">
                Enter the joining code provided by your pharmacy owner.
              </p>
            </div>
          </div>

          {notice && (
            <div className="px-6 py-3 bg-emerald-50 border-b border-emerald-200 text-xs font-medium text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          {error && (
            <div className="px-6 py-3 bg-rose-50 border-b border-rose-200 text-xs font-medium text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="p-6 space-y-5">
            {step === 'code' && (
              <form onSubmit={handleValidateCode} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Employee Joining Code *
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={joiningCode}
                    onChange={(e) => setJoiningCode(e.target.value.toUpperCase())}
                    placeholder="PDK-XXXX-XXXX"
                    className="w-full px-4 py-3 text-base font-mono uppercase tracking-widest border border-slate-300 rounded-xl focus:outline-hidden focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20"
                  />
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Ask your store owner for your personal joining code (for example, PDK-8K4M-9P2X).
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl disabled:opacity-60"
                >
                  {busy ? 'Checking Code...' : 'Continue'}
                </button>
              </form>
            )}

            {step !== 'code' && preview && (
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <Building2 className="w-4 h-4 text-blue-600" />
                    <span>{preview.pharmacyName}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setStep('code');
                      setPreview(null);
                      setError(null);
                      setNotice(null);
                    }}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                  >
                    Change Code
                  </button>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Assigned Role</span>
                  <span className="font-semibold text-slate-900">{preview.assignedRoleLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Assigned Branch</span>
                  <span className="font-medium text-slate-900">
                    {preview.assignedBranches.map((b) => b.name).join(', ')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Invited Email</span>
                  <span className="font-mono text-slate-700">{preview.maskedEmail}</span>
                </div>
              </div>
            )}

            {step === 'account' && preview && (
              <>
                {firebaseSession.authenticated ? (
                  <div className="space-y-3">
                    <div className="p-3.5 rounded-xl border border-blue-200 bg-blue-50/50 text-xs space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                        <ShieldCheck className="w-4 h-4 text-blue-600" />
                        <span>Signed in as {firebaseSession.email}</span>
                      </div>
                      <p className="text-slate-600">
                        Make sure this matches your invited email ({preview.maskedEmail}).
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleJoinAsSignedInUser}
                      className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl disabled:opacity-60"
                    >
                      {busy ? 'Joining Pharmacy...' : `Join ${preview.pharmacyName}`}
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void signOutSession()}
                      className="w-full py-2 px-4 border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1.5"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Use a Different Account</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-lg text-xs font-semibold">
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setAuthTab('signup');
                        }}
                        className={`py-1.5 rounded-md transition-colors ${
                          authTab === 'signup'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Create Account
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setAuthTab('signin');
                        }}
                        className={`py-1.5 rounded-md transition-colors ${
                          authTab === 'signin'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Sign In
                      </button>
                    </div>

                    {authTab === 'signup' ? (
                      <form onSubmit={handleCreateAccount} className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Full Name *
                          </label>
                          <input
                            type="text"
                            required
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            placeholder="Your full name"
                            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Email Address * (must match {preview.maskedEmail})
                          </label>
                          <input
                            type="email"
                            required
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Enter the email invited by your owner"
                            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2.5">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              Password *
                            </label>
                            <input
                              type="password"
                              required
                              minLength={6}
                              autoComplete="new-password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              placeholder="Min 6 chars"
                              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              Confirm Password *
                            </label>
                            <input
                              type="password"
                              required
                              minLength={6}
                              autoComplete="new-password"
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                              placeholder="Re-enter"
                              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                            />
                          </div>
                        </div>
                        <button
                          type="submit"
                          disabled={busy}
                          className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl disabled:opacity-60"
                        >
                          {busy ? 'Creating Account...' : 'Create Account & Join'}
                        </button>
                      </form>
                    ) : (
                      <form onSubmit={handleSignIn} className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Email Address * (must match {preview.maskedEmail})
                          </label>
                          <input
                            type="email"
                            required
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Enter your email"
                            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Password *
                          </label>
                          <input
                            type="password"
                            required
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={busy}
                          className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl disabled:opacity-60"
                        >
                          {busy ? 'Signing In...' : `Sign In & Join ${preview.pharmacyName}`}
                        </button>
                      </form>
                    )}

                    <div className="space-y-2.5 pt-1">
                      <div className="relative flex items-center justify-center">
                        <div className="border-t border-slate-200 w-full" />
                        <span className="bg-white px-2.5 text-[11px] font-medium text-slate-400 shrink-0">
                          or continue with
                        </span>
                        <div className="border-t border-slate-200 w-full" />
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleGoogleJoin}
                        className="w-full py-2.5 px-4 border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                      >
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            fill="#4285F4"
                            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                          />
                          <path
                            fill="#34A853"
                            d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                          />
                          <path
                            fill="#EA4335"
                            d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                          />
                        </svg>
                        <span>Continue with Google ({preview.maskedEmail})</span>
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {step === 'verify' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1.5">
                  <div className="flex items-center gap-2 font-bold">
                    <Mail className="w-4 h-4 text-amber-700" />
                    <span>Verify your email address</span>
                  </div>
                  <p className="text-amber-800 leading-relaxed">
                    Open the verification email sent to{' '}
                    <span className="font-semibold">{firebaseSession.email || email}</span> and click the link. Then click Continue below.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleResendVerification}
                    className="px-4 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-semibold"
                  >
                    Resend Email
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleContinueAfterVerify}
                    className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{busy ? 'Checking...' : "I've Verified — Join Pharmacy"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
