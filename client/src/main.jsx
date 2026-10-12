import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/figtree';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster position="bottom-right" toastOptions={{ style: { background: '#0F1535', color: '#FFFFFF', borderRadius: 14, fontSize: 14, padding: '10px 14px' }, success: { iconTheme: { primary: '#FFC21A', secondary: '#0F1535' } } }} />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
