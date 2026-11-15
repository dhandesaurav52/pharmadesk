/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Users,
  ShieldCheck,
  Mail,
  Phone,
  Building2,
  Plus,
  Check,
  X,
  RefreshCw,
  AlertTriangle,
  Key,
  Search,
  Clock,
  CheckCircle2,
  Edit3,
  Ban,
  Copy,
  CheckCheck,
  Info,
} from 'lucide-react';
import { usePharmacy } from '../../context/PharmacyContext.tsx';
import {
  EmployeeInvitation,
  StaffInviteDisplayStatus,
  UserProfile,
  UserRole,
} from '../../types/pharmacy.ts';

interface PermDef {
  key: string;
  category: string;
  label: string;
  description: string;
}

const ALL_SYSTEM_PERMISSIONS: PermDef[] = [
  { key: 'dashboard.view', category: 'Home', label: 'View Home Dashboard', description: 'View daily store overview and alerts' },
  { key: 'billing.view', category: 'Billing', label: 'View Billing', description: 'Access billing counter and bill history' },
  { key: 'billing.create', category: 'Billing', label: 'Create Bills', description: 'Create customer bills and take payments' },
  { key: 'billing.cancel', category: 'Billing', label: 'Cancel Bills', description: 'Cancel or void issued customer bills' },
  { key: 'billing.return', category: 'Billing', label: 'Process Returns', description: 'Process customer medicine returns' },
  { key: 'billing.discount', category: 'Billing', label: 'Custom Discount', description: 'Apply custom discounts on bills' },
  { key: 'billing.schedule_h1', category: 'Billing', label: 'Dispense Schedule H1/X', description: 'Dispense controlled Schedule H1 and X medicines' },
  { key: 'medicines.view', category: 'Medicines', label: 'View Medicines', description: 'Search medicines and rack locations' },
  { key: 'medicines.create', category: 'Medicines', label: 'Add Medicines', description: 'Add new medicines to store catalogue' },
  { key: 'medicines.edit', category: 'Medicines', label: 'Edit Medicines', description: 'Edit formulations, HSN, and GST slabs' },
  { key: 'inventory.view', category: 'Stock', label: 'View Stock', description: 'View batch quantities and expiry dates' },
  { key: 'inventory.write', category: 'Stock', label: 'Add Stock', description: 'Receive opening stock and batches' },
  { key: 'inventory.adjust', category: 'Stock', label: 'Adjust Stock', description: 'Adjust batch counts and reconciliation' },
  { key: 'inventory.transfer', category: 'Stock', label: 'Branch Transfers', description: 'Transfer stock between store branches' },
  { key: 'customers.view', category: 'Customers', label: 'View Customers', description: 'View customer directory' },
  { key: 'customers.khata_collect', category: 'Customers', label: 'Collect Khata', description: 'Record customer credit repayments' },
  { key: 'suppliers.view', category: 'Purchases', label: 'View Suppliers & Bills', description: 'View supplier directory and bills' },
  { key: 'goods_receipts.post', category: 'Purchases', label: 'Receive Purchases', description: 'Receive supplier deliveries into stock' },
  { key: 'reports.view', category: 'Reports', label: 'View Sales Reports', description: 'Access store sales and stock reports' },
  { key: 'reports.financial', category: 'Reports', label: 'Financial Reports', description: 'View profit, cashbook, and bank reports' },
  { key: 'reports.gst', category: 'Reports', label: 'GST Reports', description: 'Export GSTR-1 and GSTR-3B tax reports' },
  { key: 'employees.view', category: 'Staff', label: 'View Staff', description: 'View store staff list and branches' },
  { key: 'employees.manage', category: 'Staff', label: 'Manage Staff', description: 'Add staff, issue joining codes, and manage access' },
  { key: 'settings.manage', category: 'Settings', label: 'Store Settings', description: 'Update drug licenses, GSTIN, and receipt format' },
];

