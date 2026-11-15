/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  Auth,
  browserLocalPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  onIdTokenChanged,
  connectAuthEmulator,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  Firestore,
  doc,
  getDocFromServer,
} from 'firebase/firestore';
import {
  initializeAppCheck,
  AppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider,
  getToken as getFirebaseAppCheckToken,
} from 'firebase/app-check';

export interface FirebaseClientStatus {
  configured: boolean;
  projectId: string | null;
  authDomain: string | null;
  firestoreDatabaseId: string | null;
  appCheckConfigured: boolean;
  emulatorConnected: boolean;
}

interface AppletFirebaseConfigJson {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  firestoreDatabaseId?: string;
  recaptchaSiteKey?: string;
}

const appletConfigModules = import.meta.glob('/firebase-applet-config.json', {
  eager: true,
}) as Record<string, { default?: AppletFirebaseConfigJson } | AppletFirebaseConfigJson>;

function readAppletConfig(): AppletFirebaseConfigJson {
  const mod = appletConfigModules['/firebase-applet-config.json'];
  if (!mod) return {};
  return ('default' in mod && mod.default ? mod.default : mod) as AppletFirebaseConfigJson;
}

const appletConfig = readAppletConfig();

const firebaseConfig = {
  apiKey: String(import.meta.env.VITE_FIREBASE_API_KEY || appletConfig.apiKey || '').trim(),
  authDomain: String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || appletConfig.authDomain || '').trim(),
  projectId: String(import.meta.env.VITE_FIREBASE_PROJECT_ID || appletConfig.projectId || '').trim(),
  storageBucket: String(
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || appletConfig.storageBucket || ''
  ).trim(),
  messagingSenderId: String(
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || appletConfig.messagingSenderId || ''
  ).trim(),
  appId: String(import.meta.env.VITE_FIREBASE_APP_ID || appletConfig.appId || '').trim(),
};

const firestoreDatabaseId = String(
  import.meta.env.VITE_FIRESTORE_DATABASE_ID || appletConfig.firestoreDatabaseId || ''
).trim();

const recaptchaSiteKey = String(
  import.meta.env.VITE_FIREBASE_APPCHECK_RECAPTCHA_SITE_KEY || appletConfig.recaptchaSiteKey || ''
).trim();
const appCheckProviderType = String(import.meta.env.VITE_FIREBASE_APPCHECK_PROVIDER || 'v3')
  .trim()
  .toLowerCase();
const authEmulatorUrl = String(import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL || '').trim();

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let appCheckInstance: AppCheck | null = null;
let emulatorConnected = false;
let connectionCheckRan = false;

export function isFirebaseClientConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId
  );
}

export function getFirebaseClientStatus(): FirebaseClientStatus {
  return {
    configured: isFirebaseClientConfigured(),
    projectId: firebaseConfig.projectId || null,
    authDomain: firebaseConfig.authDomain || null,
    firestoreDatabaseId: firestoreDatabaseId || null,
    appCheckConfigured: Boolean(recaptchaSiteKey),
    emulatorConnected,
  };
}

function ensureFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseClientConfigured()) {
    return null;
  }
  if (appInstance) {
    return appInstance;
  }
  appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

  if (recaptchaSiteKey && typeof window !== 'undefined' && !appCheckInstance) {
    try {
      const provider =
        appCheckProviderType === 'enterprise'
          ? new ReCaptchaEnterpriseProvider(recaptchaSiteKey)
          : new ReCaptchaV3Provider(recaptchaSiteKey);

      appCheckInstance = initializeAppCheck(appInstance, {
        provider,
        isTokenAutoRefreshEnabled: true,
      });
    } catch {
      // App Check initialization errors should not crash unauthenticated app boot
      appCheckInstance = null;
    }
  }

  return appInstance;
}

export function getFirebaseClientDb(): Firestore | null {
  const app = ensureFirebaseApp();
  if (!app) return null;
  if (!dbInstance) {
    dbInstance =
      firestoreDatabaseId && firestoreDatabaseId !== '(default)'
        ? getFirestore(app, firestoreDatabaseId)
        : getFirestore(app);
  }
  if (typeof window !== 'undefined' && !connectionCheckRan) {
    connectionCheckRan = true;
    void getDocFromServer(doc(dbInstance, 'health', 'ping')).catch((error) => {
      if (error instanceof Error && error.message.includes('the client is offline')) {
        console.error('Please check your Firebase configuration.');
      }
    });
  }
  return dbInstance;
}

