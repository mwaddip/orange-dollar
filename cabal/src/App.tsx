import { Header } from './components/Header';
import { Admin } from './components/Admin';
import './styles/app.css';
import './styles/header.css';

export function App() {
  return (
    <div className="app">
      <Header />
      <main className="main">
        <Admin />
      </main>
    </div>
  );
}
