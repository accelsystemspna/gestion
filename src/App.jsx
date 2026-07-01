import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login/Login'
import Dashboard from './pages/Home/Home'
import Productos from './pages/Productos/Productos'
import Materiales from './pages/Materiales/Materiales'
import Presupuesto from './pages/Presupuesto/Presupuesto'
import Configuracion from './pages/Configuracion/Configuracion'
import Clientes from './pages/Clientes/Clientes'
import Ventas from './pages/Ventas/Ventas'
import Facturas from './pages/Facturas/Facturas'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Navigate to="/ventas" replace />} />
            <Route path="/home" element={<Navigate to="/ventas" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/productos" element={<Productos />} />
            <Route path="/materiales" element={<Materiales />} />
            <Route path="/presupuesto" element={<Presupuesto />} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/ventas" element={<Ventas />} />
            <Route path="/facturas" element={<Facturas />} />
            <Route path="/configuracion" element={<Configuracion />} />
          </Route>
          <Route path="*" element={<Navigate to="/ventas" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
