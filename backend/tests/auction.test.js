const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../db');
const { createApp } = require('../server');
const {
  createRfq,
  forceCloseRfq,
  getAuctionStatus,
  submitBid,
} = require('../services/auctionService');

// Create a fresh in-memory SQLite database for each unit test
function makeTestDb() {
  return createDatabase(':memory:');
}

// Add minutes to a Date and return an ISO timestamp string
function plusMinutes(baseDate, minutes) {
  return new Date(baseDate.getTime() + minutes * 60000).toISOString();
}

test('Forced Bid Close Time must be strictly greater than Bid Close Time', () => {
  const db = makeTestDb();
  const base = new Date('2026-11-11T12:00:00.000Z');

  assert.throws(
    () =>
      createRfq(
        db,
        {
          reference_id: 'TEST-INVALID-1',
          name: 'Invalid Close Test',
          pickup_service_date: '2026-11-20',
          bid_start_time: plusMinutes(base, 0),
          bid_close_time: plusMinutes(base, 30),
          forced_bid_close_time: plusMinutes(base, 30),
          british_auction_enabled: true,
          trigger_window_minutes: 10,
          extension_duration_minutes: 5,
          extension_trigger_type: 'BID_RECEIVED',
        },
        base
      ),
    /Forced Bid Close Time/
  );

  db.close();
});

test('BID_RECEIVED extends close time inside trigger window and caps at Forced Close Time', () => {
  const db = makeTestDb();
  const t0 = new Date('2026-11-11T17:00:00.000Z');

  const rfq = createRfq(
    db,
    {
      reference_id: 'RFQ-EXT-1',
      name: 'Test Cap Auction',
      pickup_service_date: '2026-11-20',
      bid_start_time: plusMinutes(t0, 0),
      bid_close_time: plusMinutes(t0, 60),
      forced_bid_close_time: plusMinutes(t0, 68),
      british_auction_enabled: true,
      trigger_window_minutes: 10,
      extension_duration_minutes: 5,
      extension_trigger_type: 'BID_RECEIVED',
    },
    t0
  );

  // Outside trigger window (17:40) -> no extension
  const res1 = submitBid(
    db,
    rfq.id,
    {
      carrier_name: 'Carrier A',
      freight_charges: 1000,
      origin_charges: 100,
      destination_charges: 100,
      transit_time_days: 5,
      quote_validity_date: '2026-12-01',
    },
    new Date(t0.getTime() + 40 * 60000)
  );
  assert.equal(res1.bid_result.extended, false);
  assert.equal(res1.auction.current_bid_close_time, plusMinutes(t0, 60));

  // Inside trigger window (17:55) -> extends 18:00 -> 18:05
  const res2 = submitBid(
    db,
    rfq.id,
    {
      carrier_name: 'Carrier B',
      freight_charges: 950,
      origin_charges: 100,
      destination_charges: 100,
      transit_time_days: 5,
      quote_validity_date: '2026-12-01',
    },
    new Date(t0.getTime() + 55 * 60000)
  );
  assert.equal(res2.bid_result.extended, true);
  assert.equal(res2.bid_result.capped_at_forced_close, false);
  assert.equal(res2.auction.current_bid_close_time, plusMinutes(t0, 65));

  // Inside new trigger window (18:02) -> +5 min would be 18:10, capped at 18:08
  const res3 = submitBid(
    db,
    rfq.id,
    {
      carrier_name: 'Carrier A',
      freight_charges: 900,
      origin_charges: 100,
      destination_charges: 100,
      transit_time_days: 5,
      quote_validity_date: '2026-12-01',
    },
    new Date(t0.getTime() + 62 * 60000)
  );
  assert.equal(res3.bid_result.extended, true);
  assert.equal(res3.bid_result.capped_at_forced_close, true);
  assert.equal(res3.auction.current_bid_close_time, plusMinutes(t0, 68));

  // Once at Forced Close Time (18:08), status becomes Force Closed
  assert.equal(getAuctionStatus(res3.auction, new Date(t0.getTime() + 68 * 60000)), 'Force Closed');
  db.close();
});

