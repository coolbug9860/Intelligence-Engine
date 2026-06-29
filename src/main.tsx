import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import OpportunityDetail from './pages/OpportunityDetail.tsx';
import HowItWorks from './pages/HowItWorks.tsx';
import './index.css';

const page = new URLSearchParams(window.location.search).get('page');

function Root() {
  if (page === 'opportunity') return <OpportunityDetail />;
  if (page === 'how-it-works') return <HowItWorks />;
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
