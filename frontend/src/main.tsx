import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
// Fontes servidas do próprio bundle, não de CDN: o PDV precisa abrir igual numa
// loja sem internet. Outfit é a voz da interface; JetBrains Mono é o algarismo
// de largura fixa que faz coluna de dinheiro alinhar.
import '@fontsource-variable/outfit';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
