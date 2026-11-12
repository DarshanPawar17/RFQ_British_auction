import { useEffect, useState } from 'react';
import { fetchRfqDetails, forceCloseRfq, submitBid } from '../api';
import {
  formatCountdown,
  formatCurrency,
  formatDateOnly,
  formatDateTime,
  statusBadgeClass,
} from '../utils/time';

const QUICK_CARRIERS = [
  'Maersk Line',
  'MSC Shipping',
  'Hapag-Lloyd',
  'DHL Global',
  'CMA CGM',
  'FedEx Freight',
];

/**
 * Return a readable badge label and CSS class for an activity log event type.
 */
function formatEventLabel(eventType) {
  switch (eventType) {
    case 'BID_SUBMITTED':
      return { label: 'Bid Submitted', cls: 'badge-upcoming' };
    case 'TIME_EXTENSION':
      return { label: 'Time Extended', cls: 'badge-info' };
    case 'AUCTION_FORCE_CLOSED':
      return { label: 'Force Closed', cls: 'badge-force-closed' };
    case 'AUCTION_CREATED':
      return { label: 'RFQ Created', cls: 'badge-closed' };
    default:
      return { label: eventType, cls: 'badge-closed' };
  }
}

/**
 * Auction Details Page showing configuration, live countdown, L1/L2 rankings, quote form, and activity log.
 */
