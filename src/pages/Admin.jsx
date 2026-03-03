import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

const ADMIN_TABS = [
  { id: 'users', label: 'Users' },
  { id: 'roles', label: 'Roles' },
  { id: 'clients', label: 'Clients' },
  { id: 'permissions', label: 'Permissions' },
];

const PLATFORMS = ['google_ads', 'facebook_ads', 'bing_ads', 'tiktok_ads', 'pinterest_ads', 'reddit_ads', 'snapchat_ads', 'linkedin_ads'];
const CATEGORIES = ['sidebar', 'report_tab', 'action', 'customer'];

export function Admin() {
  const [activeTab, setActiveTab] = useState('users');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const showMessage = useCallback((msg, isError = false) => {
    setMessage(msg);
    setError(isError);
    setTimeout(() => { setMessage(null); setError(null); }, 4000);
  }, []);

  return (
    <div className="page-section active" id="page-admin">
      <div className="page-content">
        <div className="page-title-bar">
          <h2>Admin Panel</h2>
          <p>Manage users, roles, clients, and permissions</p>
        </div>

        <div className="admin-tabs">
          {ADMIN_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`btn ${activeTab === t.id ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {message && (
          <div className={`admin-message ${error ? 'error' : 'success'}`}>
            {message}
          </div>
        )}

        {activeTab === 'users' && <AdminUsersTab onMessage={showMessage} setLoading={setLoading} />}
        {activeTab === 'roles' && <AdminRolesTab onMessage={showMessage} setLoading={setLoading} />}
        {activeTab === 'clients' && <AdminClientsTab onMessage={showMessage} setLoading={setLoading} />}
        {activeTab === 'permissions' && <AdminPermissionsTab onMessage={showMessage} setLoading={setLoading} />}
      </div>
    </div>
  );
}

function AdminUsersTab({ onMessage, setLoading }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [userAssignedClients, setUserAssignedClients] = useState({});
  const [search, setSearch] = useState('');
  const [manageClientsUser, setManageClientsUser] = useState(null);
  const [allClients, setAllClients] = useState([]);
  const [userClientAssignments, setUserClientAssignments] = useState({});

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const { data: rolesData, error: rolesErr } = await supabase.from('roles').select('*');
      if (rolesErr) console.warn('[Admin] roles fetch:', rolesErr);
      setRoles(rolesData || []);

      const { data: profiles, error } = await supabase
        .from('user_profiles')
        .select('id, email, full_name, is_active, role_id')
        .order('full_name');

      if (error) throw error;
      setUsers(profiles || []);

      const { data: ucData } = await supabase.from('user_clients').select('user_id, client_id');
      const { data: mcData } = await supabase.from('master_clients').select('id, client_name');
      const mcMap = new Map((mcData || []).map((c) => [c.id, c.client_name]));
      const byUser = {};
      (ucData || []).forEach((r) => {
        if (!byUser[r.user_id]) byUser[r.user_id] = [];
        const name = mcMap.get(r.client_id) || r.client_id;
        byUser[r.user_id].push({ client_id: r.client_id, client_name: name });
      });
      setUserAssignedClients(byUser);
    } catch (err) {
      onMessage(err.message || 'Failed to load users', true);
    } finally {
      setLoading(false);
    }
  }, [onMessage, setLoading]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const loadAllClients = useCallback(async () => {
    const { data } = await supabase.from('master_clients').select('id, client_name, is_active').order('client_name');
    setAllClients(data || []);
  }, []);

  const loadUserClients = useCallback(async (userId) => {
    const { data } = await supabase.from('user_clients').select('client_id').eq('user_id', userId);
    setUserClientAssignments((prev) => ({ ...prev, [userId]: new Set((data || []).map((r) => r.client_id)) }));
  }, []);

  const openManageClients = async (user) => {
    setManageClientsUser(user);
    await loadAllClients();
    await loadUserClients(user.id);
  };

  const saveUserRole = async (userId, roleId) => {
    try {
      const { error } = await supabase.from('user_profiles').update({ role_id: roleId || null }).eq('id', userId);
      if (error) throw error;
      onMessage('Role updated');
      loadUsers();
    } catch (err) {
      onMessage(err?.message || 'Failed to update role', true);
    }
  };

  const saveUserActive = async (userId, isActive) => {
    try {
      const { error } = await supabase.from('user_profiles').update({ is_active: isActive }).eq('id', userId);
      if (error) throw error;
      onMessage('Status updated');
      loadUsers();
    } catch (err) {
      onMessage(err.message || 'Failed to update status', true);
    }
  };

  const saveUserClients = async () => {
    if (!manageClientsUser) return;
    try {
      const assigned = userClientAssignments[manageClientsUser.id] || new Set();
      const { error: delErr } = await supabase.from('user_clients').delete().eq('user_id', manageClientsUser.id);
      if (delErr) throw delErr;
      if (assigned.size) {
        const rows = [...assigned].map((client_id) => ({ user_id: manageClientsUser.id, client_id }));
        const { error: insErr } = await supabase.from('user_clients').insert(rows);
        if (insErr) throw insErr;
      }
      onMessage('Client assignments saved');
      setManageClientsUser(null);
      loadUsers();
    } catch (err) {
      onMessage(err?.message || 'Failed to save', true);
    }
  };

  const toggleClient = (userId, clientId) => {
    setUserClientAssignments((prev) => {
      const prevSet = prev[userId] || new Set();
      const next = new Set(prevSet);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return { ...prev, [userId]: next };
    });
  };

  const filtered = users.filter((u) => {
    const s = search.toLowerCase();
    return !s || (u.full_name || '').toLowerCase().includes(s) || (u.email || '').toLowerCase().includes(s);
  });

  return (
    <div className="admin-card">
      <div className="admin-toolbar">
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="admin-search"
        />
      </div>
      <div className="table-wrapper">
        <table className="data-table gads-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Active</th>
              <th>Assigned Clients</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const assigned = userAssignedClients[u.id] || [];
              const assignedLabel = assigned.length === 0
                ? '—'
                : assigned.length <= 2
                  ? assigned.map((a) => a.client_name).join(', ')
                  : `${assigned.length} clients`;
              return (
                <tr key={u.id}>
                  <td>{u.full_name || u.name || u.email?.split('@')[0] || '—'}</td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      className="admin-role-select"
                      value={roles.some((r) => r.id === u.role_id) ? u.role_id : ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        saveUserRole(u.id, val || null);
                      }}
                    >
                      <option value="">— Select role —</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>{r.name || r.role_name || String(r.id)}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <label className="admin-toggle">
                      <input
                        type="checkbox"
                        checked={!!u.is_active}
                        onChange={(e) => saveUserActive(u.id, e.target.checked)}
                      />
                      <span />
                    </label>
                  </td>
                  <td title={assigned.map((a) => a.client_name).join(', ')}>{assignedLabel}</td>
                  <td>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => openManageClients(u)} title="Manage assigned clients">
                      Manage Clients
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {manageClientsUser && (
        <div className="admin-modal-overlay" onClick={() => setManageClientsUser(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Manage Clients: {manageClientsUser.full_name || manageClientsUser.email}</h3>
            <div className="admin-modal-body">
              {allClients.length === 0 ? (
                <p className="admin-modal-empty">No clients found. Add clients in the Clients tab first.</p>
              ) : (
                allClients.map((c) => (
                  <label key={c.id} className="admin-checkbox-row">
                    <input
                      type="checkbox"
                      checked={(userClientAssignments[manageClientsUser.id] || new Set()).has(c.id)}
                      onChange={() => toggleClient(manageClientsUser.id, c.id)}
                    />
                    {c.client_name}
                    {c.is_active === false && <span className="admin-badge-inactive"> inactive</span>}
                  </label>
                ))
              )}
            </div>
            <div className="admin-modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setManageClientsUser(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={saveUserClients}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminRolesTab({ onMessage, setLoading }) {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [editingRole, setEditingRole] = useState(null);
  const [pendingPermissions, setPendingPermissions] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [newRoleModal, setNewRoleModal] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');

  const loadRoles = useCallback(async () => {
    const { data, error } = await supabase.from('roles').select('*');
    if (error) {
      console.warn('[Admin] roles:', error);
      setRoles([]);
      return;
    }
    setRoles((data || []).sort((a, b) => (a.name || a.role_name || '').localeCompare(b.name || b.role_name || '')));
  }, []);

  const loadPermissions = useCallback(async () => {
    const { data, error } = await supabase.from('permissions').select('*').order('category').order('permission_key');
    if (error) console.warn('[Admin] permissions:', error);
    setPermissions(data || []);
  }, []);

  const loadRolePermissions = useCallback(async (roleId) => {
    const { data } = await supabase.from('role_permissions').select('permission_id').eq('role_id', roleId);
    setPendingPermissions(new Set((data || []).map((r) => r.permission_id)));
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadRoles(), loadPermissions()]).finally(() => setLoading(false));
  }, [loadRoles, loadPermissions, setLoading]);

  useEffect(() => {
    if (editingRole) loadRolePermissions(editingRole.id);
  }, [editingRole, loadRolePermissions]);

  const togglePermission = (permissionId) => {
    setPendingPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(permissionId)) next.delete(permissionId);
      else next.add(permissionId);
      return next;
    });
  };

  const saveRolePermissions = async () => {
    if (!editingRole) return;
    setSaving(true);
    try {
      const { error: delErr } = await supabase.from('role_permissions').delete().eq('role_id', editingRole.id);
      if (delErr) throw delErr;
      if (pendingPermissions.size > 0) {
        const rows = [...pendingPermissions].map((permission_id) => ({ role_id: editingRole.id, permission_id }));
        const { error: insErr } = await supabase.from('role_permissions').insert(rows);
        if (insErr) throw insErr;
      }
      onMessage('Permissions saved');
    } catch (err) {
      onMessage(err?.message || 'Failed to save', true);
    } finally {
      setSaving(false);
    }
  };

  const createRole = async () => {
    if (!newRoleName.trim()) return;
    try {
      const { error } = await supabase.from('roles').insert({ name: newRoleName.trim(), description: newRoleDesc.trim() || null });
      if (error) throw error;
      onMessage('Role created');
      setNewRoleModal(false);
      setNewRoleName('');
      setNewRoleDesc('');
      loadRoles();
    } catch (err) {
      onMessage(err?.message || 'Failed to create role', true);
    }
  };

  const byCategory = permissions.reduce((acc, p) => {
    const c = p.category || 'other';
    if (!acc[c]) acc[c] = [];
    acc[c].push(p);
    return acc;
  }, {});

  const roleDisplayName = (r) => r.name || r.role_name || r.id;

  return (
    <div className="admin-card">
      <div className="admin-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => setNewRoleModal(true)}>Create New Role</button>
      </div>
      <div className="admin-roles-grid">
        <div className="admin-roles-list">
          <div className="admin-roles-section-label">Roles</div>
          {roles.length === 0 ? (
            <p className="admin-empty-hint">No roles found. Create one above.</p>
          ) : (
            roles.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`admin-role-btn ${editingRole?.id === r.id ? 'active' : ''}`}
                onClick={() => setEditingRole(r)}
              >
                <span className="admin-role-name">{roleDisplayName(r)}</span>
                {r.description && <span className="admin-role-desc">{r.description}</span>}
              </button>
            ))
          )}
        </div>
        <div className="admin-permissions-editor">
          {editingRole ? (
            <>
              <div className="admin-permissions-header">
                <div>
                  <h4>{roleDisplayName(editingRole)}</h4>
                  {editingRole.description && <p className="admin-role-desc-block">{editingRole.description}</p>}
                </div>
                <button type="button" className="btn btn-primary" onClick={saveRolePermissions} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Permissions'}
                </button>
              </div>
              {CATEGORIES.map((cat) => (
                <div key={cat} className="admin-perm-group">
                  <div className="admin-perm-group-label">{cat}</div>
                  {byCategory[cat]?.map((p) => (
                    <label key={p.id} className="admin-checkbox-row">
                      <input
                        type="checkbox"
                        checked={pendingPermissions.has(p.id)}
                        onChange={() => togglePermission(p.id)}
                      />
                      {p.permission_label || p.permission_key}
                    </label>
                  ))}
                </div>
              ))}
            </>
          ) : (
            <div className="admin-select-role-hint">
              <p>Select a role on the left to edit its permissions.</p>
            </div>
          )}
        </div>
      </div>

      {newRoleModal && (
        <div className="admin-modal-overlay" onClick={() => setNewRoleModal(false)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create New Role</h3>
            <div className="admin-modal-body">
              <div className="auth-form-group">
                <label>Name</label>
                <input type="text" value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="Role name" />
              </div>
              <div className="auth-form-group">
                <label>Description</label>
                <input type="text" value={newRoleDesc} onChange={(e) => setNewRoleDesc(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div className="admin-modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setNewRoleModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={createRole}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminClientsTab({ onMessage, setLoading }) {
  const [clients, setClients] = useState([]);
  const [platformAccountsByClient, setPlatformAccountsByClient] = useState({});
  const [expandedClientId, setExpandedClientId] = useState(null);
  const [addClientModal, setAddClientModal] = useState(false);
  const [addAccountModal, setAddAccountModal] = useState(null);
  const [formData, setFormData] = useState({});

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const { data: clientsData, error } = await supabase.from('master_clients').select('*').order('client_name');
      if (error) throw error;
      setClients(clientsData || []);

      const { data: paData } = await supabase.from('client_platform_accounts').select('*');
      const byClient = {};
      (paData || []).forEach((pa) => {
        if (!byClient[pa.client_id]) byClient[pa.client_id] = [];
        byClient[pa.client_id].push(pa);
      });
      setPlatformAccountsByClient(byClient);
    } catch (err) {
      onMessage(err.message || 'Failed to load clients', true);
    } finally {
      setLoading(false);
    }
  }, [onMessage, setLoading]);

  useEffect(() => { loadClients(); }, [loadClients]);

  const saveClient = async (updates) => {
    if (!updates.client_name?.trim()) {
      onMessage('Client name is required', true);
      return;
    }
    try {
      if (updates.id) {
        const { error } = await supabase.from('master_clients').update({
          client_name: updates.client_name.trim(),
          client_code: updates.client_code?.trim() || null,
          contact_email: updates.contact_email?.trim() || null,
          website: updates.website?.trim() || null,
          notes: updates.notes?.trim() || null,
        }).eq('id', updates.id);
        if (error) throw error;
        onMessage('Client updated');
      } else {
        const { error } = await supabase.from('master_clients').insert({
          client_name: updates.client_name.trim(),
          client_code: updates.client_code?.trim() || null,
          contact_email: updates.contact_email?.trim() || null,
          website: updates.website?.trim() || null,
          notes: updates.notes?.trim() || null,
          is_active: true,
        });
        if (error) throw error;
        onMessage('Client created');
      }
      setAddClientModal(false);
      setFormData({});
      loadClients();
    } catch (err) {
      onMessage(err?.message || 'Failed', true);
    }
  };

  const createClient = () => {
    setFormData({ client_name: '', client_code: '', contact_email: '', website: '', notes: '' });
    setAddClientModal(true);
  };

  const openAddAccount = (client) => {
    setAddAccountModal(client);
    setFormData({ platform: '', platform_customer_id: '', account_name: '' });
  };

  const addPlatformAccount = async () => {
    const client = addAccountModal;
    if (!client || !formData.platform || !formData.platform_customer_id?.trim()) {
      onMessage('Platform and Account ID are required', true);
      return;
    }
    try {
      const { error } = await supabase.from('client_platform_accounts').insert({
        client_id: client.id,
        platform: formData.platform,
        platform_customer_id: formData.platform_customer_id.trim(),
        account_name: formData.account_name?.trim() || null,
      });
      if (error) throw error;
      onMessage('Platform account added');
      setAddAccountModal(null);
      setFormData({});
      loadClients();
    } catch (err) {
      onMessage(err?.message || 'Failed', true);
    }
  };

  const deletePlatformAccount = async (clientId, accountId) => {
    if (!confirm('Delete this platform account?')) return;
    try {
      const { error } = await supabase.from('client_platform_accounts').delete().eq('id', accountId);
      if (error) throw error;
      onMessage('Account removed');
      loadClients();
    } catch (err) {
      onMessage(err?.message || 'Failed', true);
    }
  };

  const toggleClientActive = async (client) => {
    try {
      const { error } = await supabase.from('master_clients').update({ is_active: !client.is_active }).eq('id', client.id);
      if (error) throw error;
      onMessage('Status updated');
      loadClients();
    } catch (err) {
      onMessage(err?.message || 'Failed', true);
    }
  };

  const toggleExpand = (clientId) => {
    setExpandedClientId((prev) => (prev === clientId ? null : clientId));
  };

  return (
    <div className="admin-card">
      <div className="admin-toolbar">
        <button type="button" className="btn btn-primary" onClick={createClient}>Add New Client</button>
      </div>
      <div className="table-wrapper">
        <table className="data-table gads-table admin-clients-table">
          <thead>
            <tr>
              <th style={{ width: 32 }} />
              <th>Client Name</th>
              <th>Code</th>
              <th>Email</th>
              <th>Platform Accounts</th>
              <th>Active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const accounts = platformAccountsByClient[c.id] || [];
              const isExpanded = expandedClientId === c.id;
              return (
                <React.Fragment key={c.id}>
                  <tr className={isExpanded ? 'admin-row-expanded' : ''}>
                    <td>
                      <button
                        type="button"
                        className="admin-expand-btn"
                        onClick={() => toggleExpand(c.id)}
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        {isExpanded ? '▼' : '▶'}
                      </button>
                    </td>
                    <td>{c.client_name}</td>
                    <td>{c.client_code || '—'}</td>
                    <td>{c.contact_email || '—'}</td>
                    <td>{accounts.length}</td>
                    <td>
                      <label className="admin-toggle">
                        <input type="checkbox" checked={!!c.is_active} onChange={() => toggleClientActive(c)} />
                        <span />
                      </label>
                    </td>
                    <td>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => openAddAccount(c)}>Add Platform Account</button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="admin-expand-row">
                      <td colSpan={7}>
                        <div className="admin-platform-accounts-inline">
                          <div className="admin-platform-accounts-header">
                            <span>Linked platform accounts</span>
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => openAddAccount(c)}>+ Add Platform Account</button>
                          </div>
                          {accounts.length === 0 ? (
                            <p className="admin-empty-hint">No platform accounts. Click &quot;Add Platform Account&quot; to link a Google Ads, Meta, etc. account.</p>
                          ) : (
                            <ul className="admin-platform-list">
                              {accounts.map((pa) => (
                                <li key={pa.id}>
                                  <span className="admin-platform-badge">{pa.platform}</span>
                                  <span>{pa.platform_customer_id}</span>
                                  {pa.account_name && <span className="admin-account-name">{pa.account_name}</span>}
                                  <button type="button" className="btn btn-outline btn-sm" onClick={() => deletePlatformAccount(c.id, pa.id)}>Delete</button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {addClientModal && (
        <div className="admin-modal-overlay" onClick={() => setAddClientModal(false)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add New Client</h3>
            <div className="admin-modal-body">
              {['client_name', 'client_code', 'contact_email', 'website', 'notes'].map((k) => (
                <div key={k} className="auth-form-group">
                  <label>{k.replace(/_/g, ' ')}{k === 'client_name' ? ' *' : ''}</label>
                  <input type="text" value={formData[k] || ''} onChange={(e) => setFormData({ ...formData, [k]: e.target.value })} placeholder={k === 'client_name' ? 'Required' : ''} />
                </div>
              ))}
            </div>
            <div className="admin-modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setAddClientModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => saveClient(formData)}>Create</button>
            </div>
          </div>
        </div>
      )}

      {addAccountModal && (
        <div className="admin-modal-overlay" onClick={() => setAddAccountModal(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Platform Account — {addAccountModal.client_name}</h3>
            <div className="admin-modal-body">
              <div className="auth-form-group">
                <label>Platform *</label>
                <select value={formData.platform || ''} onChange={(e) => setFormData({ ...formData, platform: e.target.value })} required>
                  <option value="">Select platform...</option>
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="auth-form-group">
                <label>Account ID *</label>
                <input type="text" value={formData.platform_customer_id || ''} onChange={(e) => setFormData({ ...formData, platform_customer_id: e.target.value })} placeholder="e.g. 3969168045 for Google Ads" required />
              </div>
              <div className="auth-form-group">
                <label>Account Name</label>
                <input type="text" value={formData.account_name || ''} onChange={(e) => setFormData({ ...formData, account_name: e.target.value })} placeholder="Optional display name" />
              </div>
            </div>
            <div className="admin-modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setAddAccountModal(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={addPlatformAccount}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminPermissionsTab({ onMessage, setLoading }) {
  const [permissions, setPermissions] = useState([]);
  const [addModal, setAddModal] = useState(false);
  const [formData, setFormData] = useState({});

  const loadPermissions = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('permissions').select('*').order('category').order('permission_key');
    setPermissions(data || []);
    setLoading(false);
  }, [setLoading]);

  useEffect(() => { loadPermissions(); }, [loadPermissions]);

  const createPermission = async () => {
    if (!formData.permission_key?.trim()) return;
    try {
      await supabase.from('permissions').insert({
        permission_key: formData.permission_key.trim(),
        permission_label: formData.permission_label?.trim() || formData.permission_key.trim(),
        category: formData.category || 'sidebar',
      });
      onMessage('Permission created');
      setAddModal(false);
      setFormData({});
      loadPermissions();
    } catch (err) {
      onMessage(err.message || 'Failed', true);
    }
  };

  const deletePermission = async (id) => {
    if (!confirm('Delete this permission? This may affect role assignments.')) return;
    try {
      await supabase.from('permissions').delete().eq('id', id);
      onMessage('Permission deleted');
      loadPermissions();
    } catch (err) {
      onMessage(err.message || 'Failed', true);
    }
  };

  const byCategory = permissions.reduce((acc, p) => {
    const c = p.category || 'other';
    if (!acc[c]) acc[c] = [];
    acc[c].push(p);
    return acc;
  }, {});

  return (
    <div className="admin-card">
      <div className="admin-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => { setFormData({}); setAddModal(true); }}>Add New Permission</button>
      </div>
      <div className="admin-permissions-list">
        {CATEGORIES.map((cat) => (
          <div key={cat} className="admin-perm-group">
            <div className="admin-perm-group-label">{cat}</div>
            <table className="data-table gads-table">
              <tbody>
                {(byCategory[cat] || []).map((p) => (
                  <tr key={p.id}>
                    <td>{p.permission_key}</td>
                    <td>{p.permission_label || '—'}</td>
                    <td>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => deletePermission(p.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {addModal && (
        <div className="admin-modal-overlay" onClick={() => setAddModal(false)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add New Permission</h3>
            <div className="admin-modal-body">
              <div className="auth-form-group">
                <label>Permission Key</label>
                <input type="text" value={formData.permission_key || ''} onChange={(e) => setFormData({ ...formData, permission_key: e.target.value })} placeholder="e.g. sidebar.analytics" />
              </div>
              <div className="auth-form-group">
                <label>Display Label</label>
                <input type="text" value={formData.permission_label || ''} onChange={(e) => setFormData({ ...formData, permission_label: e.target.value })} />
              </div>
              <div className="auth-form-group">
                <label>Category</label>
                <select value={formData.category || 'sidebar'} onChange={(e) => setFormData({ ...formData, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="admin-modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setAddModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={createPermission}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
