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

const EMPTY_USER = { username: '', name: '', password: '', roleId: '' };

/**
 * Ficha do usuário selecionado: identificação, papel, senha e as exceções de
 * permissão. Montada com `key={user.id}` para que os campos do formulário
 * voltem ao valor do banco sempre que a seleção muda.
 */
function UserDetail({
  user,
  roles,
  permissions,
  refresh,
}: {
  user: AccessUser;
  roles: AccessRole[];
  permissions: Permission[];
  refresh: (userId: string) => Promise<void>;
}) {
  const me = useAuthStore((s) => s.user);
  const isSelf = me?.id === user.id;

  const [identity, setIdentity] = useState({ name: user.name, username: user.username });
  const [password, setPassword] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const role = roles.find((r) => r.id === user.roleId);
  const fromRole = useMemo(
    () => new Set(role?.permissions.map((p) => p.permissionKey) ?? []),
    [role],
  );
  const overrides = useMemo(
    () => new Map(user.overrides.map((o) => [o.permissionKey, o.allow])),
    [user],
  );

  const done = (message = '') => {
    setError('');
    setNotice(message);
    void refresh(user.id);
  };
  const onError = (e: unknown) => {
    setNotice('');
    setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
  };

  const saveIdentity = useMutation({
    mutationFn: () =>
      accessApi.updateUser(user.id, {
        name: identity.name.trim(),
        username: identity.username.trim().toLowerCase(),
      }),
    onSuccess: () => done('Dados atualizados.'),
    onError,
  });

  const savePassword = useMutation({
    mutationFn: () =>
      // Trocar a própria senha exige a atual; um administrador redefine a de
      // outra pessoa sem ela (fluxo de reset).
      accessApi.setUserPassword(user.id, {
        password: password.next,
        ...(isSelf ? { currentPassword: password.current } : {}),
      }),
    onSuccess: () => {
      setPassword({ current: '', next: '', confirm: '' });
      done('Senha alterada.');
    },
    onError,
  });

  const changeRole = useMutation({
    mutationFn: (roleId: string) => accessApi.setUserRole(user.id, roleId),
    onSuccess: () => done(),
    onError,
  });

  const toggleActive = useMutation({
    mutationFn: (active: boolean) => accessApi.setUserActive(user.id, active),
    onSuccess: () => done(),
    onError,
  });

  const saveOverride = useMutation({
    mutationFn: ({ key, state }: { key: string; state: Override }) => {
      const next = user.overrides.filter((o) => o.permissionKey !== key);
      if (state !== 'inherit') next.push({ permissionKey: key, allow: state === 'allow' });
      return accessApi.setUserOverrides(user.id, next);
    },
    onSuccess: () => done(),
    onError,
  });

  const stateOf = (key: string): Override => {
    const o = overrides.get(key);
    if (o === undefined) return 'inherit';
    return o ? 'allow' : 'deny';
  };
  const effective = (key: string) => {
    const s = stateOf(key);
    return s === 'inherit' ? fromRole.has(key) : s === 'allow';
  };

  const identityDirty =
    identity.name.trim() !== user.name ||
    identity.username.trim().toLowerCase() !== user.username;
  const passwordReady =
    password.next.length >= 8 &&
    password.next === password.confirm &&
    (!isSelf || password.current.length > 0);

  const isAdminRole = role?.key === ADMIN_KEY;

  return (
    <div className="access-detail">
      <div className="access-detail-head">
        <div>
          <strong>{user.name}</strong>
          <small className="muted">
            @{user.username} · desde {dateOnly(user.createdAt)}
          </small>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={user.active}
            disabled={toggleActive.isPending}
            onChange={(e) => toggleActive.mutate(e.target.checked)}
          />
          Ativo
        </label>
      </div>

      {error ? <div className="error-message">{error}</div> : null}
      {notice ? <div className="success-message">{notice}</div> : null}

      <section className="access-group">
        <h4>Identificação</h4>
        <div className="access-form-row">
          <label className="field">
            <span>Nome</span>
            <input
              value={identity.name}
              onChange={(e) => setIdentity((v) => ({ ...v, name: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>Login</span>
            <input
              value={identity.username}
              onChange={(e) => setIdentity((v) => ({ ...v, username: e.target.value }))}
            />
          </label>
        </div>
        <label className="field">
          <span>Papel</span>
          <select
            value={user.roleId ?? ''}
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
        <button
          className="primary-button"
          disabled={!identityDirty || saveIdentity.isPending}
          onClick={() => saveIdentity.mutate()}
        >
          {saveIdentity.isPending ? 'Salvando…' : 'Salvar dados'}
        </button>
      </section>

      <section className="access-group">
        <h4>Senha</h4>
        <p className="muted access-hint">
          {isSelf
            ? 'Para trocar a própria senha, informe a senha atual.'
            : `Redefinir a senha de ${user.name} não exige a senha antiga; avise a pessoa da nova senha.`}
        </p>
        <div className="access-form-row">
          {isSelf ? (
            <label className="field">
              <span>Senha atual</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password.current}
                onChange={(e) => setPassword((v) => ({ ...v, current: e.target.value }))}
              />
            </label>
          ) : null}
          <label className="field">
            <span>Nova senha</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password.next}
              onChange={(e) => setPassword((v) => ({ ...v, next: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>Confirmar</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password.confirm}
              onChange={(e) => setPassword((v) => ({ ...v, confirm: e.target.value }))}
            />
          </label>
        </div>
        {password.confirm && password.next !== password.confirm ? (
          <p className="muted">As senhas não conferem.</p>
        ) : password.next && password.next.length < 8 ? (
          <p className="muted">Use ao menos 8 caracteres.</p>
        ) : null}
        <button
          className="primary-button"
          disabled={!passwordReady || savePassword.isPending}
          onClick={() => savePassword.mutate()}
        >
          {savePassword.isPending ? 'Alterando…' : 'Alterar senha'}
        </button>
      </section>

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
  );
}

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
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_USER);
  const [createError, setCreateError] = useState('');

  const selected = users.find((u) => u.id === selectedId) ?? users[0];

  /** Recarrega as listas e, se a mudança foi em mim, o meu próprio conjunto. */
  const refresh = async (userId: string) => {
    await queryClient.invalidateQueries({ queryKey: ['access'] });
    if (userId === me?.id) {
      const mine = await accessApi.me();
      setMyPermissions(mine.permissions);
    }
  };

  const createUser = useMutation({
    mutationFn: () =>
      accessApi.createUser({
        username: draft.username.trim().toLowerCase(),
        name: draft.name.trim(),
        password: draft.password,
        roleId: draft.roleId || roles[0]?.id || '',
      }),
    onSuccess: (user) => {
      setCreateError('');
      setCreating(false);
      setDraft(EMPTY_USER);
      setSelectedId(user.id);
      void refresh(user.id);
    },
    onError: (e: unknown) =>
      setCreateError(e instanceof Error ? e.message : 'Não foi possível criar o usuário.'),
  });

  const draftValid =
    draft.name.trim().length >= 2 &&
    draft.username.trim().length >= 3 &&
    draft.password.length >= 8;

  return (
    <div className="access-split">
      <div>
        <ul className="access-list">
          {users.map((u) => (
            <li key={u.id}>
              <button
                className={`access-list-row ${u.id === selected?.id ? 'active' : ''}`}
                onClick={() => setSelectedId(u.id)}
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
        <button
          className="mini-button"
          onClick={() => {
            setCreating((v) => !v);
            setCreateError('');
          }}
        >
          {creating ? 'Cancelar' : '+ Novo usuário'}
        </button>
        {creating ? (
          <div className="access-new-role">
            <label className="field">
              <span>Nome</span>
              <input
                value={draft.name}
                placeholder="Maria Souza"
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    name: e.target.value,
                    // Sugere o login a partir do primeiro nome, sem travar a edição.
                    username:
                      d.username ||
                      e.target.value
                        .toLowerCase()
                        .normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '')
                        .split(' ')[0]
                        .replace(/[^a-z0-9._-]/g, ''),
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Login</span>
              <input
                value={draft.username}
                placeholder="maria"
                autoComplete="off"
                onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Senha provisória</span>
              <input
                type="password"
                autoComplete="new-password"
                value={draft.password}
                placeholder="ao menos 8 caracteres"
                onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Papel</span>
              <select
                value={draft.roleId || roles[0]?.id || ''}
                onChange={(e) => setDraft((d) => ({ ...d, roleId: e.target.value }))}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            {createError ? <div className="error-message">{createError}</div> : null}
            <button
              className="primary-button"
              disabled={!draftValid || createUser.isPending}
              onClick={() => createUser.mutate()}
            >
              {createUser.isPending ? 'Criando…' : 'Criar usuário'}
            </button>
          </div>
        ) : null}
      </div>

      {selected ? (
        <UserDetail
          key={selected.id}
          user={selected}
          roles={roles}
          permissions={permissions}
          refresh={refresh}
        />
      ) : (
        <p className="muted">Nenhum usuário cadastrado.</p>
      )}
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
