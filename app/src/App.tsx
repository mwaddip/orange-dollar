import { useState } from 'react';
import { Header } from './components/Header';
import './styles/header.css';

export function App() {
  const [activeTab, setActiveTab] = useState('Trade');

  return (
    <div className="app">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="main">
        {activeTab === 'Trade' && (
          <div style={{ padding: '32px 24px' }}>Trade (coming next)</div>
        )}
        {activeTab === 'Dashboard' && (
          <div style={{ padding: '32px 24px' }}>Dashboard (coming next)</div>
        )}
        {activeTab === 'Admin' && (
          <div style={{ padding: '32px 24px' }}>Admin (coming next)</div>
        )}
      </main>
    </div>
  );
}
