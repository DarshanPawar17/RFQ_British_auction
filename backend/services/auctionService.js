const EXTENSION_TRIGGERS = ['BID_RECEIVED', 'ANY_RANK_CHANGE', 'L1_RANK_CHANGE'];

const TRIGGER_LABELS = {
  BID_RECEIVED: 'Bid Received in Last X Minutes',
  ANY_RANK_CHANGE: 'Any Supplier Rank Change in Last X Minutes',
  L1_RANK_CHANGE: 'Lowest Bidder (L1) Rank Change in Last X Minutes',
};

// Custom error class that stores an HTTP status code and a user-friendly message
class AppError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

// Validate a date/time string and return it as a standard UTC ISO string
function parseIsoTime(value, fieldLabel) {
  if (!value || typeof value !== 'string') {
    throw new AppError(400, `${fieldLabel} is required.`);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new AppError(400, `${fieldLabel} must be a valid date/time.`);
  }
  return new Date(ms).toISOString();
}

// Validate a YYYY-MM-DD date string and return it trimmed
function parseDateOnly(value, fieldLabel) {
  if (!value || typeof value !== 'string') {
    throw new AppError(400, `${fieldLabel} is required.`);
  }
  const trimmed = value.trim().slice(0, 10);
  if (Number.isNaN(Date.parse(trimmed))) {
    throw new AppError(400, `${fieldLabel} must be a valid date.`);
  }
  return trimmed;
}

// Validate that a field is a whole number >= 1 (used for minutes and transit days)
function parsePositiveInt(value, fieldLabel) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1) {
    throw new AppError(400, `${fieldLabel} must be an integer greater than or equal to 1.`);
  }
  return num;
}

// Validate that a charge field is a number >= 0 and round to 2 decimals
function parseCharge(value, fieldLabel) {
  if (value === '' || value === null || value === undefined) {
    throw new AppError(400, `${fieldLabel} is required.`);
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new AppError(400, `${fieldLabel} must be a non-negative number.`);
  }
  return Math.round(num * 100) / 100;
}

// Figure out whether an RFQ is Upcoming, Active, Closed, or Force Closed right now
function getAuctionStatus(rfq, now = new Date()) {
  if (Boolean(rfq.manual_force_closed)) {
    return 'Force Closed';
  }

  const nowMs = now.getTime();
  const startMs = Date.parse(rfq.bid_start_time);
  const currentCloseMs = Date.parse(rfq.current_bid_close_time);
  const forcedCloseMs = Date.parse(rfq.forced_bid_close_time);

  if (nowMs < startMs) {
    return 'Upcoming';
  }

  if (nowMs < currentCloseMs && nowMs < forcedCloseMs) {
    return 'Active';
  }

  // If extensions pushed close time all the way to Forced Close Time, mark as Force Closed
  if (Boolean(rfq.british_auction_enabled) && currentCloseMs >= forcedCloseMs) {
    return 'Force Closed';
  }

  return 'Closed';
}

// Check if the current time is inside the last X minutes before bid close time
function isInTriggerWindow(rfq, now = new Date()) {
  if (!Boolean(rfq.british_auction_enabled)) {
    return false;
  }
  if (getAuctionStatus(rfq, now) !== 'Active') {
    return false;
  }

  const nowMs = now.getTime();
  const currentCloseMs = Date.parse(rfq.current_bid_close_time);
  const windowStartMs = currentCloseMs - rfq.trigger_window_minutes * 60000;

  return nowMs >= windowStartMs && nowMs < currentCloseMs;
}

// Sort active supplier bids from lowest price to highest and attach L1, L2, L3 labels
function computeRankings(activeBids) {
  const sorted = [...activeBids].sort((a, b) => {
    if (a.total_price !== b.total_price) {
      return a.total_price - b.total_price;
    }
    const timeDiff = Date.parse(a.submitted_at) - Date.parse(b.submitted_at);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return a.id - b.id;
  });

  const ranked = [];
  for (let i = 0; i < sorted.length; i++) {
    ranked.push({
      ...sorted[i],
      rank: i + 1,
      rank_label: `L${i + 1}`,
    });
  }
  return ranked;
}

