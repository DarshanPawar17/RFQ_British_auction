import { useEffect, useState } from 'react';
import AuctionDetailsPage from './pages/AuctionDetailsPage';
import AuctionListPage from './pages/AuctionListPage';
import CreateRfqPage from './pages/CreateRfqPage';

/**
 * Parse window.location.hash into a simple page route object.
 */
function parseHashRoute() {
  const hash = window.location.hash || '#/';
  if (hash === '#/create') {
    return { page: 'create', rfqId: null };
  }
  const match = hash.match(/^#\/rfq\/(\d+)$/);
  if (match) {
    return { page: 'details', rfqId: Number(match[1]) };
  }
  return { page: 'list', rfqId: null };
}

/**
 * Top-level application component providing the navigation bar and page switching.
 */
export default function App() {
  const [route, setRoute] = useState(parseHashRoute);

  useEffect(() => {
    /**
     * Update React route state whenever the browser URL hash changes.
     */
    function handleHashChange() {
      setRoute(parseHashRoute());
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  /**
   * Navigate to a new hash route cleanly.
   */
  function navigate(hash) {
    window.location.hash = hash;
  }

  return (
    <div>
      <header className="navbar">
        <div className="navbar-inner">
          <div className="brand" onClick={() => navigate('#/')}>
            RFQ British Auction System
          </div>
          <nav className="nav-links">
            <button
              type="button"
              className={`nav-btn ${route.page === 'list' ? 'active' : ''}`}
              onClick={() => navigate('#/')}
            >
              Auctions
            </button>
            <button
              type="button"
              className={`nav-btn ${route.page === 'create' ? 'active' : ''}`}
              onClick={() => navigate('#/create')}
            >
              + Create RFQ
            </button>
          </nav>
        </div>
      </header>

      <main className="container">
        {route.page === 'list' && (
          <AuctionListPage
            onSelectRfq={(id) => navigate(`#/rfq/${id}`)}
            onNavigateCreate={() => navigate('#/create')}
          />
        )}

        {route.page === 'create' && (
          <CreateRfqPage
            onCancel={() => navigate('#/')}
            onCreated={(newId) => navigate(`#/rfq/${newId}`)}
          />
        )}

        {route.page === 'details' && route.rfqId && (
          <AuctionDetailsPage
            rfqId={route.rfqId}
            onBack={() => navigate('#/')}
          />
        )}
      </main>
    </div>
  );
}

