# PharmaDesk — Phase 15 Customer Launch, Hardware, Backup & Operations Guide

> **Scope & Truthfulness Standard**: This guide reflects strictly what is implemented and verified in the PharmaDesk codebase (`React + TypeScript + Vite` frontend on Firebase Hosting; `Node.js + Express + TypeScript` backend on Cloud Run `asia-south1`; Firebase Authentication, Cloud Firestore, Firebase Storage, and Firebase App Check). Operational GCP/Firebase Console steps marked as **Production Operator Action Required** must be verified directly in your cloud project before onboarding live stores.

---

## A. Store Owner Onboarding & Quick Start

1. **Create Account & Verify Email**:
   - Open PharmaDesk and click **Sign Up** inside the sign-in modal (or navigate directly via an employee invite link `/invite/<token>?tenantId=<tenantId>`).
   - Register with your pharmacy owner email and password.
   - Check your inbox for the Firebase email verification link, then click **Refresh Status** (or **Resend Verification Email** if needed).
2. **Provision Pharmacy Workspace**:
   - On first sign-in without an active pharmacy membership, PharmaDesk opens the **Workspace Onboarding** flow:
     - **Create New Pharmacy Store**: Enter store name, legal name, **Drug License 20B & 21B**, GSTIN (optional for composition/unregistered stores), address, city, state, 6-digit pincode, invoice prefix, and contact details. PharmaDesk provisions your isolated tenant, initial `main` branch, Chart of Accounts, and Owner membership atomically.
     - **Join Existing Pharmacy (Invite)**: If you are an employee joining an existing store, paste your Tenant ID and 64-character invite token (or open your `/invite/...` link directly).
3. **Configure Branches, Tax & Receipt Settings**:
   - Review **More → Store Settings** to set default printer width (`80mm Roll` or `A4 GST`), invoice prefix, and store contact/DL details.
   - Confirm Drug License **Form 20B & 21B** numbers are entered so printed retail tax invoices remain compliant.
4. **Invite Counter Staff & Assign Branches**:
   - Open **More → Employees & Access Control** to generate 72-hour role-based invite links (`Pharmacist`, `Cashier`, `Helper`, `Auditor`, or co-`Owner`) scoped to specific store branches.
5. **Add Medicines, Opening Stock & Start Billing**:
   - Add formulations under **Medicines & Stock** (including HSN code, GST slab, pack size, and Schedule H/H1/X flag) and inward initial batches (`+ Add Stock`) or receive distributor stock via **Purchases → PO → GRN**.
   - Switch to **Billing**, scan or search a medicine, verify FEFO batch allocation, record payment, and print the receipt.

---

## B. Supported Hardware Boundaries & Customer Setup Guide

PharmaDesk runs inside standard desktop browsers (Chrome / Edge / Safari) on Windows, macOS, and Linux counter PCs without installing native desktop drivers.

### 1. Barcode Scanners
- **Supported Models & Modes**:
  - **USB HID Keyboard-Emulation Scanners** (plug-and-play wired handheld/hands-free scanners configured in standard HID Keyboard mode with `Enter`/CR suffix).
  - **Bluetooth HID Scanners** paired at the OS level in keyboard-wedge (HID) mode.
- **How Counter Scanning Works**:
  - Click or keep focus in the **Billing** medicine search / barcode input.
  - Scanning an EAN-13 / GTIN / batch barcode enters the code and triggers lookup. Rapid duplicate scans of the same code within the counter debounce window increment quantity cleanly without creating duplicate bill lines unless a new batch split is required.
- **Explicit Compatibility Boundary**:
  - PharmaDesk does **not** claim compatibility with proprietary USB COM/serial OPOS/JPOS SDKs that require custom native browser plugins or non-HID scanner modes. Set your scanner manual's barcode to **USB HID Keyboard + Enter Suffix**.

### 2. Receipt Printers
- **Supported Formats & Connection Methods**:
  - **80mm Thermal Roll Printers** (e.g., Epson TM-T82/T88, TVS RP3200, Rugtek, POSiflex connected via USB, LAN, or Bluetooth through standard OS printer drivers).
  - **A4 Laser / Inkjet Printers** for full-page GST tax invoices.
