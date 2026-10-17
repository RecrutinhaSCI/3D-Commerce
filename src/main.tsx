import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import { installImageFallback } from './utils/imageFallback';

installImageFallback();

// Depois de um deploy, uma aba antiga pede chunks (Orders-xxxx.js) que não
// existem mais e a página quebra. Recarrega uma vez para pegar o build novo;
// a trava de 10s evita loop se o erro for outro (ex.: sem internet).
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'chunk-reload-at';
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY) ?? 0);
  } catch {
    // sessionStorage indisponível (aba privada) — segue sem trava.
  }
  if (Date.now() - last < 10_000) return;
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // idem
  }
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
