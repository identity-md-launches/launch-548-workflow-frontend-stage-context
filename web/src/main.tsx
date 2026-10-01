import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadConfig } from './config';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<main className="shell boot"><h1>Guestbook</h1><p role="status">Verifying deployment files…</p></main>);
loadConfig().then(config => root.render(<App config={config} />)).catch(error => root.render(<main className="shell boot"><h1>Unable to open the guestbook</h1><p role="alert">{error.message}</p><p>Transactions are disabled until deployment files can be verified.</p><button onClick={() => location.reload()}>Reload page</button></main>));
