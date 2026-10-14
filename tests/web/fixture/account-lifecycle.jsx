import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountPage } from '@xcss/web/admin-shell';

window.accountRequests = [];
window.accountUpdates = [];
function makeClient(identity) {
  return { updateAccount(input) {
    return new Promise((resolve, reject) => window.accountRequests.push({ identity, input, resolve, reject }));
  } };
}
const oldClient = makeClient('old'), newClient = makeClient('new');
function Probe() {
  const [client, setClient] = useState(oldClient);
  const [username, setUsername] = useState('admin');
  const [visible, setVisible] = useState(true);
  return <><button onClick={() => setClient(newClient)}>Replace client</button>
    <button onClick={() => setUsername('other')}>Replace username</button>
    <button onClick={() => {
      window.detachedPasswords = [...document.querySelectorAll('input[type="password"]')];
      setVisible(false);
    }}>Unmount account</button>
    {visible && <AccountPage client={client} username={username} onUpdated={() => window.accountUpdates.push(client === oldClient ? 'old' : 'new')} />}</>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Probe /></StrictMode>);