// Check if any existing supplier changed rank position or if the first bid just arrived
function didAnyRankChange(oldRankings, newRankings) {
  if (oldRankings.length === 0 && newRankings.length > 0) {
    return true;
  }

  const oldRankMap = {};
  for (let i = 0; i < oldRankings.length; i++) {
    const key = oldRankings[i].carrier_name.trim().toLowerCase();
    oldRankMap[key] = oldRankings[i].rank;
  }

  const newRankMap = {};
  for (let i = 0; i < newRankings.length; i++) {
    const key = newRankings[i].carrier_name.trim().toLowerCase();
    newRankMap[key] = newRankings[i].rank;
  }

  const carriers = Object.keys(oldRankMap);
  for (let i = 0; i < carriers.length; i++) {
    const carrier = carriers[i];
    if (newRankMap[carrier] !== oldRankMap[carrier]) {
      return true;
    }
  }

  return false;
}

// Add live computed fields (status, lowest_bid, supplier_count) to a raw RFQ row
function enrichRfqSummary(db, rfq, now = new Date()) {
  const activeBids = db
    .prepare('SELECT * FROM bids WHERE rfq_id = ? AND is_latest = 1')
    .all(rfq.id);
  const rankings = computeRankings(activeBids);
  const lowest = rankings.length > 0 ? rankings[0] : null;

  const totalRow = db
    .prepare('SELECT COUNT(*) AS total FROM bids WHERE rfq_id = ?')
    .get(rfq.id);

  return {
    ...rfq,
    british_auction_enabled: Boolean(rfq.british_auction_enabled),
    manual_force_closed: Boolean(rfq.manual_force_closed),
    status: getAuctionStatus(rfq, now),
    in_trigger_window: isInTriggerWindow(rfq, now),
    extension_trigger_label: TRIGGER_LABELS[rfq.extension_trigger_type] || rfq.extension_trigger_type,
    lowest_bid: lowest
      ? {
          total_price: lowest.total_price,
          carrier_name: lowest.carrier_name,
          submitted_at: lowest.submitted_at,
        }
      : null,
    supplier_count: rankings.length,
    total_bid_submissions: totalRow.total,
  };
}

// Get all RFQs sorted newest-first, with optional status and British-only filters
function listRfqs(db, options = {}, now = new Date()) {
  const statusFilter = options.statusFilter;
  const britishOnly = Boolean(options.britishOnly);

  const rows = db.prepare('SELECT * FROM rfqs ORDER BY created_at DESC, id DESC').all();
  const result = [];

  for (let i = 0; i < rows.length; i++) {
    const item = enrichRfqSummary(db, rows[i], now);
    if (britishOnly && !item.british_auction_enabled) {
      continue;
    }
    if (statusFilter && statusFilter !== 'All' && item.status !== statusFilter) {
      continue;
    }
    result.push(item);
  }

  return result;
}

// Get full details for a single RFQ including rankings, all bids, and activity log
function getRfqDetails(db, rfqId, now = new Date()) {
  const rfq = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(rfqId);
  if (!rfq) {
    throw new AppError(404, 'RFQ not found.');
  }

  const activeBids = db
    .prepare('SELECT * FROM bids WHERE rfq_id = ? AND is_latest = 1')
    .all(rfqId);
  const rankings = computeRankings(activeBids);

  const allBids = db
    .prepare('SELECT * FROM bids WHERE rfq_id = ? ORDER BY submitted_at DESC, id DESC')
    .all(rfqId);

  const activityLogs = db
    .prepare('SELECT * FROM auction_activity_logs WHERE rfq_id = ? ORDER BY created_at DESC, id DESC')
    .all(rfqId);

  return {
    ...enrichRfqSummary(db, rfq, now),
    rankings,
    all_bids: allBids,
    activity_logs: activityLogs,
  };
}