- **How Printing Works**:
  - In **Print Invoice** (`PrintInvoiceModal`), PharmaDesk defaults to your Store Settings preference (`80mm Roll` at 80mm thermal CSS width or `A4 GST` page layout).
  - Clicking **Print Invoice** opens the OS/Browser print dialog (`window.print()`). If Drug License **20B / 21B** numbers are blank, PharmaDesk displays an inline compliance reminder before printing. Any browser print invocation failure displays an inline error alert inside the print modal.
- **Setup Checklist for Store Owners**:
  1. Install the manufacturer's Windows/macOS printer driver and set paper size to `80mm x 297mm` (or Roll) in Printing Preferences.
  2. In the browser print preview on first bill, disable **Headers and Footers** and set **Margins → None** (or Minimum).
- **Explicit Compatibility Boundary**:
  - PharmaDesk does **not** use raw browser WebUSB/WebSerial ESC/POS commands; printing requires an OS-recognized printer driver accessible to the browser print dialog.

### 3. Payment Methods & External Terminals
- **Supported In-App Modes**:
  - **Cash**, **UPI** (store QR / static or dynamic UPI reference entry), **Card / POS Machine** (external EDC terminal approval reference entry), **Bank Transfer**, and **Khata Credit** (for registered customers with credit terms).
- **Explicit Compatibility Boundary**:
  - PharmaDesk **does not** integrate directly via live USB/Bluetooth/Cloud SDK with Razorpay POS, Pine Labs, Paytm EDC, or PhonePe SmartPOD devices.
  - Cashiers must **verify "Payment Approved" on the UPI soundbox, banking app, or card terminal first**, enter the UTR / RRN reference number in Billing, and only then click **Complete Bill**.

---

## C. Cloud Firestore & Storage Backup, Retention & Recovery Runbook

> **Important**: Backup schedules exist in Google Cloud / Firebase infrastructure rather than application source code. Confirm these settings in your production GCP project (`asia-south1`).

### 1. What Is Backed Up & Where
- **Cloud Firestore (`(default)` database in `asia-south1`)**:
  - Tenants, branches, memberships, medicines, inventory batches, immutable `stock_movements`, sales invoices, payments, returns, customers & Khata ledgers, suppliers, POs, GRNs, supplier invoices/payments, double-entry Chart of Accounts & journal entries, audit logs.
  - **Storage Location**: Dedicated multi-region or `asia-south1` GCS export bucket (`gs://<project-id>-firestore-backups`) and Firestore managed scheduled backups.
- **Firebase Storage Bucket**:
  - Supplier invoice scans, prescription attachments, and compliance documents stored under `/tenants/{tenantId}/...`.
  - **Protection**: Enable **Cloud Storage Object Versioning** + lifecycle rule (retain noncurrent versions 90 days) on the Firebase Storage bucket.

### 2. Recommended Backup Schedule & Retention
| Asset | Frequency | Retention | Mechanism |
| :--- | :--- | :--- | :--- |
| Cloud Firestore Managed Backups | Daily (02:00 IST) | 14–30 days (98-day weekly if required) | `gcloud firestore backups schedules create` |
| Cloud Firestore GCS Exports (DPDP / Long-Term Audit) | Weekly (Sunday 03:00 IST) | 8 years for tax/audit coldline archive | Cloud Scheduler + Cloud Run/Workflow `gcloud firestore export` |
| Firebase Storage Objects | Continuous versioning | 90 days noncurrent versions | GCS Bucket Versioning + Lifecycle Policy |

### 3. Access Permissions (Least Privilege)
- Restrict backup restore & GCS export bucket access (`roles/datastore.importExportAdmin`, `roles/storage.objectAdmin` on backup bucket) strictly to Platform Administrators / Break-glass SRE principals with 2FA.
- Application Cloud Run service account (`pharmadesk-api`) must **never** hold broad backup deletion or cross-project restore privileges.

### 4. Non-Destructive Recovery Procedure (Staging Verification First)
**NEVER test restoration by importing directly over the production Firestore database.**
1. Provision or select a separate isolated staging GCP project (`pharmadesk-staging`) or a secondary non-default Firestore database (`restore-drill-db`).
2. Identify the target backup or GCS export prefix (`gs://<project-id>-firestore-backups/YYYY-MM-DD/`).
3. Run restore into the isolated staging target:
   ```bash
   gcloud firestore databases restore \
     --source-backup="projects/<PROJECT_ID>/locations/asia-south1/backups/<BACKUP_ID>" \
     --destination-database="restore-drill-db"
   ```
   *(Or `gcloud firestore import gs://<BACKUP_BUCKET>/<EXPORT_FOLDER> --database=restore-drill-db` for GCS exports.)*
