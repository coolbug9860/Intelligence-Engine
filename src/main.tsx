import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import OpportunityDetail from './pages/OpportunityDetail.tsx';
import './index.css';

const isOpportunityPage = new URLSearchParams(window.location.search).get('page') === 'opportunity';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isOpportunityPage ? <OpportunityDetail /> : <App />}
  </StrictMode>,
);