export function getFirebaseClientAuth(): Auth | null {
  const app = ensureFirebaseApp();
  if (!app) return null;
  getFirebaseClientDb();

  if (!authInstance) {
    authInstance = getAuth(app);
    void setPersistence(authInstance, browserLocalPersistence).catch(() => undefined);

    if (import.meta.env.DEV && authEmulatorUrl && !emulatorConnected) {
      try {
        connectAuthEmulator(authInstance, authEmulatorUrl, { disableWarnings: true });
        emulatorConnected = true;
      } catch {
        // Already connected
      }
    }
  }

  return authInstance;
}

export async function signInWithEmail(email: string, password: string): Promise<{
  user: User;
  idToken: string;
  appCheckToken: string | null;
}> {
  const auth = getFirebaseClientAuth();
  if (!auth) {
    throw new Error('Firebase Authentication is not configured.');
  }
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  const idToken = await cred.user.getIdToken();
  const appCheckToken = await getActiveAppCheckToken();
  return { user: cred.user, idToken, appCheckToken };
}

export async function signInWithGoogle(): Promise<{
  user: User;
  idToken: string;
  appCheckToken: string | null;
}> {
  const auth = getFirebaseClientAuth();
  if (!auth) {
    throw new Error('Firebase Authentication is not configured.');
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  const idToken = await cred.user.getIdToken();
  const appCheckToken = await getActiveAppCheckToken();
  return { user: cred.user, idToken, appCheckToken };
}

export async function signUpWithEmail(params: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<{
  user: User;
  idToken: string;
  appCheckToken: string | null;
}> {
  const auth = getFirebaseClientAuth();
  if (!auth) {
    throw new Error('Firebase Authentication is not configured.');
  }
  const cred = await createUserWithEmailAndPassword(auth, params.email.trim(), params.password);
  if (params.displayName?.trim()) {
    await updateProfile(cred.user, { displayName: params.displayName.trim() });
  }
  try {
    await sendEmailVerification(cred.user);
  } catch {
    // Non-blocking verification dispatch failure (e.g., emulator / rate limits)
  }
  const idToken = await cred.user.getIdToken(true);
  const appCheckToken = await getActiveAppCheckToken();
  return { user: cred.user, idToken, appCheckToken };
}

export async function resendVerificationEmail(): Promise<void> {
  const auth = getFirebaseClientAuth();
  if (!auth?.currentUser) {
    throw new Error('Please sign in first to resend your verification email.');
  }
  await sendEmailVerification(auth.currentUser);
}

export async function reloadFirebaseUser(): Promise<{ emailVerified: boolean; idToken: string | null }> {
  const auth = getFirebaseClientAuth();
  if (!auth?.currentUser) {
    return { emailVerified: false, idToken: null };
  }
  await auth.currentUser.reload();
  const idToken = await auth.currentUser.getIdToken(true);
  return {
    emailVerified: Boolean(auth.currentUser.emailVerified),
    idToken,
  };
}

export async function requestPasswordReset(email: string): Promise<void> {
  const auth = getFirebaseClientAuth();
  if (!auth) {
    throw new Error('Firebase Authentication is not configured.');
  }
  await sendPasswordResetEmail(auth, email.trim());
}

export async function signOutClient(): Promise<void> {
  const auth = getFirebaseClientAuth();
  if (!auth) return;
  await signOut(auth);
}

export async function getActiveAppCheckToken(): Promise<string | null> {
  if (!appCheckInstance) {
    ensureFirebaseApp();
  }
  if (!appCheckInstance) return null;
  try {
    const result = await getFirebaseAppCheckToken(appCheckInstance, false);
    return result.token || null;
  } catch {
    return null;
  }
}

export function subscribeToIdTokenChanges(
  callback: (payload: {
    user: User | null;
    idToken: string | null;
    appCheckToken: string | null;
  }) => void
): () => void {
  const auth = getFirebaseClientAuth();
  if (!auth) {
    return () => undefined;
  }

  return onIdTokenChanged(auth, async (user) => {
    if (!user) {
      callback({ user: null, idToken: null, appCheckToken: null });
      return;
    }
    try {
      const [idToken, appCheckToken] = await Promise.all([
        user.getIdToken(),
        getActiveAppCheckToken(),
      ]);
      callback({ user, idToken, appCheckToken });
    } catch {
      callback({ user, idToken: null, appCheckToken: null });
    }
  });
}