// Validate RFQ inputs and save a new RFQ plus its creation log in SQLite
function createRfq(db, payload, now = new Date()) {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const referenceId = typeof payload.reference_id === 'string' ? payload.reference_id.trim() : '';

  if (!name) {
    throw new AppError(400, 'RFQ Name is required.');
  }
  if (!referenceId) {
    throw new AppError(400, 'Reference ID is required.');
  }

  const pickupDate = parseDateOnly(payload.pickup_service_date, 'Pickup / Service Date');
  const bidStartIso = parseIsoTime(payload.bid_start_time, 'Bid Start Date & Time');
  const bidCloseIso = parseIsoTime(payload.bid_close_time, 'Bid Close Date & Time');
  const forcedCloseIso = parseIsoTime(payload.forced_bid_close_time, 'Forced Bid Close Date & Time');

  if (Date.parse(bidCloseIso) <= Date.parse(bidStartIso)) {
    throw new AppError(400, 'Bid Close Time must be later than Bid Start Time.');
  }

  if (Date.parse(forcedCloseIso) <= Date.parse(bidCloseIso)) {
    throw new AppError(400, 'Forced Bid Close Time must always be greater than Bid Close Time.');
  }

  const britishEnabled = payload.british_auction_enabled !== false;
  let triggerWindow = 10;
  let extensionDuration = 5;
  let triggerType = 'BID_RECEIVED';

  if (britishEnabled) {
    triggerWindow = parsePositiveInt(payload.trigger_window_minutes, 'Trigger Window (X Minutes)');
    extensionDuration = parsePositiveInt(payload.extension_duration_minutes, 'Extension Duration (Y Minutes)');
    triggerType = payload.extension_trigger_type;
    if (!EXTENSION_TRIGGERS.includes(triggerType)) {
      throw new AppError(400, 'Invalid Extension Trigger Type.');
    }
  }

  const existingRef = db.prepare('SELECT id FROM rfqs WHERE reference_id = ?').get(referenceId);
  if (existingRef) {
    throw new AppError(409, `Reference ID "${referenceId}" already exists.`);
  }

  const nowIso = now.toISOString();

  const insertTransaction = db.transaction(() => {
    const res = db
      .prepare(
        `
      INSERT INTO rfqs (
        reference_id, name, pickup_service_date,
        bid_start_time, initial_bid_close_time, current_bid_close_time, forced_bid_close_time,
        british_auction_enabled, trigger_window_minutes, extension_duration_minutes, extension_trigger_type,
        manual_force_closed, extension_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
    `
      )
      .run(
        referenceId,
        name,
        pickupDate,
        bidStartIso,
        bidCloseIso,
        bidCloseIso,
        forcedCloseIso,
        britishEnabled ? 1 : 0,
        triggerWindow,
        extensionDuration,
        triggerType,
        nowIso
      );

    const rfqId = res.lastInsertRowid;
    const reason = britishEnabled
      ? `RFQ created with British Auction enabled (Trigger: ${TRIGGER_LABELS[triggerType]}, X=${triggerWindow}m, Y=${extensionDuration}m).`
      : 'RFQ created as Standard RFQ (British Auction auto-extension disabled).';

    db.prepare(
      `
      INSERT INTO auction_activity_logs (rfq_id, event_type, reason, created_at)
      VALUES (?, 'AUCTION_CREATED', ?, ?)
    `
    ).run(rfqId, reason, nowIso);

    return rfqId;
  });

  const createdId = insertTransaction();
  return getRfqDetails(db, createdId, now);
}

