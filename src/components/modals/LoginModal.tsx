/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  X,
  Lock,
  Mail,
  CheckCircle2,
  AlertCircle,
  LogOut,
  KeyRound,
  UserPlus,
  User as UserIcon,
  Building2,
} from 'lucide-react';
import { usePharmacy } from '../../context/PharmacyContext.tsx';
import {
  reloadFirebaseUser,
  requestPasswordReset,
  resendVerificationEmail,
  signInWithEmail,
  signUpWithEmail,
} from '../../lib/firebaseClient.ts';

interface LoginModalProps {
  onEnterWorkspace?: () => void;
  onJoinPharmacy?: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  onEnterWorkspace,
  onJoinPharmacy,
}) => {
  const {
    isLoginModalOpen,
    setIsLoginModalOpen,
    firebaseSession,
    refreshMemberships,
    signOutSession,
  } = usePharmacy();

  const [viewMode, setViewMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginNotification, setLoginNotification] = useState<string | null>(null);

  if (!isLoginModalOpen) return null;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setLoginNotification(null);
    setIsSubmitting(true);
    try {
      const { user, idToken, appCheckToken } = await signInWithEmail(email, password);
      await refreshMemberships({ bearerToken: idToken, appCheckToken });
      setLoginNotification(`Signed in as ${user.email || 'your account'}`);
      setPassword('');
      setTimeout(() => {
        setLoginNotification(null);
        setIsLoginModalOpen(false);
        onEnterWorkspace?.();
      }, 400);
    } catch (err: any) {
      const code = err?.code || '';
      if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found'
      ) {
        setAuthError('Incorrect email or password.');
      } else if (code === 'auth/user-disabled') {
        setAuthError('This account has been disabled. Contact your pharmacy owner.');
      } else if (code === 'auth/too-many-requests') {
        setAuthError('Too many failed attempts. Please wait a few minutes or reset your password.');
      } else {
        setAuthError(err?.message || 'Unable to sign in right now. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setLoginNotification(null);
    if (!fullName.trim()) {
      setAuthError('Please enter your full name.');
      return;
    }
    if (password.length < 6) {
      setAuthError('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setAuthError('Passwords do not match.');
      return;
    }
    setIsSubmitting(true);
    try {
      const { user, idToken, appCheckToken } = await signUpWithEmail({
        email,
        password,
        displayName: fullName,
      });
      await refreshMemberships({ bearerToken: idToken, appCheckToken });
      setLoginNotification(
        `Account created for ${user.email}. Check your email to verify, then set up your pharmacy.`
      );
      setPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setLoginNotification(null);
        setIsLoginModalOpen(false);
        onEnterWorkspace?.();
      }, 700);
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/email-already-in-use') {
        setAuthError('An account with this email already exists. Please sign in instead.');
      } else if (code === 'auth/weak-password') {
        setAuthError('Please choose a stronger password (at least 6 characters).');
      } else {
        setAuthError(err?.message || 'Unable to create your account right now.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setLoginNotification(null);
    setIsSubmitting(true);
    try {
      await requestPasswordReset(email);
      setLoginNotification(`Password reset instructions sent to ${email.trim()}.`);
      setViewMode('signin');
    } catch (err: any) {
      setAuthError(err?.message || 'Unable to send password reset email.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    setAuthError(null);
    setIsSubmitting(true);
    try {
      await resendVerificationEmail();
      setLoginNotification(`Verification email sent to ${firebaseSession.email || 'your email'}.`);
    } catch (err: any) {
      setAuthError(err?.message || 'Unable to send verification email.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRefreshVerification = async () => {
    setAuthError(null);
    setIsSubmitting(true);
    try {
      const res = await reloadFirebaseUser();
      if (res.idToken) {
        await refreshMemberships({ bearerToken: res.idToken });
      }
      if (res.emailVerified) {
        setLoginNotification('Your email address is verified.');
      } else {
        setAuthError('Verification is still pending. Please click the link sent to your email.');
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Unable to check verification status.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setAuthError(null);
    setIsSubmitting(true);
    try {
      await signOutSession();
      setLoginNotification('You have been signed out.');
    } catch (err: any) {
      setAuthError(err?.message || 'Unable to sign out right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden my-6">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
              P+
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {firebaseSession.authenticated
                  ? 'My PharmaDesk Account'
                  : viewMode === 'signup'
                  ? 'Create Pharmacy Account'
                  : viewMode === 'reset'
                  ? 'Reset Your Password'
                  : 'Welcome Back'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {firebaseSession.authenticated
                  ? firebaseSession.email || 'Signed in'
                  : 'Sign in to your PharmaDesk pharmacy'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsLoginModalOpen(false)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200"
            aria-label="Close account modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loginNotification && (
          <div className="p-3 bg-emerald-50 border-b border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{loginNotification}</span>
          </div>
        )}

        {(authError || firebaseSession.authError) && (
          <div className="p-3 bg-rose-50 border-b border-rose-200 text-xs font-medium text-rose-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{authError || firebaseSession.authError}</span>
          </div>
        )}

        <div className="p-6 space-y-4">
          {firebaseSession.authenticated ? (
            <div className="space-y-3">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5 text-xs">
                <div className="font-semibold text-slate-900">Signed in account</div>
                <div className="text-slate-700">{firebaseSession.email}</div>
                <div className="text-[11px] text-slate-500">
                  Email status:{' '}
                  <span
                    className={
                      firebaseSession.emailVerified
                        ? 'text-emerald-700 font-semibold'
                        : 'text-amber-700 font-semibold'
                    }
                  >
                    {firebaseSession.emailVerified ? 'Verified' : 'Verification pending'}
                  </span>
                </div>
              </div>

              {!firebaseSession.emailVerified && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleResendVerification}
                    className="py-2 px-3 rounded-lg bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-900 text-xs font-semibold"
                  >
                    Resend Email
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleRefreshVerification}
                    className="py-2 px-3 rounded-lg bg-amber-900 hover:bg-amber-800 text-white text-xs font-semibold"
                  >
                    I Have Verified
                  </button>
                </div>
              )}

              {onEnterWorkspace && (
                <button
                  type="button"
                  onClick={() => {
                    setIsLoginModalOpen(false);
                    onEnterWorkspace();
                  }}
                  className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                >
                  Open Pharmacy Workspace
                </button>
              )}

              {onJoinPharmacy && (
                <button
                  type="button"
                  onClick={() => {
                    setIsLoginModalOpen(false);
                    onJoinPharmacy();
                  }}
                  className="w-full py-2 px-4 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                >
                  <Building2 className="w-3.5 h-3.5 text-slate-500" />
                  <span>Join Another Pharmacy with Code</span>
                </button>
              )}

              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleSignOut}
                className="w-full py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          ) : firebaseSession.configured ? (
            <div className="space-y-4">
              {viewMode !== 'reset' && (
                <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-lg text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError(null);
                      setLoginNotification(null);
                      setViewMode('signin');
                    }}
                    className={`py-1.5 rounded-md transition-colors ${
                      viewMode === 'signin'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError(null);
                      setLoginNotification(null);
                      setViewMode('signup');
                    }}
                    className={`py-1.5 rounded-md transition-colors ${
                      viewMode === 'signup'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Create Pharmacy Account
                  </button>
                </div>
              )}

              {viewMode === 'signin' ? (
                <form onSubmit={handleSignIn} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@yourpharmacy.in"
                        className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="password"
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-60"
                  >
                    {isSubmitting ? 'Signing In...' : 'Sign In'}
                  </button>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthError(null);
                        setViewMode('reset');
                      }}
                      className="text-[11px] font-medium text-blue-600 hover:text-blue-700"
                    >
                      Forgot Password?
                    </button>
                  </div>
                </form>
              ) : viewMode === 'signup' ? (
                <form onSubmit={handleSignUp} className="space-y-3">
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    For pharmacy owners setting up a new store. Joining an existing store? Use your joining code below.
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Your Full Name *
                    </label>
                    <div className="relative">
                      <UserIcon className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="e.g. Rajesh Deshmukh"
                        className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Email Address *
                    </label>
                    <div className="relative">
                      <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="owner@yourpharmacy.in"
                        className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
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
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
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
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>{isSubmitting ? 'Creating Account...' : 'Create Pharmacy Account'}</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handlePasswordReset} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Registered Email Address
                    </label>
                    <div className="relative">
                      <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@yourpharmacy.in"
                        className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-60"
                  >
                    {isSubmitting ? 'Sending Reset Link...' : 'Send Password Reset Link'}
                  </button>
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthError(null);
                        setViewMode('signin');
                      }}
                      className="text-[11px] font-medium text-slate-600 hover:text-slate-800"
                    >
                      Back to Sign In
                    </button>
                  </div>
                </form>
              )}

              {onJoinPharmacy && (
                <div className="pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      setIsLoginModalOpen(false);
                      onJoinPharmacy();
                    }}
                    className="w-full py-2.5 px-4 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                  >
                    <Building2 className="w-3.5 h-3.5 text-blue-600" />
                    <span>Join Existing Pharmacy</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
              Sign-in service is currently unavailable. Please contact support for assistance.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
