const express = require('express');
const {
  AppError,
  createRfq,
  forceCloseRfq,
  getRfqDetails,
  listRfqs,
  submitBid,
} = require('../services/auctionService');

// Convert URL :id parameter into a valid integer or throw a 400 error
function parseIdParam(rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) {
    throw new AppError(400, 'Invalid RFQ id.');
  }
  return id;
}

// Create an Express router with all RFQ, bid, and force-close API endpoints
function createRfqRouter(db) {
  const router = express.Router();

  // GET /api/rfqs - List all RFQs with optional status and British-only filters
  router.get('/', (req, res, next) => {
    try {
      const statusFilter = req.query.status || 'All';
      const britishOnly = req.query.british_only === 'true';
      const items = listRfqs(db, { statusFilter, britishOnly });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/rfqs - Create a new RFQ with British Auction settings
  router.post('/', (req, res, next) => {
    try {
      const created = createRfq(db, req.body || {});
      res.status(201).json({ item: created });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/rfqs/:id - Get full details, rankings, bids, and activity log for one RFQ
  router.get('/:id', (req, res, next) => {
    try {
      const rfqId = parseIdParam(req.params.id);
      const item = getRfqDetails(db, rfqId);
      res.json({ item });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/rfqs/:id/bids - Submit a supplier quote and run extension rules
  router.post('/:id/bids', (req, res, next) => {
    try {
      const rfqId = parseIdParam(req.params.id);
      const result = submitBid(db, rfqId, req.body || {});
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/rfqs/:id/force-close - Manually force-close an auction immediately
  router.post('/:id/force-close', (req, res, next) => {
    try {
      const rfqId = parseIdParam(req.params.id);
      const reason = req.body && req.body.reason ? req.body.reason : '';
      const updated = forceCloseRfq(db, rfqId, reason);
      res.json({ item: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createRfqRouter;

