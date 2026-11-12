import { useState } from 'react';
import { createRfq } from '../api';
import { toDateTimeLocalInput } from '../utils/time';

/**
 * Build sensible default timestamps so a user can quickly create and test a new RFQ.
 */
function buildDefaultFormState() {
  const now = new Date();
  const start = new Date(now.getTime());
  const close = new Date(now.getTime() + 15 * 60_000);
  const forcedClose = new Date(now.getTime() + 45 * 60_000);
  const pickup = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const randomSuffix = Math.floor(200 + Math.random() * 799);

  return {
    name: '',
    reference_id: `RFQ-2026-${randomSuffix}`,
    pickup_service_date: pickup.toISOString().slice(0, 10),
    bid_start_time: toDateTimeLocalInput(start),
    bid_close_time: toDateTimeLocalInput(close),
    forced_bid_close_time: toDateTimeLocalInput(forcedClose),
    british_auction_enabled: true,
    trigger_window_minutes: 10,
    extension_duration_minutes: 5,
    extension_trigger_type: 'BID_RECEIVED',
  };
}

/**
 * Create RFQ Page containing schedule fields, validation checks, and British Auction rules.
 */
export default function CreateRfqPage({ onCancel, onCreated }) {
  const [form, setForm] = useState(buildDefaultFormState);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  /**
   * Update a single field in the RFQ creation form state.
   */
  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  /**
   * Validate schedule/config rules client-side and submit the new RFQ to the Express backend.
   */
  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const startMs = Date.parse(form.bid_start_time);
    const closeMs = Date.parse(form.bid_close_time);
    const forcedMs = Date.parse(form.forced_bid_close_time);

    if (!form.name.trim() || !form.reference_id.trim()) {
      setError('RFQ Name and Reference ID are required.');
      return;
    }
    if (Number.isNaN(startMs) || Number.isNaN(closeMs) || Number.isNaN(forcedMs)) {
      setError('Please enter valid Start, Bid Close, and Forced Bid Close date/times.');
      return;
    }
    if (closeMs <= startMs) {
      setError('Bid Close Date & Time must be later than Bid Start Date & Time.');
      return;
    }
    if (forcedMs <= closeMs) {
      setError('Forced Bid Close Date & Time must always be greater than Bid Close Date & Time.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        reference_id: form.reference_id.trim(),
        pickup_service_date: form.pickup_service_date,
        bid_start_time: new Date(startMs).toISOString(),
        bid_close_time: new Date(closeMs).toISOString(),
        forced_bid_close_time: new Date(forcedMs).toISOString(),
        british_auction_enabled: form.british_auction_enabled,
        trigger_window_minutes: Number(form.trigger_window_minutes),
        extension_duration_minutes: Number(form.extension_duration_minutes),
        extension_trigger_type: form.extension_trigger_type,
      };
      const data = await createRfq(payload);
      onCreated(data.item.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Create New RFQ</h1>
          <p className="page-subtitle">
            Configure the RFQ schedule and British Auction automatic extension rules.
          </p>
        </div>
        <button type="button" className="btn" onClick={onCancel}>
          &larr; Back to Auctions
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="card">
          <h2 className="card-title">1. RFQ Schedule & Details</h2>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="rfq-name">RFQ Name *</label>
              <input
                id="rfq-name"
                type="text"
                placeholder="e.g., Sea Freight - Mumbai to Hamburg"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="rfq-ref">Reference ID *</label>
              <input
                id="rfq-ref"
                type="text"
                placeholder="e.g., RFQ-2026-205"
                value={form.reference_id}
                onChange={(e) => updateField('reference_id', e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="pickup-date">Pickup / Service Date *</label>
              <input
                id="pickup-date"
                type="date"
                value={form.pickup_service_date}
                onChange={(e) => updateField('pickup_service_date', e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="start-time">Bid Start Date & Time *</label>
              <input
                id="start-time"
                type="datetime-local"
                value={form.bid_start_time}
                onChange={(e) => updateField('bid_start_time', e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="close-time">Bid Close Date & Time *</label>
              <input
                id="close-time"
                type="datetime-local"
                value={form.bid_close_time}
                onChange={(e) => updateField('bid_close_time', e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="forced-close-time">Forced Bid Close Date & Time *</label>
              <input
                id="forced-close-time"
                type="datetime-local"
                value={form.forced_bid_close_time}
                onChange={(e) => updateField('forced_bid_close_time', e.target.value)}
                required
              />
              <span className="field-hint">
                Rule: Must always be later than Bid Close Date & Time.
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">2. British Auction Configuration</h2>

          <div style={{ marginBottom: '14px' }}>
            <label className="checkbox-inline" style={{ fontSize: '14px' }}>
              <input
                type="checkbox"
                checked={form.british_auction_enabled}
                onChange={(e) => updateField('british_auction_enabled', e.target.checked)}
              />
              Enable British Auction (Automatic Bid-Time Extensions)
            </label>
          </div>

          {form.british_auction_enabled ? (
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="trigger-window">Trigger Window (X Minutes) *</label>
                <input
                  id="trigger-window"
                  type="number"
                  min="1"
                  value={form.trigger_window_minutes}
                  onChange={(e) => updateField('trigger_window_minutes', e.target.value)}
                  required
                />
                <span className="field-hint">
                  Monitor bidding activity during the last X minutes before Bid Close Time.
                </span>
              </div>

              <div className="form-group">
                <label htmlFor="extension-duration">Extension Duration (Y Minutes) *</label>
                <input
                  id="extension-duration"
                  type="number"
                  min="1"
                  value={form.extension_duration_minutes}
                  onChange={(e) => updateField('extension_duration_minutes', e.target.value)}
                  required
                />
                <span className="field-hint">
                  Extend Bid Close Time by Y minutes when triggered (never exceeding Forced Close Time).
                </span>
              </div>

              <div className="form-group full-width">
                <label htmlFor="trigger-type">Extension Trigger Rule *</label>
                <select
                  id="trigger-type"
                  value={form.extension_trigger_type}
                  onChange={(e) => updateField('extension_trigger_type', e.target.value)}
                >
                  <option value="BID_RECEIVED">
                    a) Bid Received in Last X Minutes — Extend if any supplier submits a bid
                  </option>
                  <option value="ANY_RANK_CHANGE">
                    b) Any Supplier Rank Change in Last X Minutes — Extend if any ranking changes
                  </option>
                  <option value="L1_RANK_CHANGE">
                    c) Lowest Bidder (L1) Rank Change in Last X Minutes — Extend only if L1 changes
                  </option>
                </select>
              </div>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              British Auction is unchecked. This RFQ will close strictly at Bid Close Date & Time without extensions.
            </p>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Creating RFQ...' : 'Create RFQ'}
          </button>
        </div>
      </form>
    </div>
  );
}

