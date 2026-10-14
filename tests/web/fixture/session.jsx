import React, { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createAdministratorApiClient } from '@xcss/web/admin-web';
import { useAdministratorSession } from '@xcss/web/admin-web/react';

const session = { authenticated: true, user_id: 'A'.repeat(43), csrf_token: 'A'.repeat(43), username: 'old_admin', role: 'admin' };
const delayedLogout = new URLSearchParams(location.search).has('delayedLogout');
const oldClient = createAdministratorApiClient({ fetchImpl: async url => {
  if (delayedLogout && String(url).endsWith('/logout')) return new Promise((_resolve, reject) => {
    window.failOldLogout = () => reject(new TypeError('Old client disconnected'));
  });
  return Response.json(session);
} });
const newClient = createAdministratorApiClient({ fetchImpl: async url => {
  if (delayedLogout && String(url).endsWith('/session')) return Response.json({ ...session, username: 'new_admin' });
  return Response.json({ code: 'auth.session_required', message: 'Sign in', retryable: false }, { status: 401 });
} });
window.sessionCommits = [];
function Probe() {
  const [client, setClient] = useState(oldClient);
  const state = useAdministratorSession(client);
  useLayoutEffect(() => { window.sessionCommits.push({ replacement: client === newClient, phase: state.phase, username: state.session?.username ?? null }); });
  return <><output>{state.session?.username ?? state.phase}</output><button onClick={() => setClient(newClient)}>Replace client</button>
    <button onClick={() => void state.logout().catch(() => {})}>Sign out</button>
    <button onClick={() => void state.login('admin', 'incorrect password').catch(() => {})}>Fail sign in</button></>;
}
createRoot(document.getElementById('root')).render(<Probe />);
