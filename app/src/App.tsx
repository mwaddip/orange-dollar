import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Main } from './components/Main';
import { Admin } from './components/Admin';
import './styles/app.css';
import './styles/header.css';

export function App() {
  const [isAdmin, setIsAdmin] = useState(window.location.hash === '#admin');

  useEffect(() => {
    const onHash = () => setIsAdmin(window.location.hash === '#admin');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="app">
      <Header />
      <main className="main">
        {isAdmin ? <Admin /> : <Main />}
      </main>
    </div>
  );
}