const DEFAULT_ROLE_PERMS: Record<UserRole, string[]> = {
  owner: ['*'],
  pharmacist: [
    'dashboard.view', 'billing.view', 'billing.create', 'billing.return', 'billing.discount', 'billing.schedule_h1',
    'medicines.view', 'medicines.create', 'medicines.edit',
    'inventory.view', 'inventory.write', 'inventory.adjust', 'inventory.transfer',
    'customers.view', 'customers.khata_collect',
    'suppliers.view', 'goods_receipts.post', 'reports.view',
  ],
  cashier: [
    'dashboard.view', 'billing.view', 'billing.create',
    'medicines.view', 'inventory.view',
    'customers.view', 'customers.khata_collect', 'reports.view',
  ],
  helper: ['medicines.view', 'inventory.view'],
  auditor: [
    'dashboard.view', 'medicines.view', 'inventory.view',
    'customers.view', 'suppliers.view',
    'reports.view', 'reports.financial', 'reports.gst',
  ],
};

const ROLE_INFO: Record<
  UserRole,
  { title: string; badgeColor: string; description: string; shortSummary: string }
> = {
  owner: {
    title: 'Pharmacy Owner',
    badgeColor: 'bg-purple-50 text-purple-800 border-purple-200',
    description: 'Full store access across billing, stock, accounts, branches, and staff.',
    shortSummary: 'Full control across all store counters and settings.',
  },
  pharmacist: {
    title: 'Pharmacist',
    badgeColor: 'bg-blue-50 text-blue-800 border-blue-200',
    description: 'Billing, Schedule H/H1 dispensing, stock management, purchases, and returns.',
    shortSummary: 'Billing, stock receiving, expiry handling, and Schedule H/H1 dispensing.',
  },
  cashier: {
    title: 'Cashier',
    badgeColor: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    description: 'Fast counter billing, cash/UPI collection, and customer Khata receipts.',
    shortSummary: 'Counter billing, cash/UPI payments, and customer Khata collections.',
  },
  helper: {
    title: 'Store Helper',
    badgeColor: 'bg-amber-50 text-amber-800 border-amber-200',
    description: 'Medicine search, shelf lookup, and checking stock quantities.',
    shortSummary: 'Check medicine stock and rack locations without billing rights.',
  },
  auditor: {
    title: 'Auditor',
    badgeColor: 'bg-slate-100 text-slate-800 border-slate-200',
    description: 'Read-only access to sales registers, GST reports, and accounts.',
    shortSummary: 'Read-only access for accountant or CA review.',
  },
};

const EMPLOYEE_INVITE_ROLES: UserRole[] = ['pharmacist', 'cashier', 'helper', 'auditor'];

function getInvitationDisplayStatus(inv: EmployeeInvitation): StaffInviteDisplayStatus {
  if (inv.displayStatus) return inv.displayStatus;
  if (inv.status === 'revoked' || inv.status === 'cancelled') return 'Invitation Revoked';
  const expired = new Date(inv.expiresAt).getTime() < Date.now();
  if (inv.status === 'expired' || (inv.status === 'pending' && expired)) {
    return 'Invitation Expired';
  }
  if (inv.status === 'accepted') return 'Active';
  return 'Invitation Ready';
}

