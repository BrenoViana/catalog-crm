import './UsersPermissionsModal.css';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Modal } from './Modal';
import {
  accessApi,
  type AccessRole,
  type AccessUser,
  type Permission,
} from '../lib/api-client';
import { dateOnly } from '../lib/format';
import { useAuthStore } from '../store/authStore';

type Tab = 'users' | 'roles';
/** Estado de cada permissão na ficha do usuário. */
type Override = 'inherit' | 'allow' | 'deny';

const ADMIN_KEY = 'ADMIN';

function groupBy(permissions: Permission[]) {
  const groups = new Map<string, Permission[]>();
  for (const p of permissions) {
    const list = groups.get(p.group) ?? [];
    list.push(p);
    groups.set(p.group, list);
  }
  return [...groups.entries()];
}

/* ------------------------------------------------------------------ Usuários */

function UsersTab({
  users,
  roles,
  permissions,
}: {
  users: AccessUser[];
  roles: AccessRole[];
  permissions: Permission[];
}) {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const setMyPermissions = useAuthStore((s) => s.setPermissions);
  const [selectedId, setSelectedId] = useState(users[0]?.id ?? '');
  const [error, setError] = useState('');

  const selected = users.find((u) => u.id === selectedId) ?? users[0];
  const role = roles.find((r) => r.id === selected?.roleId);
  const fromRole = useMemo(
    () => new Set(role?.permissions.map((p) => p.permissionKey) ?? []),
    [role],
  );
  const overrides = useMemo(
    () => new Map(selected?.overrides.map((o) => [o.permissionKey, o.allow]) ?? []),
    [selected],
  );

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['access'] });
    // Se mexi em mim mesmo, a UI precisa refletir agora.
    if (selected?.id === me?.id) {
      const mine = await accessApi.me();
      setMyPermissions(mine.permissions);
    }
  };

  const onError = (e: unknown) =>
    setError(e instanceof Error ? e.message : 'Não foi possível salvar.');

  const changeRole = useMutation({
    mutationFn: (roleId: string) => accessApi.setUserRole(selected!.id, roleId),
    onSuccess: () => { setError(''); void refresh(); },
    onError,
  });

  const toggleActive = useMutation({
    mutationFn: (active: boolean) => accessApi.setUserActive(selected!.id, active),
    onSuccess: () => { setError(''); void refresh(); },
    onError,
  });

  const saveOverride = useMutation({
    mutationFn: async ({ key, state }: { key: string; state: Override }) => {
      const next = selected!.overrides.filter((o) => o.permissionKey !== key);
      if (state !== 'inherit') next.push({ permissionKey: key, allow: state === 'allow' });
      return accessApi.setUserOverrides(selected!.id, next);
    },
    onSuccess: () => { setError(''); void refresh(); },
    onError,
  });

  if (!selected) return <p className="muted">Nenhum usuário cadastrado.</p>;

  const stateOf = (key: string): Override => {
    const o = overrides.get(key);
    if (o === undefined) return 'inherit';
    return o ? 'allow' : 'deny';
  };
  const effective = (key: string) => {
    const s = stateOf(key);
    return s === 'inherit' ? fromRole.has(key) : s === 'allow';
  };

  const isAdminRole = role?.key === ADMIN_KEY;

  return (
    <div className="access-split">
      <ul className="access-list">
        {users.map((u) => (
          <li key={u.id}>
            <button
              className={`access-list-row ${u.id === selected.id ? 'active' : ''}`}
              onClick={() => { setSelectedId(u.id); setError(''); }}
            >
              <span>
                <strong>{u.name}</strong>
                <small>
                  @{u.username} · {u.accessRole?.name ?? 'sem papel'}
                </small>
              </span>
              {!u.active ? <span className="tag tag-warning">Inativo</span> : null}
            </button>
          </li>
        ))}
      </ul>

      <div className="access-detail">
        <div className="access-detail-head">
          <div>
            <strong>{selected.name}</strong>
            <small className="muted">
              @{selected.username} · desde {dateOnly(selected.createdAt)}
            </small>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={selected.active}
              disabled={toggleActive.isPending}
              onChange={(e) => toggleActive.mutate(e.target.checked)}
            />
            Ativo
          </label>
        </div>

        <label className="field">
          <span>Papel</span>
          <select
            value={selected.roleId ?? ''}
            disabled={changeRole.isPending}
            onChange={(e) => changeRole.mutate(e.target.value)}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        {error ? <div className="error-message">{error}</div> : null}

        {isAdminRole ? (
          <p className="muted">
            O papel <strong>Administrador</strong> concede acesso total e não aceita
            exceções — é a garantia de que sempre há quem consiga reverter mudanças.
          </p>
        ) : (
          <>
            <p className="muted access-hint">
              Cada permissão herda do papel. <strong>Permitir</strong> e{' '}
              <strong>Bloquear</strong> criam uma exceção só para este usuário.
            </p>
            {groupBy(permissions).map(([group, list]) => (
              <section key={group} className="access-group">
                <h4>{group}</h4>
                {list.map((p) => (
                  <div className="access-perm" key={p.key}>
                    <div className="access-perm-label">
                      <span>{p.label}</span>
                      <small>{p.description}</small>
                    </div>
                    <div className="access-seg" role="group" aria-label={p.label}>
                      {(['inherit', 'allow', 'deny'] as Override[]).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          className={stateOf(p.key) === opt ? 'active' : ''}
                          disabled={saveOverride.isPending}
                          onClick={() => saveOverride.mutate({ key: p.key, state: opt })}
                        >
                          {opt === 'inherit'
                            ? `Herdar${fromRole.has(p.key) ? ' (sim)' : ' (não)'}`
                            : opt === 'allow'
                              ? 'Permitir'
                              : 'Bloquear'}
                        </button>
                      ))}
                    </div>
                    <span
                      className={`access-effective ${effective(p.key) ? 'yes' : 'no'}`}
                      title="Resultado efetivo"
                    >
                      {effective(p.key) ? 'Sim' : 'Não'}
                    </span>
                  </div>
                ))}
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- Papéis */

function RolesTab({
  roles,
  permissions,
}: {
  roles: AccessRole[];
  permissions: Permission[];
}) {
  const queryClient = useQueryClient();
  const setMyPermissions = useAuthStore((s) => s.setPermissions);
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? '');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ key: '', name: '', description: '' });
  const [error, setError] = useState('');

  const selected = roles.find((r) => r.id === selectedId) ?? roles[0];
  const granted = useMemo(
    () => new Set(selected?.permissions.map((p) => p.permissionKey) ?? []),
    [selected],
  );

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['access'] });
    const mine = await accessApi.me();
    setMyPermissions(mine.permissions);
  };
  const onError = (e: unknown) =>
    setError(e instanceof Error ? e.message : 'Não foi possível salvar.');

  const togglePermission = useMutation({
    mutationFn: (key: string) => {
      const next = new Set(granted);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return accessApi.updateRole(selected!.id, { permissions: [...next] });
    },
    onSuccess: () => { setError(''); void refresh(); },
    onError,
  });

  const createRole = useMutation({
    mutationFn: () =>
      accessApi.createRole({
        key: draft.key,
        name: draft.name,
        description: draft.description || undefined,
        permissions: [],
      }),
    onSuccess: (role) => {
      setError('');
      setCreating(false);
      setDraft({ key: '', name: '', description: '' });
      setSelectedId(role.id);
      void refresh();
    },
    onError,
  });

  const removeRole = useMutation({
    mutationFn: () => accessApi.removeRole(selected!.id),
    onSuccess: () => { setError(''); setSelectedId(roles[0]?.id ?? ''); void refresh(); },
    onError,
  });

  if (!selected) return <p className="muted">Nenhum papel cadastrado.</p>;
  const isAdmin = selected.key === ADMIN_KEY;

  return (
    <div className="access-split">
      <div>
        <ul className="access-list">
          {roles.map((r) => (
            <li key={r.id}>
              <button
                className={`access-list-row ${r.id === selected.id ? 'active' : ''}`}
                onClick={() => { setSelectedId(r.id); setError(''); }}
              >
                <span>
                  <strong>{r.name}</strong>
                  <small>
                    {r.permissions.length} permissões · {r._count?.users ?? 0} usuário(s)
                  </small>
                </span>
                {r.system ? <span className="tag">interno</span> : null}
              </button>
            </li>
          ))}
        </ul>
        <button className="mini-button" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancelar' : '+ Novo papel'}
        </button>
        {creating ? (
          <div className="access-new-role">
            <label className="field">
              <span>Nome</span>
              <input
                value={draft.name}
                placeholder="Supervisor de loja"
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    name: e.target.value,
                    key: d.key || e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Chave</span>
              <input
                value={draft.key}
                placeholder="SUPERVISOR"
                onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))}
              />
            </label>
            <button
              className="primary-button"
              disabled={!draft.name.trim() || !draft.key.trim() || createRole.isPending}
              onClick={() => createRole.mutate()}
            >
              Criar papel
            </button>
          </div>
        ) : null}
      </div>

      <div className="access-detail">
        <div className="access-detail-head">
          <div>
            <strong>{selected.name}</strong>
            <small className="muted">{selected.description}</small>
          </div>
          {!selected.system ? (
            <button
              className="mini-button danger"
              disabled={removeRole.isPending}
              onClick={() => removeRole.mutate()}
            >
              Remover papel
            </button>
          ) : null}
        </div>

        {error ? <div className="error-message">{error}</div> : null}

        {isAdmin ? (
          <p className="muted">
            O <strong>Administrador</strong> recebe todas as permissões automaticamente,
            inclusive as que forem criadas depois. Não pode ser reduzido.
          </p>
        ) : (
          groupBy(permissions).map(([group, list]) => (
            <section key={group} className="access-group">
              <h4>{group}</h4>
              {list.map((p) => (
                <label className="access-perm access-perm-check" key={p.key}>
                  <input
                    type="checkbox"
                    checked={granted.has(p.key)}
                    disabled={togglePermission.isPending}
                    onChange={() => togglePermission.mutate(p.key)}
                  />
                  <div className="access-perm-label">
                    <span>{p.label}</span>
                    <small>{p.description}</small>
                  </div>
                </label>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- Modal */

export function UsersPermissionsModal({ onClose }: { onClose: () => void }) {
  // ?tab=papeis deixa o link apontar direto para a aba desejada.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'papeis' ? 'roles' : 'users';
  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'roles') params.set('tab', 'papeis');
    else params.delete('tab');
    setSearchParams(params, { replace: true });
  };

  const permissions = useQuery({
    queryKey: ['access', 'permissions'],
    queryFn: accessApi.permissions,
  });
  const roles = useQuery({ queryKey: ['access', 'roles'], queryFn: accessApi.roles });
  const users = useQuery({ queryKey: ['access', 'users'], queryFn: accessApi.users });

  const loading = permissions.isLoading || roles.isLoading || users.isLoading;
  const error = permissions.error ?? roles.error ?? users.error;

  return (
    <Modal title="Usuários e permissões" onClose={onClose} width={1040}>
      <div className="access-tabs">
        <button
          className={`pill-button ${tab === 'users' ? 'active' : ''}`}
          onClick={() => setTab('users')}
        >
          Usuários
        </button>
        <button
          className={`pill-button ${tab === 'roles' ? 'active' : ''}`}
          onClick={() => setTab('roles')}
        >
          Papéis
        </button>
      </div>

      {error ? (
        <div className="error-message">
          {error instanceof Error ? error.message : 'Erro ao carregar.'}
        </div>
      ) : loading ? (
        <p className="muted">Carregando…</p>
      ) : tab === 'users' ? (
        <UsersTab
          users={users.data ?? []}
          roles={roles.data ?? []}
          permissions={permissions.data ?? []}
        />
      ) : (
        <RolesTab roles={roles.data ?? []} permissions={permissions.data ?? []} />
      )}
    </Modal>
  );
}