// Submit a carrier quote, update rankings, and extend close time if British Auction rules trigger
function submitBid(db, rfqId, payload, now = new Date()) {
  const carrierName = typeof payload.carrier_name === 'string' ? payload.carrier_name.trim() : '';
  if (!carrierName) {
    throw new AppError(400, 'Carrier Name is required.');
  }

  const freight = parseCharge(payload.freight_charges, 'Freight charges');
  const origin = parseCharge(payload.origin_charges, 'Origin charges');
  const destination = parseCharge(payload.destination_charges, 'Destination charges');
  const totalPrice = Math.round((freight + origin + destination) * 100) / 100;

  if (totalPrice <= 0) {
    throw new AppError(400, 'Total quote price must be greater than 0.');
  }

  const transitDays = parsePositiveInt(payload.transit_time_days, 'Transit Time (Days)');
  const quoteValidity = parseDateOnly(payload.quote_validity_date, 'Validity of Quote');
  const nowIso = now.toISOString();

  const bidTransaction = db.transaction(() => {
    const rfq = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(rfqId);
    if (!rfq) {
      throw new AppError(404, 'RFQ not found.');
    }

    const status = getAuctionStatus(rfq, now);
    if (status === 'Upcoming') {
      throw new AppError(400, 'Auction has not started yet. Bidding opens at Bid Start Time.');
    }
    if (status !== 'Active') {
      throw new AppError(400, `Auction is ${status}. No further bids can be accepted.`);
    }

    const oldActiveBids = db
      .prepare('SELECT * FROM bids WHERE rfq_id = ? AND is_latest = 1')
      .all(rfqId);
    const oldRankings = computeRankings(oldActiveBids);

    const normalizedCarrier = carrierName.toLowerCase();
    let prevBid = null;
    for (let i = 0; i < oldActiveBids.length; i++) {
      if (oldActiveBids[i].carrier_name.trim().toLowerCase() === normalizedCarrier) {
        prevBid = oldActiveBids[i];
        break;
      }
    }

    if (prevBid && totalPrice >= prevBid.total_price) {
      throw new AppError(
        400,
        `New total bid ($${totalPrice.toLocaleString()}) must be strictly lower than ${prevBid.carrier_name}'s previous bid ($${prevBid.total_price.toLocaleString()}).`
      );
    }

    if (prevBid) {
      db.prepare('UPDATE bids SET is_latest = 0 WHERE id = ?').run(prevBid.id);
    }

    const insertRes = db
      .prepare(
        `
      INSERT INTO bids (
        rfq_id, carrier_name, freight_charges, origin_charges, destination_charges,
        total_price, transit_time_days, quote_validity_date, is_latest, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `
      )
      .run(
        rfqId,
        carrierName,
        freight,
        origin,
        destination,
        totalPrice,
        transitDays,
        quoteValidity,
        nowIso
      );

    const newBidId = insertRes.lastInsertRowid;

    const newActiveBids = db
      .prepare('SELECT * FROM bids WHERE rfq_id = ? AND is_latest = 1')
      .all(rfqId);
    const newRankings = computeRankings(newActiveBids);

    let myRank = null;
    for (let i = 0; i < newRankings.length; i++) {
      if (newRankings[i].carrier_name.trim().toLowerCase() === normalizedCarrier) {
        myRank = newRankings[i];
        break;
      }
    }

    const oldL1 = oldRankings.length > 0 ? oldRankings[0].carrier_name : null;
    const newL1 = newRankings.length > 0 ? newRankings[0].carrier_name : null;

    const bidLogReason = prevBid
      ? `${carrierName} lowered bid from $${prevBid.total_price.toLocaleString()} to $${totalPrice.toLocaleString()} (Current Rank: ${myRank.rank_label}).`
      : `${carrierName} submitted a quote of $${totalPrice.toLocaleString()} (Current Rank: ${myRank.rank_label}).`;

    db.prepare(
      `
      INSERT INTO auction_activity_logs (
        rfq_id, event_type, carrier_name, bid_id, bid_total_price, reason, created_at
      ) VALUES (?, 'BID_SUBMITTED', ?, ?, ?, ?, ?)
    `
    ).run(rfqId, carrierName, newBidId, totalPrice, bidLogReason, nowIso);

    let extended = false;
    let cappedAtForcedClose = false;
    let extensionBlockedByForcedClose = false;
    let extensionReason = null;
    let newCloseIso = rfq.current_bid_close_time;

    if (rfq.british_auction_enabled === 1 && isInTriggerWindow(rfq, now)) {
      let triggerMatched = false;
      const xMins = rfq.trigger_window_minutes;
      const yMins = rfq.extension_duration_minutes;

      if (rfq.extension_trigger_type === 'BID_RECEIVED') {
        triggerMatched = true;
        extensionReason = `Bid received from ${carrierName} within last ${xMins} minutes of close time`;
      } else if (rfq.extension_trigger_type === 'ANY_RANK_CHANGE') {
        triggerMatched = didAnyRankChange(oldRankings, newRankings);
        if (triggerMatched) {
          extensionReason = `Supplier rankings changed after ${carrierName}'s bid within last ${xMins} minutes`;
        }
      } else if (rfq.extension_trigger_type === 'L1_RANK_CHANGE') {
        const oldL1Norm = oldL1 ? oldL1.trim().toLowerCase() : null;
        const newL1Norm = newL1 ? newL1.trim().toLowerCase() : null;
        triggerMatched = oldL1Norm !== newL1Norm;
        if (triggerMatched) {
          extensionReason = oldL1
            ? `Lowest bidder (L1) changed from ${oldL1} to ${newL1} within last ${xMins} minutes`
            : `${newL1} became the first L1 bidder within last ${xMins} minutes`;
        }
      }

      if (triggerMatched) {
        const currentCloseMs = Date.parse(rfq.current_bid_close_time);
        const forcedCloseMs = Date.parse(rfq.forced_bid_close_time);

        if (currentCloseMs < forcedCloseMs) {
          const proposedMs = currentCloseMs + yMins * 60000;
          cappedAtForcedClose = proposedMs > forcedCloseMs;
          const nextCloseMs = Math.min(proposedMs, forcedCloseMs);
          newCloseIso = new Date(nextCloseMs).toISOString();

          const fullReason = cappedAtForcedClose
            ? `${extensionReason}; extended and capped at Forced Bid Close Time.`
            : `${extensionReason}; extended by ${yMins} minutes.`;

          db.prepare(
            `
            UPDATE rfqs
            SET current_bid_close_time = ?, extension_count = extension_count + 1
            WHERE id = ?
          `
          ).run(newCloseIso, rfqId);

          db.prepare(
            `
            INSERT INTO auction_activity_logs (
              rfq_id, event_type, carrier_name, bid_id, bid_total_price,
              old_close_time, new_close_time, reason, created_at
            ) VALUES (?, 'TIME_EXTENSION', ?, ?, ?, ?, ?, ?, ?)
          `
          ).run(
            rfqId,
            carrierName,
            newBidId,
            totalPrice,
            rfq.current_bid_close_time,
            newCloseIso,
            fullReason,
            nowIso
          );

          extended = true;
          extensionReason = fullReason;
        } else {
          extensionBlockedByForcedClose = true;
        }
      }
    }

    return {
      bid_id: newBidId,
      rank_label: myRank.rank_label,
      total_price: totalPrice,
      extended,
      capped_at_forced_close: cappedAtForcedClose,
      extension_blocked_by_forced_close: extensionBlockedByForcedClose,
      extension_reason: extensionReason,
      new_close_time: newCloseIso,
    };
  });

  const bidResult = bidTransaction();
  return {
    bid_result: bidResult,
    auction: getRfqDetails(db, rfqId, now),
  };
}

