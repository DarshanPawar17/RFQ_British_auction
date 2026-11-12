const express = require('express');
const cors = require('cors');
const { DEFAULT_DB_PATH, createDatabase, seedDemoData } = require('./db');
const createRfqRouter = require('./routes/rfqRoutes');
const { AppError, listRfqs } = require('./services/auctionService');

// Build and configure the Express application with SQLite, routes, and error handler
function createApp(dbPath = DEFAULT_DB_PATH) {
  const db = createDatabase(dbPath);
  seedDemoData(db);

  const app = express();
  app.use(cors());
  app.use(express.json());

  // GET /api/health - Confirm the backend API server is running
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Mount all /api/rfqs endpoints
  app.use('/api/rfqs', createRfqRouter(db));

  // POST /api/demo/reset - Reset sample RFQs back to fresh relative timestamps
  app.post('/api/demo/reset', (req, res, next) => {
    try {
      seedDemoData(db, true);
      res.json({
        message: 'Sample demo data has been reset.',
        items: listRfqs(db),
      });
    } catch (err) {
      next(err);
    }
  });

  // Global Express error handler returning clean JSON { detail } responses
  app.use((err, req, res, next) => {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ detail: err.message });
    }
    console.error('Unexpected server error:', err);
    return res.status(500).json({ detail: 'Internal server error.' });
  });

  return { app, db };
}

// Start the HTTP server only when running `node server.js` directly
if (require.main === module) {
  const PORT = process.env.PORT || 8000;
  const { app, db } = createApp();

  const server = app.listen(PORT, () => {
    console.log(`Express server running at http://localhost:${PORT}`);
  });

  // Close SQLite cleanly when stopping the server with Ctrl+C
  process.on('SIGINT', () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}

module.exports = { createApp };