test('L1_RANK_CHANGE extends only when the L1 supplier changes', () => {
  const db = makeTestDb();
  const t0 = new Date('2026-11-11T17:00:00.000Z');

  const rfq = createRfq(
    db,
    {
      reference_id: 'RFQ-L1-ONLY',
      name: 'L1 Only Test',
      pickup_service_date: '2026-11-20',
      bid_start_time: plusMinutes(t0, 0),
      bid_close_time: plusMinutes(t0, 20),
      forced_bid_close_time: plusMinutes(t0, 60),
      british_auction_enabled: true,
      trigger_window_minutes: 10,
      extension_duration_minutes: 5,
      extension_trigger_type: 'L1_RANK_CHANGE',
    },
    t0
  );

  const initialBids = [
    ['A', 1000],
    ['B', 1200],
    ['C', 1400],
  ];
  for (let i = 0; i < initialBids.length; i++) {
    submitBid(
      db,
      rfq.id,
      {
        carrier_name: initialBids[i][0],
        freight_charges: initialBids[i][1],
        origin_charges: 0,
        destination_charges: 0,
        transit_time_days: 4,
        quote_validity_date: '2026-12-01',
      },
      new Date(t0.getTime() + 2 * 60000)
    );
  }

  // Inside window: C beats B (L3 -> L2) while A stays L1 -> must NOT extend
  const resC1 = submitBid(
    db,
    rfq.id,
    {
      carrier_name: 'C',
      freight_charges: 1100,
      origin_charges: 0,
      destination_charges: 0,
      transit_time_days: 4,
      quote_validity_date: '2026-12-01',
    },
    new Date(t0.getTime() + 15 * 60000)
  );
  assert.equal(resC1.bid_result.rank_label, 'L2');
  assert.equal(resC1.bid_result.extended, false);

  // Inside window: A (already L1) lowers own bid -> L1 stays A -> must NOT extend
  const resA = submitBid(
    db,
    rfq.id,
    {
      carrier_name: 'A',
      freight_charges: 950,
      origin_charges: 0,
      destination_charges: 0,
      transit_time_days: 4,
      quote_validity_date: '2026-12-01',
    },
    new Date(t0.getTime() + 16 * 60000)
  );
  assert.equal(resA.bid_result.extended, false);

  // Inside window: C bids $900 -> C becomes new L1 -> MUST extend
  const resC2 = submitBid(
    db,
    rfq.id,
    {
      carrier_name: 'C',
      freight_charges: 900,
      origin_charges: 0,
      destination_charges: 0,
      transit_time_days: 4,
      quote_validity_date: '2026-12-01',
    },
    new Date(t0.getTime() + 17 * 60000)
  );
  assert.equal(resC2.bid_result.rank_label, 'L1');
  assert.equal(resC2.bid_result.extended, true);
  assert.equal(resC2.auction.extension_count, 1);

  db.close();
});

test('ANY_RANK_CHANGE triggers on L2/L3 swap and Upcoming blocks early bids', () => {
  const db = makeTestDb();
  const t0 = new Date('2026-11-11T17:00:00.000Z');

  const rfq = createRfq(
    db,
    {
      reference_id: 'RFQ-ANY-RANK',
      name: 'Any Rank Change Test',
      pickup_service_date: '2026-11-20',
      bid_start_time: plusMinutes(t0, 5),
      bid_close_time: plusMinutes(t0, 25),
      forced_bid_close_time: plusMinutes(t0, 60),
      british_auction_enabled: true,
      trigger_window_minutes: 10,
      extension_duration_minutes: 5,
      extension_trigger_type: 'ANY_RANK_CHANGE',
    },
    t0
  );
  assert.equal(rfq.status, 'Upcoming');

  assert.throws(
    () =>
      submitBid(
        db,
        rfq.id,
        {
          carrier_name: 'A',
          freight_charges: 1000,
          origin_charges: 0,
          destination_charges: 0,
          transit_time_days: 4,
          quote_validity_date: '2026-12-01',
        },
        new Date(t0.getTime() + 1 * 60000)
      ),
    /not started/
  );

  const initialBids = [
    ['A', 1000],
    ['B', 1200],
    ['C', 1400],
  ];
  for (let i = 0; i < initialBids.length; i++) {
    submitBid(
      db,
      rfq.id,
      {
        carrier_name: initialBids[i][0],
        freight_charges: initialBids[i][1],
        origin_charges: 0,
        destination_charges: 0,
        transit_time_days: 4,
        quote_validity_date: '2026-12-01',
      },
      new Date(t0.getTime() + 6 * 60000)
    );
  }

  // Inside window: A lowers own bid -> order unchanged -> no extension
  const resA = submitBid(
    db,
    rfq.id,
    {
      carrier_name: 'A',
      freight_charges: 950,
      origin_charges: 0,
      destination_charges: 0,
      transit_time_days: 4,
      quote_validity_date: '2026-12-01',
    },
    new Date(t0.getTime() + 20 * 60000)
  );
  assert.equal(resA.bid_result.extended, false);

  // Inside window: C beats B (L3 -> L2) -> MUST extend
  const resC = submitBid(
    db,
    rfq.id,
    {
      carrier_name: 'C',
      freight_charges: 1100,
      origin_charges: 0,
      destination_charges: 0,
      transit_time_days: 4,
      quote_validity_date: '2026-12-01',
    },
    new Date(t0.getTime() + 21 * 60000)
  );
  assert.equal(resC.bid_result.rank_label, 'L2');
  assert.equal(resC.bid_result.extended, true);

  db.close();
});