4. Point a staging API instance to `restore-drill-db` and execute `POST /api/v1/security/dr-drills` (`INTEGRITY_CHECK`) to confirm zero unbalanced journal entries, intact customer/supplier subledger balances, and valid invoice sequences.
5. **Known Recovery Limitations**:
   - Point-in-time recovery (PITR) is limited to the 7-day window if enabled; daily backups restore to the last snapshot boundary (up to 24h RPO without PITR).
   - Firestore import/restore does **not** recreate Firebase Auth user accounts; keep periodic Firebase Auth user metadata exports (`firebase auth:export`) in encrypted cold storage.

---

## D. Production Monitoring, Alerts & Counter Support Playbook

### 1. Operational Monitoring Checklist (Production Operator Action Required)
- **Cloud Run (`pharmadesk-api` in `asia-south1`)**:
  - Verify minimum instances (`--min-instances 1` recommended during business hours `08:00–23:00 IST`) to eliminate cold-start billing delays.
  - Monitor `run.googleapis.com/request_latencies` (p95 < 500ms) and HTTP 5xx error rate (< 0.5%).
  - Inspect structured Pino JSON logs (PHI-redacted) in Cloud Logging filtered by `severity >= ERROR` and `requestId`.
- **Firebase Authentication & App Check**:
  - Monitor sign-in failure spikes and confirm `FIREBASE_APP_CHECK_REQUIRED=true` in production Cloud Run env vars once reCAPTCHA Enterprise / v3 site key (`VITE_FIREBASE_APPCHECK_RECAPTCHA_SITE_KEY`) is registered in Firebase Console.
- **Cloud Firestore & Storage**:
  - Watch Firestore read/write quota, index build status (`firestore.indexes.json` deployed including `COLLECTION_GROUP` `memberships`), and Storage `403` rule rejections.
- **GCP Billing & Budget Alerts**:
  - Set Cloud Billing budget thresholds at 50%, 80%, and 100% of monthly target with email/Slack alerts to operations leads.

### 2. Counter Support Triage Workflows

| Issue Reported by Pharmacy | Likely Causes | Support Resolution Steps |
| :--- | :--- | :--- |
| **Cannot Sign In / Stuck on Onboarding** | Unverified email, deactivated staff status, missing Firestore `memberships` collection-group index, or expired 72h invite link | 1. Ask user to click **Resend Verification Email** then **Refresh Status**.<br>2. Owner checks **More → Staff** for `active` status.<br>3. If invite expired, Owner clicks **Resend** in Invitations tab for a fresh 72h URL.<br>4. Ops checks Cloud Run logs for `GET /api/v1/auth/me` index errors. |
| **Bill Checkout Fails / Duplicate Warning** | Missing/exhausted batch stock, expired batch selected, suspended branch, or duplicate `X-Idempotency-Key` retry | 1. Check batch expiry and available packs in **Medicines & Stock**.<br>2. Confirm branch status is `ACTIVE` under **More → Branches**.<br>3. If network dropped during checkout, check **Bill History** before re-billing to avoid double charging the customer. |
| **Medicine Missing in Billing Search** | Medicine inactive/archived, zero stock on branch, or user viewing another branch | 1. Confirm active store & branch in the top header switcher.<br>2. Search **Medicines & Stock** (toggle archived/zero-stock view) and verify stock batches exist for the active branch. |
| **Stock Count Discrepancy** | Unposted GRN draft, pending return/cancellation, or incorrect batch adjustment | 1. Open **Medicines & Stock → Stock Movements** ledger to audit every inward (`GRN`), outward (`SALE`), `SALE_RETURN`, and `MANUAL_ADJUSTMENT` entry.<br>2. Post authorized physical count adjustment via **Adjust Stock** with reason. |
| **Receipt Printer Not Printing / Bad Alignment** | Wrong OS default printer, `80mm` vs `A4` store setting mismatch, or missing DL numbers | 1. Set **Store Settings → Thermal 80mm Printer** toggle to match hardware.<br>2. In browser Print dialog, select correct printer, `Margins: None`, `Scale: Default`, uncheck `Headers & footers`.<br>3. Add Drug License 20B/21B in **Store Settings** if warning appears. |