export const EmployeesView: React.FC = () => {
  const {
    store,
    currentUser,
    usersList,
    invitationsList,
    branches,
    inviteEmployeeAsync,
    regenerateInvitation,
    revokeInvitation,
    updateEmployeeRole,
    updateEmployeeBranches,
    updateEmployeeStatus,
  } = usePharmacy();

  const [activeTab, setActiveTab] = useState<'employees' | 'invitations' | 'matrix'>('employees');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<UserProfile | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [issuedCodeInfo, setIssuedCodeInfo] = useState<{
    name: string;
    email: string;
    roleLabel: string;
    joiningCode: string;
    expiresAt?: string;
  } | null>(null);
  const [staffActionError, setStaffActionError] = useState<string | null>(null);
  const [staffActionNotice, setStaffActionNotice] = useState<string | null>(null);
  const [staffSubmitting, setStaffSubmitting] = useState(false);

  // Add Employee Form State
  const defaultBranchId = branches[0]?.id || 'main';
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('pharmacist');
  const [inviteBranches, setInviteBranches] = useState<string[]>([defaultBranchId]);

  // Edit Employee Form State
  const [editRole, setEditRole] = useState<UserRole>('pharmacist');
  const [editBranches, setEditBranches] = useState<string[]>([]);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

  useEffect(() => {
    if (branches.length > 0 && inviteBranches.length === 0) {
      setInviteBranches([branches[0].id]);
    }
  }, [branches, inviteBranches.length]);

  const availableBranches = useMemo(
    () =>
      branches.map((b) => ({
        id: b.id,
        name: `${b.name} (${b.branchCode})`,
        shortName: b.name,
      })),
    [branches]
  );

  const branchNameLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of branches) {
      map.set(b.id, b.name);
    }
    return map;
  }, [branches]);

  const filteredEmployees = useMemo(() => {
    return usersList.filter((user) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        user.name.toLowerCase().includes(q) ||
        user.email.toLowerCase().includes(q) ||
        (user.phone || '').includes(q);
      if (!matchesSearch) return false;
      if (roleFilter !== 'all' && user.role !== roleFilter) return false;
      if (statusFilter !== 'all' && (user.status || 'active') !== statusFilter) return false;
      return true;
    });
  }, [usersList, searchQuery, roleFilter, statusFilter]);

  const activeCount = usersList.filter((u) => (u.status || 'active') === 'active').length;
  const activeOwnerCount = usersList.filter(
    (u) => u.role === 'owner' && (u.status || 'active') === 'active'
  ).length;
  const suspendedCount = usersList.filter((u) => u.status === 'suspended').length;
  const deactivatedCount = usersList.filter((u) => u.status === 'deactivated').length;
  const pendingInvitesCount = invitationsList.filter((i) => {
    const label = getInvitationDisplayStatus(i);
    return label === 'Invitation Ready' || label === 'Awaiting Account Setup';
  }).length;

  const isOwner = currentUser.role === 'owner';

  const openAddEmployeeModal = () => {
    setIssuedCodeInfo(null);
    setStaffActionError(null);
    setInviteName('');
    setInviteEmail('');
    setInvitePhone('');
    setInviteRole('pharmacist');
    setInviteBranches([branches[0]?.id || 'main']);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (emp: UserProfile) => {
    setStaffActionError(null);
    setEditingEmployee(emp);
    setEditRole(emp.role);
    const validBranchIds =
      emp.assignedBranchIds && emp.assignedBranchIds.length > 0
        ? emp.assignedBranchIds.filter((id) => id !== '*')
        : [branches[0]?.id || 'main'];
    setEditBranches(
      validBranchIds.length > 0 ? validBranchIds : [branches[0]?.id || 'main']
    );
    setShowRemoveConfirm(false);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmployee) return;
    setStaffActionError(null);
    setStaffSubmitting(true);
    try {
      if (editRole !== editingEmployee.role) {
        await Promise.resolve(updateEmployeeRole(editingEmployee.id, editRole));
      }
      await Promise.resolve(updateEmployeeBranches(editingEmployee.id, editBranches));
      setStaffActionNotice(`Updated access for ${editingEmployee.name}.`);
      setEditingEmployee(null);
    } catch (err) {
      setStaffActionError(
        err instanceof Error ? err.message : 'Unable to save employee changes.'
      );
    } finally {
      setStaffSubmitting(false);
    }
  };

  const handleStatusChange = async (status: 'active' | 'suspended' | 'deactivated') => {
    if (!editingEmployee) return;
    setStaffActionError(null);
    setStaffSubmitting(true);
    try {
      await Promise.resolve(updateEmployeeStatus(editingEmployee.id, status));
      setEditingEmployee({ ...editingEmployee, status });
      setShowRemoveConfirm(false);
      setStaffActionNotice(
        status === 'active'
          ? `${editingEmployee.name}'s access is active again.`
          : status === 'suspended'
          ? `${editingEmployee.name}'s access has been paused.`
          : `Removed ${editingEmployee.name}'s access to ${store.name}.`
      );
      if (status === 'deactivated') {
        setEditingEmployee(null);
      }
    } catch (err) {
      setStaffActionError(
        err instanceof Error ? err.message : 'Unable to update staff status.'
      );
    } finally {
      setStaffSubmitting(false);
    }
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName.trim() || !inviteEmail.trim()) return;
    setStaffActionError(null);
    setStaffSubmitting(true);
    try {
      const selectedBranches =
        inviteBranches.length > 0 ? inviteBranches : [branches[0]?.id || 'main'];
      const { invitation, joiningCode } = await inviteEmployeeAsync({
        name: inviteName.trim(),
        email: inviteEmail.trim(),
        phone: invitePhone.trim() || undefined,
        role: inviteRole,
        assignedBranchIds: selectedBranches,
      });

      setIssuedCodeInfo({
        name: invitation.name,
        email: invitation.email,
        roleLabel: ROLE_INFO[inviteRole].title,
        joiningCode: joiningCode || invitation.joiningCode || '',
        expiresAt: invitation.expiresAt,
      });

      setInviteName('');
      setInviteEmail('');
      setInvitePhone('');
      setInviteRole('pharmacist');
      setInviteBranches([branches[0]?.id || 'main']);
    } catch (err) {
      setStaffActionError(
        err instanceof Error ? err.message : 'Unable to create joining code.'
      );
    } finally {
      setStaffSubmitting(false);
    }
  };

  const handleRegenerateCode = async (inv: EmployeeInvitation) => {
    setStaffActionError(null);
    setStaffSubmitting(true);
    try {
      const { invitation, joiningCode } = await regenerateInvitation(inv.id);
      setIssuedCodeInfo({
        name: invitation.name,
        email: invitation.email,
        roleLabel: ROLE_INFO[invitation.role]?.title || invitation.role,
        joiningCode,
        expiresAt: invitation.expiresAt,
      });
      setIsAddModalOpen(true);
    } catch (err) {
      setStaffActionError(
        err instanceof Error ? err.message : 'Unable to generate a new joining code.'
      );
    } finally {
      setStaffSubmitting(false);
    }
  };

  const handleRevokeCode = async (inv: EmployeeInvitation) => {
    setStaffActionError(null);
    setStaffSubmitting(true);
    try {
      await revokeInvitation(inv.id);
      setStaffActionNotice(`Revoked joining code for ${inv.name}.`);
    } catch (err) {
      setStaffActionError(
        err instanceof Error ? err.message : 'Unable to revoke joining code.'
      );
    } finally {
      setStaffSubmitting(false);
    }
  };

  const handleCopyText = (text: string, key: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const joinOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Staff &amp; Joining Codes
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Add staff members, share private joining codes, and manage store counter access.
            </p>
          </div>
        </div>

        {isOwner && (
          <button
            type="button"
            onClick={openAddEmployeeModal}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Employee</span>
          </button>
        )}
      </div>

      {staffActionNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{staffActionNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setStaffActionNotice(null)}
            className="text-emerald-800 font-semibold hover:underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {staffActionError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{staffActionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setStaffActionError(null)}
            className="text-red-700 font-semibold hover:underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Metrics Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
            Active Staff
          </span>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1 flex items-baseline gap-2">
            {activeCount}
            <span className="text-xs font-normal text-slate-400">members</span>
          </div>
          <span className="text-[11px] text-emerald-700 font-medium flex items-center gap-1 mt-1">
            <CheckCircle2 className="w-3 h-3" /> Authorized to sign in
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
            Pending Codes
          </span>
          <div className="text-2xl font-bold font-mono tabular-nums text-blue-600 mt-1 flex items-baseline gap-2">
            {pendingInvitesCount}
            <span className="text-xs font-normal text-slate-400">waiting</span>
          </div>
          <span className="text-[11px] text-slate-500 flex items-center gap-1 mt-1">
            <Clock className="w-3 h-3" /> Valid for 72 hours
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
            Store Counters
          </span>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1 flex items-baseline gap-2">
            {availableBranches.length}
            <span className="text-xs font-normal text-slate-400">branches</span>
          </div>
          <span className="text-[11px] text-slate-500 flex items-center gap-1 mt-1">
            <Building2 className="w-3 h-3" /> Branch-level access control
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
            Paused / Removed
          </span>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-700 mt-1 flex items-baseline gap-2">
            {deactivatedCount + suspendedCount}
            <span className="text-xs font-normal text-slate-400">accounts</span>
          </div>
          <span className="text-[11px] text-slate-500 flex items-center gap-1 mt-1">
            <Ban className="w-3 h-3" /> Cannot sign in to store
          </span>
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex border-b border-slate-200 gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('employees')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
            activeTab === 'employees'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Staff Directory</span>
          <span className="text-[11px] px-1.5 py-0.2 rounded bg-slate-100 font-mono">
            {usersList.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('invitations')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
            activeTab === 'invitations'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Key className="w-4 h-4" />
          <span>Joining Codes</span>
          {pendingInvitesCount > 0 && (
            <span className="text-[11px] px-1.5 py-0.2 rounded bg-blue-100 text-blue-700 font-mono font-semibold">
              {pendingInvitesCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('matrix')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
            activeTab === 'matrix'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Role Permissions</span>
        </button>
      </div>

      {/* ================= TAB 1: STAFF DIRECTORY ================= */}
      {activeTab === 'employees' && (
        <div className="space-y-4">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search staff by name, email, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Roles</option>
                <option value="owner">Pharmacy Owner</option>
                <option value="pharmacist">Pharmacist</option>
                <option value="cashier">Cashier</option>
                <option value="helper">Store Helper</option>
                <option value="auditor">Auditor</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="deactivated">Removed</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredEmployees.map((emp) => {
              const roleMeta = ROLE_INFO[emp.role] || ROLE_INFO.helper;
              const status = emp.status || 'active';

              return (
                <div
                  key={emp.id}
                  className={`bg-white rounded-2xl border transition-all p-5 flex flex-col justify-between ${
                    status === 'deactivated'
                      ? 'border-red-200 bg-red-50/20 opacity-80'
                      : status === 'suspended'
                      ? 'border-amber-200 bg-amber-50/20'
                      : 'border-slate-200 hover:border-blue-300'
                  }`}
                >
                  <div className="space-y-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm text-white shrink-0 ${
                            emp.role === 'owner'
                              ? 'bg-purple-600'
                              : emp.role === 'pharmacist'
                              ? 'bg-blue-600'
                              : emp.role === 'cashier'
                              ? 'bg-emerald-600'
                              : emp.role === 'auditor'
                              ? 'bg-slate-700'
                              : 'bg-amber-600'
                          }`}
                        >
                          {emp.name.charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h3 className="text-sm font-bold text-slate-900 leading-tight">
                              {emp.name}
                            </h3>
                            {emp.id === currentUser.id && (
                              <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-semibold">
                                You
                              </span>
                            )}
                          </div>
                          <span
                            className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-md border mt-1 ${roleMeta.badgeColor}`}
                          >
                            {roleMeta.title}
                          </span>
                        </div>
                      </div>

                      <div>
                        {status === 'active' && (
                          <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                            Active
                          </span>
                        )}
                        {status === 'suspended' && (
                          <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                            Suspended
                          </span>
                        )}
                        {status === 'deactivated' && (
                          <span className="text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                            Removed
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs text-slate-600 pt-2 border-t border-slate-100">
                      <div className="flex items-center gap-2 truncate">
                        <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{emp.email}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{emp.phone || 'No phone recorded'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">
                          {emp.assignedBranchIds?.includes('*')
                            ? 'All Store Branches'
                            : emp.assignedBranchIds && emp.assignedBranchIds.length > 0
                            ? emp.assignedBranchIds
                                .map((id) => branchNameLookup.get(id) || id)
                                .join(', ')
                            : 'Main Store'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {isOwner && (
                    <div className="pt-4 mt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(emp)}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-1.5 border border-slate-200 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Manage Staff</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {filteredEmployees.length === 0 && (
            <div className="text-center py-12 bg-white rounded-2xl border border-slate-200 p-8">
              <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-slate-800">No staff members found</h3>
              <p className="text-xs text-slate-500 mt-1">
                Try clearing your search or click Add Employee to invite a team member.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 2: JOINING CODES ================= */}
      {activeTab === 'invitations' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-xs text-blue-900 leading-relaxed">
              <p className="font-semibold">How employee joining codes work</p>
              <p className="mt-0.5 text-blue-800">
                Share the joining code privately with your employee. They go to{' '}
                <span className="font-mono font-semibold">{joinOrigin}/join-pharmacy</span>, enter
                their code, and sign up or sign in with the email address you entered.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3">Employee</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Branch</th>
                    <th className="px-4 py-3">Joining Code</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invitationsList.map((inv) => {
                    const roleMeta = ROLE_INFO[inv.role] || ROLE_INFO.helper;
                    const displayStatus = getInvitationDisplayStatus(inv);
                    const expiresAtDate = new Date(inv.expiresAt);
                    const hoursLeft = Math.max(
                      0,
                      Math.round((expiresAtDate.getTime() - Date.now()) / (1000 * 60 * 60))
                    );
                    const maskedCode =
                      inv.joiningCodeMasked ||
                      (inv.codeLast4 ? `PDK-****-${inv.codeLast4}` : 'Hidden');

                    const statusBadgeClass =
                      displayStatus === 'Active'
                        ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                        : displayStatus === 'Invitation Ready'
                        ? 'text-blue-700 bg-blue-50 border-blue-200'
                        : displayStatus === 'Awaiting Account Setup'
                        ? 'text-indigo-700 bg-indigo-50 border-indigo-200'
                        : displayStatus === 'Invitation Expired'
                        ? 'text-amber-700 bg-amber-50 border-amber-200'
                        : displayStatus === 'Suspended'
                        ? 'text-amber-700 bg-amber-50 border-amber-200'
                        : 'text-red-700 bg-red-50 border-red-200';

                    const canRegenerate =
                      isOwner &&
                      (displayStatus === 'Invitation Ready' ||
                        displayStatus === 'Awaiting Account Setup' ||
                        displayStatus === 'Invitation Expired' ||
                        displayStatus === 'Invitation Revoked');
                    const canRevoke =
                      isOwner &&
                      (displayStatus === 'Invitation Ready' ||
                        displayStatus === 'Awaiting Account Setup');

                    return (
                      <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="font-bold text-slate-900">{inv.name}</div>
                          <div className="text-slate-500 flex items-center gap-1.5 mt-0.5">
                            <Mail className="w-3 h-3 text-slate-400" />
                            <span>{inv.email}</span>
                          </div>
                          {inv.phone && (
                            <div className="text-slate-400 text-[11px] flex items-center gap-1.5 mt-0.5">
                              <Phone className="w-3 h-3 text-slate-300" />
                              <span>{inv.phone}</span>
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-md border ${roleMeta.badgeColor}`}
                          >
                            {roleMeta.title}
                          </span>
                        </td>

                        <td className="px-4 py-3.5">
                          <div className="flex flex-wrap gap-1">
                            {inv.assignedBranchIds.map((bId) => (
                              <span
                                key={bId}
                                className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded"
                              >
                                {branchNameLookup.get(bId) || bId}
                              </span>
                            ))}
                          </div>
                        </td>

                        <td className="px-4 py-3.5">
                          <span className="font-mono text-xs text-slate-700 bg-slate-100 px-2 py-1 rounded border border-slate-200">
                            {maskedCode}
                          </span>
                        </td>

                        <td className="px-4 py-3.5">
                          <span
                            className={`text-[11px] font-medium border px-2 py-0.5 rounded inline-flex items-center gap-1 ${statusBadgeClass}`}
                          >
                            {displayStatus}
                          </span>
                          {(displayStatus === 'Invitation Ready' ||
                            displayStatus === 'Awaiting Account Setup') && (
                            <div className="text-[10px] text-slate-400 mt-1">
                              Expires in {hoursLeft}h
                            </div>
                          )}
                        </td>

                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {canRegenerate && (
                              <button
                                type="button"
                                disabled={staffSubmitting}
                                onClick={() => void handleRegenerateCode(inv)}
                                className="px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-slate-200 inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                <span>Generate New Code</span>
                              </button>
                            )}
                            {canRevoke && (
                              <button
                                type="button"
                                disabled={staffSubmitting}
                                onClick={() => void handleRevokeCode(inv)}
                                className="px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 rounded-lg transition-colors border border-red-200 inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              >
                                <Ban className="w-3.5 h-3.5" />
                                <span>Revoke Code</span>
                              </button>
                            )}
                            {!canRegenerate && !canRevoke && (
                              <span className="text-[11px] text-slate-400">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {invitationsList.length === 0 && (
              <div className="text-center py-10 p-6">
                <Key className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <h3 className="text-sm font-semibold text-slate-800">No joining codes yet</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Click Add Employee to generate a private joining code for a team member.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 3: ROLE PERMISSIONS ================= */}
      {activeTab === 'matrix' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-1">
              Store Role Access Overview
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Each staff member automatically receives the access defined by the role you choose.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold">
                  <tr>
                    <th className="px-4 py-3 min-w-[200px]">Feature Access</th>
                    <th className="px-3 py-3 text-center min-w-[90px]">Owner</th>
                    <th className="px-3 py-3 text-center min-w-[100px]">Pharmacist</th>
                    <th className="px-3 py-3 text-center min-w-[90px]">Cashier</th>
                    <th className="px-3 py-3 text-center min-w-[80px]">Helper</th>
                    <th className="px-3 py-3 text-center min-w-[80px]">Auditor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ALL_SYSTEM_PERMISSIONS.map((p) => {
                    const pharmacistHas = DEFAULT_ROLE_PERMS.pharmacist.includes(p.key);
                    const cashierHas = DEFAULT_ROLE_PERMS.cashier.includes(p.key);
                    const helperHas = DEFAULT_ROLE_PERMS.helper.includes(p.key);
                    const auditorHas = DEFAULT_ROLE_PERMS.auditor.includes(p.key);

                    return (
                      <tr key={p.key} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-900">{p.label}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{p.description}</div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 text-purple-700 font-bold">
                            ✓
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {pharmacistHas ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold">
                              ✓
                            </span>
                          ) : (
                            <span className="text-slate-300 font-bold">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {cashierHas ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 font-bold">
                              ✓
                            </span>
                          ) : (
                            <span className="text-slate-300 font-bold">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {helperHas ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-700 font-bold">
                              ✓
                            </span>
                          ) : (
                            <span className="text-slate-300 font-bold">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {auditorHas ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-slate-700 font-bold">
                              ✓
                            </span>
                          ) : (
                            <span className="text-slate-300 font-bold">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: ADD EMPLOYEE / SHOW JOINING CODE ================= */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {issuedCodeInfo ? 'Employee Joining Code Ready' : 'Add Employee'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {issuedCodeInfo
                      ? `For ${issuedCodeInfo.name} (${issuedCodeInfo.roleLabel})`
                      : 'Create a private joining code for your team member'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAddModalOpen(false);
                  setIssuedCodeInfo(null);
                }}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {issuedCodeInfo ? (
              <div className="py-5 space-y-4">
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-1.5">
                  <div className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <span>Employee joining code created. Share this code privately with the employee.</span>
                  </div>
                  <p className="text-xs text-emerald-800">
                    Ask {issuedCodeInfo.name} to open{' '}
                    <span className="font-mono font-semibold">{joinOrigin}/join-pharmacy</span>{' '}
                    and sign up or sign in using{' '}
                    <span className="font-semibold">{issuedCodeInfo.email}</span>. This code is shown once and expires in 72 hours.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-center space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Joining Code
                  </div>
                  <div className="text-2xl font-bold font-mono tracking-widest text-slate-900 select-all">
                    {issuedCodeInfo.joiningCode}
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopyText(issuedCodeInfo.joiningCode, 'code')}
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedKey === 'code' ? (
                        <>
                          <CheckCheck className="w-4 h-4" /> Code Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" /> Copy Joining Code
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyText(
                          `Join ${store.name} on PharmaDesk:\n1. Open ${joinOrigin}/join-pharmacy\n2. Enter Joining Code: ${issuedCodeInfo.joiningCode}\n3. Use email: ${issuedCodeInfo.email}`,
                          'instructions'
                        )
                      }
                      className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedKey === 'instructions' ? (
                        <>
                          <CheckCheck className="w-4 h-4 text-emerald-600" /> Instructions Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" /> Copy Instructions
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIssuedCodeInfo(null);
                      setIsAddModalOpen(false);
                      setActiveTab('invitations');
                    }}
                    className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleAddEmployee} className="space-y-4 pt-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Employee Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Suresh Patel"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Employee Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="suresh@gmail.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mobile Number (Optional)
                    </label>
                    <input
                      type="tel"
                      placeholder="+91 98765 43210"
                      value={invitePhone}
                      onChange={(e) => setInvitePhone(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Select Role <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {EMPLOYEE_INVITE_ROLES.map((r) => {
                      const meta = ROLE_INFO[r];
                      const isSelected = inviteRole === r;
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setInviteRole(r)}
                          className={`p-2.5 rounded-xl border cursor-pointer text-left transition-all ${
                            isSelected
                              ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-900">{meta.title}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-blue-600" />}
                          </div>
                          <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">
                            {meta.shortSummary}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Assigned Branch <span className="text-red-500">*</span>
                  </label>
                  <div className="space-y-1.5 border border-slate-200 rounded-xl p-3 bg-slate-50/50">
                    {availableBranches.map((branch) => {
                      const isChecked = inviteBranches.includes(branch.id);
                      return (
                        <label
                          key={branch.id}
                          className="flex items-center gap-2.5 text-xs text-slate-800 cursor-pointer select-none"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              if (isChecked) {
                                if (inviteBranches.length > 1) {
                                  setInviteBranches(inviteBranches.filter((b) => b !== branch.id));
                                }
                              } else {
                                setInviteBranches([...inviteBranches, branch.id]);
                              }
                            }}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="font-medium">{branch.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={staffSubmitting}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    {staffSubmitting ? 'Generating Code...' : 'Generate Joining Code'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ================= MODAL: MANAGE STAFF MEMBER ================= */}
      {editingEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Manage {editingEmployee.name}
                  </h2>
                  <p className="text-xs text-slate-500">{editingEmployee.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingEmployee(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEmployee} className="space-y-4 pt-4">
              {editingEmployee.role === 'owner' ? (
                <div className="p-3 rounded-xl bg-purple-50 border border-purple-200 text-xs text-purple-900">
                  <span className="font-semibold">Role: Pharmacy Owner.</span>{' '}
                  {activeOwnerCount <= 1
                    ? 'You are the only active owner of this pharmacy.'
                    : 'Multiple active owners are configured for this store.'}
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Change Role
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {EMPLOYEE_INVITE_ROLES.map((r) => {
                      const isSelected = editRole === r;
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setEditRole(r)}
                          className={`p-2.5 rounded-xl border cursor-pointer text-left transition-all ${
                            isSelected
                              ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-900">
                              {ROLE_INFO[r].title}
                            </span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-blue-600" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Assigned Branches
                </label>
                <div className="space-y-1.5 border border-slate-200 rounded-xl p-3 bg-slate-50/50">
                  {availableBranches.map((branch) => {
                    const isChecked = editBranches.includes(branch.id);
                    return (
                      <label
                        key={branch.id}
                        className="flex items-center gap-2.5 text-xs text-slate-800 cursor-pointer select-none"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              if (editBranches.length > 1) {
                                setEditBranches(editBranches.filter((b) => b !== branch.id));
                              }
                            } else {
                              setEditBranches([...editBranches, branch.id]);
                            }
                          }}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="font-medium">{branch.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Status & Remove Access Actions */}
              {editingEmployee.id !== currentUser.id && (
                <div className="pt-3 border-t border-slate-100">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">Store Access:</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {editingEmployee.status !== 'active' && (
                        <button
                          type="button"
                          disabled={staffSubmitting}
                          onClick={() => void handleStatusChange('active')}
                          className="px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer"
                        >
                          Reactivate Access
                        </button>
                      )}
                      {editingEmployee.status !== 'suspended' && (
                        <button
                          type="button"
                          disabled={staffSubmitting}
                          onClick={() => void handleStatusChange('suspended')}
                          className="px-2.5 py-1 text-xs font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 rounded-lg cursor-pointer"
                        >
                          Suspend
                        </button>
                      )}
                      {editingEmployee.status !== 'deactivated' && (
                        <button
                          type="button"
                          disabled={staffSubmitting}
                          onClick={() => setShowRemoveConfirm(true)}
                          className="px-2.5 py-1 text-xs font-semibold bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 rounded-lg cursor-pointer flex items-center gap-1"
                        >
                          <Ban className="w-3.5 h-3.5" /> Remove Pharmacy Access
                        </button>
                      )}
                    </div>
                  </div>

                  {showRemoveConfirm && (
                    <div className="mt-3 p-3.5 bg-red-50 border border-red-200 rounded-xl space-y-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-red-900">
                        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                        Confirm Removing Access
                      </div>
                      <p className="text-[11px] text-red-800 leading-normal">
                        Removing access stops {editingEmployee.name} from signing into {store.name}.
                        Past bills, stock history, and their access to any other pharmacies are preserved.
                      </p>
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setShowRemoveConfirm(false)}
                          className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-200 rounded-lg"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={staffSubmitting}
                          onClick={() => void handleStatusChange('deactivated')}
                          className="px-3 py-1 text-xs font-semibold bg-red-600 text-white hover:bg-red-700 rounded-lg"
                        >
                          Remove Access
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingEmployee(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={staffSubmitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer"
                >
                  {staffSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
