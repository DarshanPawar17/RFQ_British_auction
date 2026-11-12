const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, 'data', 'auction.db');

// Open a SQLite database connection and initialize tables
function createDatabase(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  return db;
}

// Create the rfqs, bids, and auction_activity_logs tables if they do not exist
function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rfqs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      pickup_service_date TEXT NOT NULL,
      bid_start_time TEXT NOT NULL,
      initial_bid_close_time TEXT NOT NULL,
      current_bid_close_time TEXT NOT NULL,
      forced_bid_close_time TEXT NOT NULL,
      british_auction_enabled INTEGER NOT NULL DEFAULT 1,
      trigger_window_minutes INTEGER NOT NULL DEFAULT 10,
      extension_duration_minutes INTEGER NOT NULL DEFAULT 5,
      extension_trigger_type TEXT NOT NULL DEFAULT 'BID_RECEIVED'
        CHECK (extension_trigger_type IN ('BID_RECEIVED', 'ANY_RANK_CHANGE', 'L1_RANK_CHANGE')),
      manual_force_closed INTEGER NOT NULL DEFAULT 0,
      extension_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id INTEGER NOT NULL,
      carrier_name TEXT NOT NULL,
      freight_charges REAL NOT NULL CHECK (freight_charges >= 0),
      origin_charges REAL NOT NULL CHECK (origin_charges >= 0),
      destination_charges REAL NOT NULL CHECK (destination_charges >= 0),
      total_price REAL NOT NULL CHECK (total_price > 0),
      transit_time_days INTEGER NOT NULL CHECK (transit_time_days >= 1),
      quote_validity_date TEXT NOT NULL,
      is_latest INTEGER NOT NULL DEFAULT 1,
      submitted_at TEXT NOT NULL,
      FOREIGN KEY (rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auction_activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id INTEGER NOT NULL,
      event_type TEXT NOT NULL
        CHECK (event_type IN ('AUCTION_CREATED', 'BID_SUBMITTED', 'TIME_EXTENSION', 'AUCTION_FORCE_CLOSED')),
      carrier_name TEXT,
      bid_id INTEGER,
      bid_total_price REAL,
      old_close_time TEXT,
      new_close_time TEXT,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE,
      FOREIGN KEY (bid_id) REFERENCES bids(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bids_rfq_latest
      ON bids(rfq_id, is_latest, total_price);

    CREATE INDEX IF NOT EXISTS idx_logs_rfq_created
      ON auction_activity_logs(rfq_id, created_at);
  `);
}

// Add minutes to a base Date and return an ISO timestamp string
function minutesFrom(baseDate, minutes) {
  return new Date(baseDate.getTime() + minutes * 60000).toISOString();
}

// Add days to a base Date and return a YYYY-MM-DD date string
function daysFromDate(baseDate, days) {
  const copy = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
  return copy.toISOString().slice(0, 10);
}

// Insert 4 sample RFQs (Active, Closed, Force Closed) so the app is ready to test
function seedDemoData(db, forceReset = false) {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM rfqs').get();
  if (!forceReset && existing.count > 0) {
    return;
  }

  const now = new Date();

  const runSeed = db.transaction(() => {
    if (forceReset) {
      db.exec('DELETE FROM auction_activity_logs; DELETE FROM bids; DELETE FROM rfqs;');
    }

    const insertRfq = db.prepare(`
      INSERT INTO rfqs (
        reference_id, name, pickup_service_date,
        bid_start_time, initial_bid_close_time, current_bid_close_time, forced_bid_close_time,
        british_auction_enabled, trigger_window_minutes, extension_duration_minutes, extension_trigger_type,
        manual_force_closed, extension_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertBid = db.prepare(`
      INSERT INTO bids (
        rfq_id, carrier_name, freight_charges, origin_charges, destination_charges,
        total_price, transit_time_days, quote_validity_date, is_latest, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertLog = db.prepare(`
      INSERT INTO auction_activity_logs (
        rfq_id, event_type, carrier_name, bid_id, bid_total_price,
        old_close_time, new_close_time, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // 1. Active auction currently INSIDE its 10-minute trigger window (Bid Received rule)
    const rfq1 = insertRfq.run(
      'RFQ-2026-101',
      'Ocean Freight - Nhava Sheva to Rotterdam (40ft HC)',
      daysFromDate(now, 7),
      minutesFrom(now, -120),
      minutesFrom(now, 7),
      minutesFrom(now, 7),
      minutesFrom(now, 22),
      1,
      10,
      5,
      'BID_RECEIVED',
      0,
      0,
      minutesFrom(now, -130)
    );
    const rfq1Id = rfq1.lastInsertRowid;

    insertLog.run(
      rfq1Id,
      'AUCTION_CREATED',
      null,
      null,
      null,
      null,
      null,
      'RFQ created with British Auction enabled (Trigger: Bid Received in last 10 mins, Extension: +5 mins).',
      minutesFrom(now, -130)
    );

    const rfq1Bids = [
      { carrier: 'Maersk Line', freight: 2100, origin: 250, dest: 300, transit: 24, at: -90 },
      { carrier: 'MSC Shipping', freight: 1980, origin: 240, dest: 300, transit: 25, at: -60 },
      { carrier: 'Hapag-Lloyd', freight: 1920, origin: 230, dest: 300, transit: 23, at: -30 },
    ];
    for (let i = 0; i < rfq1Bids.length; i++) {
      const b = rfq1Bids[i];
      const total = b.freight + b.origin + b.dest;
      const res = insertBid.run(
        rfq1Id,
        b.carrier,
        b.freight,
        b.origin,
        b.dest,
        total,
        b.transit,
        daysFromDate(now, 30),
        1,
        minutesFrom(now, b.at)
      );
      insertLog.run(
        rfq1Id,
        'BID_SUBMITTED',
        b.carrier,
        res.lastInsertRowid,
        total,
        null,
        null,
        `${b.carrier} submitted a quote of $${total.toLocaleString()}.`,
        minutesFrom(now, b.at)
      );
    }

    // 2. Active auction (L1 Rank Change rule) with tight Forced Close ceiling to test capping
    const rfq2 = insertRfq.run(
      'RFQ-2026-102',
      'Air Freight - Bengaluru to Frankfurt (Pharma)',
      daysFromDate(now, 3),
      minutesFrom(now, -60),
      minutesFrom(now, 8),
      minutesFrom(now, 8),
      minutesFrom(now, 11),
      1,
      10,
      5,
      'L1_RANK_CHANGE',
      0,
      0,
      minutesFrom(now, -70)
    );
    const rfq2Id = rfq2.lastInsertRowid;

    insertLog.run(
      rfq2Id,
      'AUCTION_CREATED',
      null,
      null,
      null,
      null,
      null,
      'RFQ created with British Auction enabled (Trigger: L1 Rank Change in last 10 mins, Extension: +5 mins).',
      minutesFrom(now, -70)
    );

    const rfq2Bids = [
      { carrier: 'DHL Global', freight: 3600, origin: 300, dest: 300, transit: 4, at: -40 },
      { carrier: 'FedEx Freight', freight: 3800, origin: 320, dest: 330, transit: 3, at: -25 },
    ];
    for (let i = 0; i < rfq2Bids.length; i++) {
      const b = rfq2Bids[i];
      const total = b.freight + b.origin + b.dest;
      const res = insertBid.run(
        rfq2Id,
        b.carrier,
        b.freight,
        b.origin,
        b.dest,
        total,
        b.transit,
        daysFromDate(now, 15),
        1,
        minutesFrom(now, b.at)
      );
      insertLog.run(
        rfq2Id,
        'BID_SUBMITTED',
        b.carrier,
        res.lastInsertRowid,
        total,
        null,
        null,
        `${b.carrier} submitted a quote of $${total.toLocaleString()}.`,
        minutesFrom(now, b.at)
      );
    }

    // 3. Closed auction (extended once, then ended naturally before Forced Close Time)
    const rfq3InitialClose = minutesFrom(now, -75);
    const rfq3ExtendedClose = minutesFrom(now, -70);
    const rfq3 = insertRfq.run(
      'RFQ-2026-103',
      'Road FTL - Pune to Chennai (Auto Parts)',
      daysFromDate(now, 2),
      minutesFrom(now, -300),
      rfq3InitialClose,
      rfq3ExtendedClose,
      minutesFrom(now, -30),
      1,
      10,
      5,
      'ANY_RANK_CHANGE',
      0,
      1,
      minutesFrom(now, -320)
    );
    const rfq3Id = rfq3.lastInsertRowid;

    insertLog.run(
      rfq3Id,
      'AUCTION_CREATED',
      null,
      null,
      null,
      null,
      null,
      'RFQ created with British Auction enabled (Trigger: Any Rank Change in last 10 mins, Extension: +5 mins).',
      minutesFrom(now, -320)
    );

    const b3a = insertBid.run(
      rfq3Id,
      'BlueDart Cargo',
      850,
      80,
      70,
      1000,
      3,
      daysFromDate(now, 10),
      1,
      minutesFrom(now, -180)
    );
    insertLog.run(
      rfq3Id,
      'BID_SUBMITTED',
      'BlueDart Cargo',
      b3a.lastInsertRowid,
      1000,
      null,
      null,
      'BlueDart Cargo submitted a quote of $1,000.',
      minutesFrom(now, -180)
    );

    const b3b = insertBid.run(
      rfq3Id,
      'TCI Express',
      790,
      70,
      60,
      920,
      3,
      daysFromDate(now, 10),
      1,
      minutesFrom(now, -80)
    );
    insertLog.run(
      rfq3Id,
      'BID_SUBMITTED',
      'TCI Express',
      b3b.lastInsertRowid,
      920,
      null,
      null,
      'TCI Express submitted a quote of $920 (Current Rank: L1).',
      minutesFrom(now, -80)
    );
    insertLog.run(
      rfq3Id,
      'TIME_EXTENSION',
      'TCI Express',
      b3b.lastInsertRowid,
      920,
      rfq3InitialClose,
      rfq3ExtendedClose,
      "Supplier rankings changed after TCI Express's bid within last 10 minutes; extended by 5 minutes.",
      minutesFrom(now, -80)
    );

    // 4. Force Closed auction (hit Forced Bid Close Time ceiling after extensions)
    const rfq4InitialClose = minutesFrom(now, -75);
    const rfq4FirstExt = minutesFrom(now, -70);
    const rfq4ForcedClose = minutesFrom(now, -67);
    const rfq4 = insertRfq.run(
      'RFQ-2026-104',
      'Sea Freight - Mundra to Jebel Ali (20ft FCL)',
      daysFromDate(now, 5),
      minutesFrom(now, -360),
      rfq4InitialClose,
      rfq4ForcedClose,
      rfq4ForcedClose,
      1,
      10,
      5,
      'BID_RECEIVED',
      0,
      2,
      minutesFrom(now, -370)
    );
    const rfq4Id = rfq4.lastInsertRowid;

    insertLog.run(
      rfq4Id,
      'AUCTION_CREATED',
      null,
      null,
      null,
      null,
      null,
      'RFQ created with British Auction enabled (Trigger: Bid Received in last 10 mins, Extension: +5 mins).',
      minutesFrom(now, -370)
    );

    const b4a = insertBid.run(
      rfq4Id,
      'CMA CGM',
      1100,
      150,
      150,
      1400,
      7,
      daysFromDate(now, 20),
      1,
      minutesFrom(now, -200)
    );
    insertLog.run(
      rfq4Id,
      'BID_SUBMITTED',
      'CMA CGM',
      b4a.lastInsertRowid,
      1400,
      null,
      null,
      'CMA CGM submitted a quote of $1,400.',
      minutesFrom(now, -200)
    );

    const b4bOld = insertBid.run(
      rfq4Id,
      'COSCO Shipping',
      1050,
      140,
      150,
      1340,
      8,
      daysFromDate(now, 20),
      0,
      minutesFrom(now, -78)
    );
    insertLog.run(
      rfq4Id,
      'BID_SUBMITTED',
      'COSCO Shipping',
      b4bOld.lastInsertRowid,
      1340,
      null,
      null,
      'COSCO Shipping submitted a quote of $1,340 (Current Rank: L1).',
      minutesFrom(now, -78)
    );
    insertLog.run(
      rfq4Id,
      'TIME_EXTENSION',
      'COSCO Shipping',
      b4bOld.lastInsertRowid,
      1340,
      rfq4InitialClose,
      rfq4FirstExt,
      'Bid received from COSCO Shipping within last 10 minutes; extended by 5 minutes.',
      minutesFrom(now, -78)
    );

    const b4bNew = insertBid.run(
      rfq4Id,
      'COSCO Shipping',
      1000,
      140,
      150,
      1290,
      8,
      daysFromDate(now, 20),
      1,
      minutesFrom(now, -72)
    );
    insertLog.run(
      rfq4Id,
      'BID_SUBMITTED',
      'COSCO Shipping',
      b4bNew.lastInsertRowid,
      1290,
      null,
      null,
      'COSCO Shipping lowered bid from $1,340 to $1,290 (Current Rank: L1).',
      minutesFrom(now, -72)
    );
    insertLog.run(
      rfq4Id,
      'TIME_EXTENSION',
      'COSCO Shipping',
      b4bNew.lastInsertRowid,
      1290,
      rfq4FirstExt,
      rfq4ForcedClose,
      'Bid received from COSCO Shipping within last 10 minutes; extended and capped at Forced Bid Close Time.',
      minutesFrom(now, -72)
    );
  });

  runSeed();
}

module.exports = {
  DEFAULT_DB_PATH,
  createDatabase,
  initSchema,
  seedDemoData,
};

