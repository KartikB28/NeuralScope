import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// no StrictMode: the 3D world is an imperative singleton; double-mounting in
// dev would create twin scenes and twin sockets.
createRoot(document.getElementById('root')!).render(<App />);
