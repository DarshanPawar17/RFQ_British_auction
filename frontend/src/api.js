const API_BASE = '/api';

/**
 * Send an HTTP request to the Express backend and throw a readable Error on failure.
 */
async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    let message = 'Something went wrong.';
    if (typeof data.detail === 'string') {
      message = data.detail;
    } else if (Array.isArray(data.detail) && data.detail.length > 0) {
      message = data.detail.map((err) => err.msg || JSON.stringify(err)).join(', ');
    }
    throw new Error(message);
  }
  return data;
}

/**
 * Fetch the list of RFQs, optionally filtered by status or British Auction flag.
 */
export function fetchRfqs({ status = 'All', britishOnly = false } = {}) {
  const params = new URLSearchParams();
  if (status && status !== 'All') {
    params.set('status', status);
  }
  if (britishOnly) {
    params.set('british_only', 'true');
  }
  const query = params.toString();
  return request(`/rfqs${query ? `?${query}` : ''}`);
}

/**
 * Fetch full details, ranked bids, and activity logs for a single RFQ by ID.
 */
export function fetchRfqDetails(rfqId) {
  return request(`/rfqs/${rfqId}`);
}

/**
 * Create a new RFQ with optional British Auction extension rules.
 */
export function createRfq(payload) {
  return request('/rfqs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Submit a supplier/carrier quote on an active RFQ.
 */
export function submitBid(rfqId, payload) {
  return request(`/rfqs/${rfqId}/bids`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Manually force-close an auction immediately.
 */
export function forceCloseRfq(rfqId, reason = '') {
  return request(`/rfqs/${rfqId}/force-close`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/**
 * Reset the database back to fresh relative sample auctions for testing.
 */
export function resetDemoData() {
  return request('/demo/reset', {
    method: 'POST',
  });
}

