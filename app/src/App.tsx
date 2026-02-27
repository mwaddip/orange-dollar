import { useState } from 'react';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { Trade } from './components/Trade';
import './styles/header.css';

export function App() {
  const [activeTab, setActiveTab] = useState('Trade');

  return (
    <div className="app">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="main">
        {activeTab === 'Trade' && <Trade />}
        {activeTab === 'Dashboard' && <Dashboard />}
        {activeTab === 'Admin' && (
          <div style={{ padding: '32px 24px' }}>Admin (coming next)</div>
        )}
      </main>
    </div>
  );
}
