import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Inventory from './pages/Inventory';
import Pricing from './pages/Pricing';
import PnL from './pages/PnL';
import Marketing from './pages/Marketing';
import Payments from './pages/Payments';
import Targets from './pages/Targets';
import Orders from './pages/Orders';

const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: '◈' },
  { to: '/products', label: 'Products', icon: '▦' },
  { to: '/inventory', label: 'Inventory', icon: '▤' },
  { to: '/pricing', label: 'Pricing', icon: '₹' },
  { to: '/pnl', label: 'P&L', icon: '≣' },
  { to: '/marketing', label: 'Marketing', icon: '◉' },
  { to: '/payments', label: 'Payments', icon: '◍' },
  { to: '/orders', label: 'Orders', icon: '☰' },
  { to: '/targets', label: 'Targets', icon: '◎' },
];

export default function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">TB</div>
          <div>
            <div className="brand-name">Tash Bags</div>
            <div className="brand-sub">Business OS</div>
          </div>
        </div>
        <nav>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/products" element={<Products />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/pnl" element={<PnL />} />
          <Route path="/marketing" element={<Marketing />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/targets" element={<Targets />} />
        </Routes>
      </main>
    </div>
  );
}