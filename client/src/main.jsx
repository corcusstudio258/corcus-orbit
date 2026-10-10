import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster position="bottom-right" toastOptions={{ style: { background: '#1B2453', color: '#E8ECFF', border: '1px solid rgba(150,168,255,.2)', borderRadius: 14, fontSize: 14 } }} />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
