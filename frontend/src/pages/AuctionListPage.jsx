import { useEffect, useState } from 'react';
import { fetchRfqs, resetDemoData } from '../api';
import {
  formatCountdown,
  formatCurrency,
  formatDateOnly,
  formatDateTime,
  statusBadgeClass,
} from '../utils/time';

const STATUS_FILTERS = ['All', 'Active', 'Closed', 'Force Closed', 'Upcoming'];

/**
 * Auction Listing Page displaying all RFQs with lowest bids, close times, and live status.
 */
export default function AuctionListPage({ onSelectRfq, onNavigateCreate }) {
  const [items, setItems] = useState([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [britishOnly, setBritishOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resetting, setResetting] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  /**
   * Load the latest RFQ summaries from the Express backend.
   */
  async function loadRfqs(showSpinner = false) {
    if (showSpinner) setLoading(true);
    try {
      const data = await fetchRfqs({ status: statusFilter, britishOnly });
      setItems(data.items || []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRfqs(true);
    const pollTimer = setInterval(() => loadRfqs(false), 5000);
    return () => clearInterval(pollTimer);
  }, [statusFilter, britishOnly]);

  useEffect(() => {
    const tickTimer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tickTimer);
  }, []);

  /**
   * Reset sample demo auctions back to fresh timestamps for easy testing.
   */
  async function handleResetDemo() {
    if (!window.confirm('Reset all auctions back to the default sample demo data?')) {
      return;
    }
    setResetting(true);
    try {
      await resetDemoData();
      await loadRfqs(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">British Auctions (RFQ Listing)</h1>
          <p className="page-subtitle">
            Monitor active reverse auctions, lowest supplier bids, automatic extensions, and forced close times.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn"
            onClick={handleResetDemo}
            disabled={resetting}
          >
            {resetting ? 'Resetting...' : 'Reset Demo Data'}
          </button>
          <button type="button" className="btn btn-primary" onClick={onNavigateCreate}>
            + Create RFQ
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="toolbar">
          <div className="filter-tabs">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status}
                type="button"
                className={`filter-tab ${statusFilter === status ? 'selected' : ''}`}
                onClick={() => setStatusFilter(status)}
              >
                {status}
              </button>
            ))}
          </div>

          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={britishOnly}
              onChange={(e) => setBritishOnly(e.target.checked)}
            />
            Show British Auctions only
          </label>
        </div>

        {loading ? (
          <p className="muted">Loading auctions...</p>
        ) : items.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <p style={{ margin: '0 0 10px' }}>No auctions found for the selected filter.</p>
            <button type="button" className="btn btn-primary" onClick={onNavigateCreate}>
              Create First RFQ
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>RFQ Name / ID</th>
                  <th>Current Lowest Bid</th>
                  <th>Current Bid Close Time</th>
                  <th>Forced Close Time</th>
                  <th>Auction Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((rfq) => (
                  <tr key={rfq.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        <a
                          href={`#rfq-${rfq.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            onSelectRfq(rfq.id);
                          }}
                        >
                          {rfq.name}
                        </a>
                      </div>
                      <div className="muted mono">
                        {rfq.reference_id} &bull; Pickup: {formatDateOnly(rfq.pickup_service_date)}
                      </div>
                      {rfq.british_auction_enabled ? (
                        <div className="muted">
                          British Auction (X={rfq.trigger_window_minutes}m, Y={rfq.extension_duration_minutes}m)
                        </div>
                      ) : (
                        <div className="muted">Standard RFQ (No Auto-Extension)</div>
                      )}
                    </td>

                    <td>
                      {rfq.lowest_bid ? (
                        <div>
                          <div style={{ fontWeight: 700, color: '#166534' }}>
                            {formatCurrency(rfq.lowest_bid.total_price)}
                          </div>
                          <div className="muted">
                            L1: {rfq.lowest_bid.carrier_name} ({rfq.supplier_count} suppliers)
                          </div>
                        </div>
                      ) : (
                        <span className="muted">No bids yet</span>
                      )}
                    </td>

                    <td>
                      <div>{formatDateTime(rfq.current_bid_close_time)}</div>
                      {rfq.status === 'Active' && (
                        <div className="muted">
                          Ends in <strong>{formatCountdown(rfq.current_bid_close_time, nowMs)}</strong>
                          {rfq.in_trigger_window && (
                            <span className="badge badge-info" style={{ marginLeft: '6px' }}>
                              In Trigger Window
                            </span>
                          )}
                        </div>
                      )}
                      {rfq.extension_count > 0 && (
                        <div className="muted" style={{ color: '#92400e' }}>
                          Extended {rfq.extension_count} time{rfq.extension_count > 1 ? 's' : ''}
                        </div>
                      )}
                    </td>

                    <td>{formatDateTime(rfq.forced_bid_close_time)}</td>

                    <td>
                      <span className={`badge ${statusBadgeClass(rfq.status)}`}>{rfq.status}</span>
                    </td>

                    <td>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onSelectRfq(rfq.id)}
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

