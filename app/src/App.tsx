import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Main } from './components/Main';
import { Admin } from './components/Admin';
import { Faucet } from './components/Faucet';
import './styles/app.css';
import './styles/header.css';

type Page = 'main' | 'admin' | 'faucet';

function hashToPage(hash: string): Page {
  if (hash === '#admin') return 'admin';
  if (hash === '#faucet') return 'faucet';
  return 'main';
}

export function App() {
  const [page, setPage] = useState<Page>(hashToPage(window.location.hash));

  useEffect(() => {
    const onHash = () => setPage(hashToPage(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="app">
      <Header />
      <main className="main">
        {page === 'admin' && <Admin />}
        {page === 'faucet' && <Faucet />}
        {page === 'main' && <Main />}
      </main>
    </div>
  );
}
