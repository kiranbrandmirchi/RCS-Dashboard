import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const AuthContext = createContext(null);

const AUTH_DISABLED =
  ['true', '1', 'yes'].includes(String(import.meta.env.VITE_AUTH_DISABLED || '').toLowerCase()) ||
  (typeof window !== 'undefined' && sessionStorage.getItem('auth_skip') === '1');

const SUPABASE_TIMEOUT_MS = 8000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase connection timed out')), ms)),
  ]);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  const [userRole, setUserRole] = useState('');
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [permissions, setPermissions] = useState(new Set());
  const [allowedClients, setAllowedClients] = useState([]);
  const [allowedPlatformAccounts, setAllowedPlatformAccounts] = useState({});
  const [allowedClientAccounts, setAllowedClientAccounts] = useState([]);
  const [canViewAllCustomers, setCanViewAllCustomers] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

  const isAuthenticated = !!session && !authError;
  const isActive = !authError || authError === 'pending';

  const hasPermission = useCallback((key) => {
    if (AUTH_DISABLED) return true;
    return permissions.has(key);
  }, [permissions]);

  const isCustomerAllowed = useCallback((platform, customerId) => {
    if (AUTH_DISABLED) return true;
    if (canViewAllCustomers) return true;
    const ids = allowedPlatformAccounts[platform];
    if (!ids) return false;
    return ids.includes(String(customerId));
  }, [canViewAllCustomers, allowedPlatformAccounts]);

  const loadUserProfile = useCallback(async (userId) => {
    if (!userId) return;
    try {
      const { data: permData, error: permErr } = await withTimeout(
        supabase.from('user_permissions_view').select('*').eq('user_id', userId),
        SUPABASE_TIMEOUT_MS
      );
      if (permErr) {
        console.warn('[Auth] user_permissions_view error:', permErr);
        setAuthError('Account pending setup. Contact admin.');
        return;
      }

      const rows = permData || [];
      const first = rows[0];
      if (!first) {
        setAuthError('Account pending setup. Contact admin.');
        setPermissions(new Set());
        setUserRole('');
        setUserName('');
        setUserEmail('');
        setProfileLoaded(true);
        return;
      }

      if (first.is_active === false) {
        setAuthError('Account deactivated. Contact admin.');
        await supabase.auth.signOut();
        setSession(null);
        setUser(null);
        setProfileLoaded(true);
        return;
      }

      const permSet = new Set(rows.map((r) => r.permission_key).filter(Boolean));
      const role = first.role_name || '';
      const viewAll = ['admin', 'manager'].includes(role?.toLowerCase()) || permSet.has('customer.view_all');

      setPermissions(permSet);
      setUserRole(role);
      setUserName(first.full_name || '');
      setUserEmail(first.email || '');
      setCanViewAllCustomers(viewAll);
      setAuthError(null);

      const { data: clientData, error: clientErr } = await withTimeout(
        supabase.from('user_clients_view').select('*').eq('user_id', userId),
        SUPABASE_TIMEOUT_MS
      );
      if (clientErr) {
        console.warn('[Auth] user_clients_view error:', clientErr);
      }

      const clients = [];
      const platformMap = {};
      const clientAccounts = [];
      (clientData || []).forEach((r) => {
        if (!clients.find((c) => c.client_id === r.client_id)) {
          clients.push({ client_id: r.client_id, client_name: r.client_name, client_code: r.client_code });
        }
        const platform = r.platform || 'google_ads';
        if (!platformMap[platform]) platformMap[platform] = [];
        if (r.platform_customer_id && !platformMap[platform].includes(String(r.platform_customer_id))) {
          platformMap[platform].push(String(r.platform_customer_id));
        }
        if (r.platform_customer_id) {
          clientAccounts.push({
            client_id: r.client_id,
            client_name: r.client_name,
            platform,
            platform_customer_id: String(r.platform_customer_id),
            account_name: r.account_name,
          });
        }
      });

      setAllowedClients(clients);
      setAllowedPlatformAccounts(platformMap);
      setAllowedClientAccounts(clientAccounts);
      setProfileLoaded(true);
    } catch (err) {
      console.warn('[Auth] loadUserProfile error:', err);
      setAuthError('Failed to load profile. Try refreshing.');
      setProfileLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (AUTH_DISABLED) {
      setLoading(false);
      setUser({ email: 'public', user_metadata: { full_name: 'Public' } });
      setUserRole('admin');
      setUserName('Public');
      setUserEmail('public');
      setPermissions(new Set(['sidebar.google_ads', 'tab.campaigns', 'tab.geo', 'customer.view_all']));
      setCanViewAllCustomers(true);
      setAllowedClients([]);
      setAllowedPlatformAccounts({});
      setAllowedClientAccounts([]);
      setProfileLoaded(true);
      return;
    }

    let mounted = true;

    withTimeout(supabase.auth.getSession(), SUPABASE_TIMEOUT_MS)
      .then(({ data: { session: s } }) => {
        if (!mounted) return;
        if (s) {
          setSession(s);
          setUser(s?.user ?? null);
          setAuthError(null);
          loadUserProfile(s.user?.id);
        } else {
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!mounted) return;
        console.warn('Supabase unavailable:', err.message);
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mounted) return;
      setSession(s);
      setUser(s?.user ?? null);
      if (s) {
        setAuthError(null);
        loadUserProfile(s.user?.id);
      } else {
        setProfileLoaded(false);
        setUserRole('');
        setUserName('');
        setUserEmail('');
        setPermissions(new Set());
        setAllowedClients([]);
        setAllowedPlatformAccounts({});
        setAllowedClientAccounts([]);
        setCanViewAllCustomers(false);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [AUTH_DISABLED, loadUserProfile]);

  useEffect(() => {
    if (session && user && profileLoaded && !authError) {
      setLoading(false);
    } else if (!session) {
      setLoading(false);
    }
  }, [session, user, profileLoaded, authError]);

  const signIn = useCallback(async (email, password) => {
    setAuthError(null);
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: String(email).trim(),
          password: String(password),
        }),
        SUPABASE_TIMEOUT_MS
      );
      if (error) return { success: false, error: error.message };
      setSession(data.session);
      setUser(data.user);
      setLoading(true);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || 'Cannot reach authentication server.' };
    }
  }, []);

  const signUp = useCallback(async (email, password, fullName = '') => {
    setAuthError(null);
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signUp({
          email: String(email).trim(),
          password: String(password),
          options: {
            data: { full_name: fullName ? String(fullName).trim() : null },
          },
        }),
        SUPABASE_TIMEOUT_MS
      );
      if (error) return { success: false, error: error.message };
      setSession(data.session);
      setUser(data.user);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || 'Cannot reach authentication server.' };
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setUserRole('');
    setUserName('');
    setUserEmail('');
    setPermissions(new Set());
    setAllowedClients([]);
    setAllowedPlatformAccounts({});
    setAllowedClientAccounts([]);
    setCanViewAllCustomers(false);
    setProfileLoaded(false);
    setAuthError(null);
  }, []);

  const value = {
    user,
    session,
    loading,
    authError,
    isAuthenticated,
    userRole,
    userName,
    userEmail,
    permissions,
    allowedClients,
    allowedPlatformAccounts,
    allowedClientAccounts,
    canViewAllCustomers,
    hasPermission,
    isCustomerAllowed,
    signIn,
    signUp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