export default function AuctionDetailsPage({ rfqId, onBack }) {
  const [auction, setAuction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());

  const [bidTab, setBidTab] = useState('rankings'); // 'rankings' | 'history'
  const [logFilter, setLogFilter] = useState('ALL'); // 'ALL' | 'TIME_EXTENSION' | 'BID_SUBMITTED'

  const [carrierName, setCarrierName] = useState('Maersk Line');
  const [freightCharges, setFreightCharges] = useState('');
  const [originCharges, setOriginCharges] = useState('200');
  const [destinationCharges, setDestinationCharges] = useState('250');
  const [transitDays, setTransitDays] = useState('14');
  const [quoteValidity, setQuoteValidity] = useState(() => {
    const dt = new Date(Date.now() + 20 * 24 * 60 * 60_000);
    return dt.toISOString().slice(0, 10);
  });

  const [submittingBid, setSubmittingBid] = useState(false);
  const [bidError, setBidError] = useState('');
  const [bidFeedback, setBidFeedback] = useState(null);
  const [closingManual, setClosingManual] = useState(false);

  /**
   * Load full details for the selected RFQ from the backend.
   */
  async function loadDetails(showSpinner = false) {
    if (showSpinner) setLoading(true);
    try {
      const data = await fetchRfqDetails(rfqId);
      setAuction(data.item);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDetails(true);
    const pollTimer = setInterval(() => loadDetails(false), 4000);
    return () => clearInterval(pollTimer);
  }, [rfqId]);

  useEffect(() => {
    const tickTimer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tickTimer);
  }, []);

  /**
   * Submit a new or lowered carrier quote and show whether an extension occurred.
   */
  async function handleBidSubmit(e) {
    e.preventDefault();
    setBidError('');
    setBidFeedback(null);

    if (!carrierName.trim()) {
      setBidError('Carrier Name is required.');
      return;
    }

    setSubmittingBid(true);
    try {
      const result = await submitBid(rfqId, {
        carrier_name: carrierName.trim(),
        freight_charges: Number(freightCharges),
        origin_charges: Number(originCharges),
        destination_charges: Number(destinationCharges),
        transit_time_days: Number(transitDays),
        quote_validity_date: quoteValidity,
      });

      setAuction(result.auction);
      setBidFeedback(result.bid_result);
      setFreightCharges('');
    } catch (err) {
      setBidError(err.message);
    } finally {
      setSubmittingBid(false);
    }
  }

  /**
   * Manually force-close an active auction via buyer action.
   */
  async function handleManualForceClose() {
    if (!window.confirm('Force close this auction now? Bidding will stop immediately.')) {
      return;
    }
    setClosingManual(true);
    try {
      const data = await forceCloseRfq(rfqId, 'Manually force-closed by buyer from Auction Details page.');
      setAuction(data.item);
    } catch (err) {
      setError(err.message);
    } finally {
      setClosingManual(false);
    }
  }

  if (loading) {
    return <p className="muted">Loading auction details...</p>;
  }

  if (error || !auction) {
    return (
      <div>
        <button type="button" className="btn" onClick={onBack} style={{ marginBottom: '12px' }}>
          &larr; Back to Auctions
        </button>
        <div className="alert alert-error">{error || 'Auction not found.'}</div>
      </div>
    );
  }

  const totalPreview =
    (Number(freightCharges) || 0) +
    (Number(originCharges) || 0) +
    (Number(destinationCharges) || 0);

  const existingCarrierBid = auction.rankings.find(
    (b) => b.carrier_name.trim().toLowerCase() === carrierName.trim().toLowerCase()
  );

  const filteredLogs = auction.activity_logs.filter(
    (log) => logFilter === 'ALL' || log.event_type === logFilter
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <button type="button" className="btn btn-sm" onClick={onBack} style={{ marginBottom: '8px' }}>
            &larr; Back to Auctions
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h1 className="page-title">{auction.name}</h1>
            <span className={`badge ${statusBadgeClass(auction.status)}`}>{auction.status}</span>
          </div>
          <p className="page-subtitle mono">
            {auction.reference_id} &bull; Pickup / Service Date: {formatDateOnly(auction.pickup_service_date)}
          </p>
        </div>

        {(auction.status === 'Active' || auction.status === 'Upcoming') && (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={handleManualForceClose}
            disabled={closingManual}
          >
            {closingManual ? 'Closing...' : 'Force Close Now'}
          </button>
        )}
      </div>

      {auction.in_trigger_window && (
        <div className="alert alert-warning">
          <strong>Trigger Window Active:</strong> This auction is within the last{' '}
          <strong>{auction.trigger_window_minutes} minutes</strong> before close time. Qualifying bids
          will automatically extend the close time by{' '}
          <strong>{auction.extension_duration_minutes} minutes</strong> (capped at Forced Bid Close Time).
        </div>
      )}

      {/* Auction Schedule & Configuration Card */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <h2 className="card-title" style={{ margin: 0 }}>Auction Configuration & Timeline</h2>
          <span className="muted">
            Auto-refreshes every 4s &bull; Extensions applied: <strong>{auction.extension_count}</strong>
          </span>
        </div>

        <div className="stats-grid">
          <div className="stat-box">
            <div className="stat-label">Time Remaining</div>
            <div className="stat-value" style={{ color: auction.status === 'Active' ? '#166534' : '#374151' }}>
              {auction.status === 'Active'
                ? formatCountdown(auction.current_bid_close_time, nowMs)
                : auction.status === 'Upcoming'
                ? `Starts in ${formatCountdown(auction.bid_start_time, nowMs)}`
                : auction.status}
            </div>
          </div>

          <div className="stat-box">
            <div className="stat-label">Current Bid Close Time</div>
            <div className="stat-value">{formatDateTime(auction.current_bid_close_time)}</div>
            {auction.extension_count > 0 && (
              <div className="muted">Initial: {formatDateTime(auction.initial_bid_close_time)}</div>
            )}
          </div>

          <div className="stat-box">
            <div className="stat-label">Forced Bid Close Time</div>
            <div className="stat-value">{formatDateTime(auction.forced_bid_close_time)}</div>
            <div className="muted">Hard ceiling (never exceeded)</div>
          </div>

          <div className="stat-box">
            <div className="stat-label">Current Lowest Bid (L1)</div>
            <div className="stat-value" style={{ color: '#166534' }}>
              {auction.lowest_bid ? formatCurrency(auction.lowest_bid.total_price) : 'No bids yet'}
            </div>
            {auction.lowest_bid && (
              <div className="muted">{auction.lowest_bid.carrier_name}</div>
            )}
          </div>
        </div>

        <div
          style={{
            marginTop: '14px',
            paddingTop: '12px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '18px',
            fontSize: '13px',
          }}
        >
          <div>
            <strong>Bid Start Time:</strong> {formatDateTime(auction.bid_start_time)}
          </div>
          <div>
            <strong>British Auction:</strong>{' '}
            {auction.british_auction_enabled ? 'Enabled' : 'Disabled'}
          </div>
          {auction.british_auction_enabled && (
            <>
              <div>
                <strong>Trigger Window (X):</strong> {auction.trigger_window_minutes} mins
              </div>
              <div>
                <strong>Extension Duration (Y):</strong> {auction.extension_duration_minutes} mins
              </div>
              <div>
                <strong>Extension Rule:</strong> {auction.extension_trigger_label}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Two-Column Section: Rankings Table + Quote Submission Form */}
      <div className="two-col-layout">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
            <h2 className="card-title" style={{ margin: 0 }}>
              Supplier Bids & Rankings ({auction.rankings.length} Suppliers)
            </h2>
            <div className="filter-tabs">
              <button
                type="button"
                className={`filter-tab ${bidTab === 'rankings' ? 'selected' : ''}`}
                onClick={() => setBidTab('rankings')}
              >
                Live Ranking (L1, L2...)
              </button>
              <button
                type="button"
                className={`filter-tab ${bidTab === 'history' ? 'selected' : ''}`}
                onClick={() => setBidTab('history')}
              >
                All Submissions ({auction.all_bids.length})
              </button>
            </div>
          </div>

          {bidTab === 'rankings' ? (
            auction.rankings.length === 0 ? (
              <p className="muted">No bids submitted yet. Submit the first quote on the right.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Carrier Name</th>
                      <th>Charges Breakdown</th>
                      <th>Total Price</th>
                      <th>Transit & Validity</th>
                      <th>Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auction.rankings.map((bid) => (
                      <tr key={bid.id} className={bid.rank === 1 ? 'row-l1' : ''}>
                        <td>
                          <span className={`badge ${bid.rank === 1 ? 'badge-rank-l1' : 'badge-rank'}`}>
                            {bid.rank_label}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{bid.carrier_name}</td>
                        <td>
                          <div className="muted">
                            Freight: {formatCurrency(bid.freight_charges)}
                          </div>
                          <div className="muted">
                            Origin: {formatCurrency(bid.origin_charges)} &bull; Dest:{' '}
                            {formatCurrency(bid.destination_charges)}
                          </div>
                        </td>
                        <td style={{ fontWeight: 700 }}>{formatCurrency(bid.total_price)}</td>
                        <td>
                          <div>{bid.transit_time_days} days</div>
                          <div className="muted">Valid till {formatDateOnly(bid.quote_validity_date)}</div>
                        </td>
                        <td className="muted">{formatDateTime(bid.submitted_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : auction.all_bids.length === 0 ? (
            <p className="muted">No bid submissions recorded yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Carrier</th>
                    <th>Total Price</th>
                    <th>Freight / Origin / Dest</th>
                    <th>Transit</th>
                    <th>Status</th>
                    <th>Submitted At</th>
                  </tr>
                </thead>
                <tbody>
                  {auction.all_bids.map((bid) => (
                    <tr key={bid.id}>
                      <td style={{ fontWeight: 600 }}>{bid.carrier_name}</td>
                      <td style={{ fontWeight: 700 }}>{formatCurrency(bid.total_price)}</td>
                      <td className="muted">
                        {formatCurrency(bid.freight_charges)} / {formatCurrency(bid.origin_charges)} /{' '}
                        {formatCurrency(bid.destination_charges)}
                      </td>
                      <td>{bid.transit_time_days}d</td>
                      <td>
                        <span className={`badge ${bid.is_latest ? 'badge-active' : 'badge-closed'}`}>
                          {bid.is_latest ? 'Current' : 'Superseded'}
                        </span>
                      </td>
                      <td className="muted">{formatDateTime(bid.submitted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quote Submission Form */}
        <div className="card">
          <h2 className="card-title">Submit Supplier Quote</h2>

          {auction.status !== 'Active' ? (
            <div className="alert alert-info" style={{ marginBottom: 0 }}>
              <strong>Bidding Unavailable:</strong> This auction is currently{' '}
              <strong>{auction.status}</strong>.
              {auction.status === 'Upcoming' && (
                <span> Bidding opens at {formatDateTime(auction.bid_start_time)}.</span>
              )}
            </div>
          ) : (
            <form onSubmit={handleBidSubmit}>
              {bidError && <div className="alert alert-error">{bidError}</div>}

              {bidFeedback && (
                <div className="alert alert-success">
                  <div>
                    <strong>Quote submitted!</strong> Your current rank is{' '}
                    <strong>{bidFeedback.rank_label}</strong> ({formatCurrency(bidFeedback.total_price)}).
                  </div>
                  {bidFeedback.extended ? (
                    <div style={{ marginTop: '4px' }}>
                      <strong>Auction Extended:</strong> {bidFeedback.extension_reason} New close time:{' '}
                      <strong>{formatDateTime(bidFeedback.new_close_time)}</strong>.
                    </div>
                  ) : bidFeedback.extension_blocked_by_forced_close ? (
                    <div style={{ marginTop: '4px' }}>
                      Auction is already at Forced Bid Close Time; no further extension possible.
                    </div>
                  ) : (
                    <div style={{ marginTop: '4px' }}>No time extension triggered by this bid.</div>
                  )}
                </div>
              )}

              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label htmlFor="carrier-name">Carrier / Supplier Name *</label>
                <input
                  id="carrier-name"
                  type="text"
                  value={carrierName}
                  onChange={(e) => setCarrierName(e.target.value)}
                  placeholder="Enter carrier name"
                  required
                />
                <div className="quick-carriers">
                  {QUICK_CARRIERS.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="chip-btn"
                      onClick={() => setCarrierName(name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                {existingCarrierBid && (
                  <span className="field-hint" style={{ color: '#1d4ed8' }}>
                    {existingCarrierBid.carrier_name}&apos;s current bid is{' '}
                    <strong>{formatCurrency(existingCarrierBid.total_price)}</strong> (
                    {existingCarrierBid.rank_label}). Enter a strictly lower total to update.
                  </span>
                )}
              </div>

              <div className="form-grid-3" style={{ marginBottom: '12px' }}>
                <div className="form-group">
                  <label htmlFor="freight">Freight ($) *</label>
                  <input
                    id="freight"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="1800"
                    value={freightCharges}
                    onChange={(e) => setFreightCharges(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="origin">Origin ($) *</label>
                  <input
                    id="origin"
                    type="number"
                    min="0"
                    step="0.01"
                    value={originCharges}
                    onChange={(e) => setOriginCharges(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="dest">Destination ($) *</label>
                  <input
                    id="dest"
                    type="number"
                    min="0"
                    step="0.01"
                    value={destinationCharges}
                    onChange={(e) => setDestinationCharges(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="total-preview">
                <span>Total Quote Price</span>
                <span style={{ fontSize: '17px', color: '#111827' }}>
                  {formatCurrency(totalPreview)}
                </span>
              </div>

              <div className="form-grid" style={{ marginBottom: '14px' }}>
                <div className="form-group">
                  <label htmlFor="transit-days">Transit Time (Days) *</label>
                  <input
                    id="transit-days"
                    type="number"
                    min="1"
                    value={transitDays}
                    onChange={(e) => setTransitDays(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="quote-validity">Validity of Quote *</label>
                  <input
                    id="quote-validity"
                    type="date"
                    value={quoteValidity}
                    onChange={(e) => setQuoteValidity(e.target.value)}
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={submittingBid}
              >
                {submittingBid ? 'Submitting Quote...' : 'Submit Quote'}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Activity Log */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
          <h2 className="card-title" style={{ margin: 0 }}>
            Activity Log (Bids, Extensions & Reasons)
          </h2>
          <div className="filter-tabs">
            <button
              type="button"
              className={`filter-tab ${logFilter === 'ALL' ? 'selected' : ''}`}
              onClick={() => setLogFilter('ALL')}
            >
              All Events ({auction.activity_logs.length})
            </button>
            <button
              type="button"
              className={`filter-tab ${logFilter === 'TIME_EXTENSION' ? 'selected' : ''}`}
              onClick={() => setLogFilter('TIME_EXTENSION')}
            >
              Time Extensions
            </button>
            <button
              type="button"
              className={`filter-tab ${logFilter === 'BID_SUBMITTED' ? 'selected' : ''}`}
              onClick={() => setLogFilter('BID_SUBMITTED')}
            >
              Bid Submissions
            </button>
          </div>
        </div>

        {filteredLogs.length === 0 ? (
          <p className="muted">No matching activity events logged yet.</p>
        ) : (
          <div className="log-list">
            {filteredLogs.map((log) => {
              const badge = formatEventLabel(log.event_type);
              return (
                <div key={log.id} className={`log-item log-${log.event_type}`}>
                  <div className="log-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className={`badge ${badge.cls}`}>{badge.label}</span>
                      {log.carrier_name && <strong>{log.carrier_name}</strong>}
                      {log.bid_total_price !== null && log.bid_total_price !== undefined && (
                        <span className="mono">{formatCurrency(log.bid_total_price)}</span>
                      )}
                    </div>
                    <span className="muted">{formatDateTime(log.created_at)}</span>
                  </div>
                  <div style={{ fontSize: '14px' }}>{log.reason}</div>
                  {log.old_close_time && log.new_close_time && (
                    <div className="muted" style={{ marginTop: '4px' }}>
                      Close Time: <strong>{formatDateTime(log.old_close_time)}</strong> &rarr;{' '}
                      <strong>{formatDateTime(log.new_close_time)}</strong>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