test('Returning carrier must submit strictly lower price and manual force close blocks bids', () => {
  const db = makeTestDb();
  const t0 = new Date('2026-11-11T17:00:00.000Z');

  const rfq = createRfq(
    db,
    {
      reference_id: 'RFQ-RULES-1',
      name: 'Price Drop & Force Close Test',
      pickup_service_date: '2026-11-20',
      bid_start_time: plusMinutes(t0, 0),
      bid_close_time: plusMinutes(t0, 30),
      forced_bid_close_time: plusMinutes(t0, 60),
      british_auction_enabled: true,
      trigger_window_minutes: 10,
      extension_duration_minutes: 5,
      extension_trigger_type: 'ANY_RANK_CHANGE',
    },
    t0
  );

  submitBid(
    db,
    rfq.id,
    {
      carrier_name: 'Maersk',
      freight_charges: 1000,
      origin_charges: 100,
      destination_charges: 100,
      transit_time_days: 10,
      quote_validity_date: '2026-12-01',
    },
    new Date(t0.getTime() + 5 * 60000)
  );

  assert.throws(
    () =>
      submitBid(
        db,
        rfq.id,
        {
          carrier_name: 'Maersk',
          freight_charges: 1000,
          origin_charges: 100,
          destination_charges: 100,
          transit_time_days: 10,
          quote_validity_date: '2026-12-01',
        },
        new Date(t0.getTime() + 6 * 60000)
      ),
    /strictly lower/
  );

  const closed = forceCloseRfq(db, rfq.id, 'Testing manual close', new Date(t0.getTime() + 10 * 60000));
  assert.equal(closed.status, 'Force Closed');

  assert.throws(
    () =>
      submitBid(
        db,
        rfq.id,
        {
          carrier_name: 'MSC',
          freight_charges: 900,
          origin_charges: 100,
          destination_charges: 100,
          transit_time_days: 10,
          quote_validity_date: '2026-12-01',
        },
        new Date(t0.getTime() + 11 * 60000)
      ),
    /Force Closed/
  );

  db.close();
});

test('Express HTTP API integration: health, list, and submit bid extension', async () => {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.status, 'ok');

    const listRes = await fetch(`${baseUrl}/api/rfqs`);
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.equal(listJson.items.length, 4);

    const activeRfq = listJson.items.find((item) => item.reference_id === 'RFQ-2026-101');
    const bidRes = await fetch(`${baseUrl}/api/rfqs/${activeRfq.id}/bids`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        carrier_name: 'CMA CGM',
        freight_charges: 1800,
        origin_charges: 200,
        destination_charges: 250,
        transit_time_days: 22,
        quote_validity_date: '2026-12-15',
      }),
    });

    assert.equal(bidRes.status, 201);
    const bidJson = await bidRes.json();
    assert.equal(bidJson.bid_result.rank_label, 'L1');
    assert.equal(bidJson.bid_result.extended, true);
    assert.equal(bidJson.auction.extension_count, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