// Manually force-close an Active or Upcoming auction and log the reason
function forceCloseRfq(db, rfqId, reasonText, now = new Date()) {
  const nowIso = now.toISOString();
  const reason =
    typeof reasonText === 'string' && reasonText.trim()
      ? reasonText.trim()
      : 'Auction manually force-closed by buyer.';

  const closeTransaction = db.transaction(() => {
    const rfq = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(rfqId);
    if (!rfq) {
      throw new AppError(404, 'RFQ not found.');
    }

    const currentStatus = getAuctionStatus(rfq, now);
    if (currentStatus === 'Closed' || currentStatus === 'Force Closed') {
      throw new AppError(400, `Auction is already ${currentStatus}.`);
    }

    db.prepare('UPDATE rfqs SET manual_force_closed = 1 WHERE id = ?').run(rfqId);
    db.prepare(
      `
      INSERT INTO auction_activity_logs (rfq_id, event_type, reason, created_at)
      VALUES (?, 'AUCTION_FORCE_CLOSED', ?, ?)
    `
    ).run(rfqId, reason, nowIso);
  });

  closeTransaction();
  return getRfqDetails(db, rfqId, now);
}

module.exports = {
  EXTENSION_TRIGGERS,
  TRIGGER_LABELS,
  AppError,
  getAuctionStatus,
  isInTriggerWindow,
  computeRankings,
  didAnyRankChange,
  listRfqs,
  getRfqDetails,
  createRfq,
  submitBid,
  forceCloseRfq,
};
