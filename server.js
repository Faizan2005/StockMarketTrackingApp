require("dotenv").config();
const express = require("express");
const WebSocket = require("ws");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const finnhub = require("finnhub");
const fs = require("fs");
const redis = require("./redisClient");
const ms = require("ms");
const Quote = require("./models/schema");
const pool = require("./models/storage");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DAY_MS = 86400000;

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const FINNHUB_API_URL = `wss://ws.finnhub.io?token=${FINNHUB_API_KEY}`;
console.log("[Init] Using Finnhub WebSocket URL:", FINNHUB_API_URL);

if (!FINNHUB_API_KEY) {
  console.error("[Fatal] FINNHUB_API_KEY is not set in .env file");
  process.exit(1);
}

// WebSocket connection to Finnhub
const socket = new WebSocket(FINNHUB_API_URL);

// Serve static frontend files
app.use(express.static(path.join(__dirname, "public")));

const api_key = finnhub.ApiClient.instance.authentications["api_key"];
api_key.apiKey = FINNHUB_API_KEY;
const finnhubClient = new finnhub.DefaultApi();

const now = Date.now();
let lastStockTimestamp = 0;

try {
  console.log("[Startup] Reading stockTimestamp.json...");
  lastStockTimestamp = JSON.parse(
    fs.readFileSync("stockTimestamp.json", "utf-8")
  );
  console.log("[Startup] Last stock timestamp loaded:", lastStockTimestamp);
} catch (e) {
  console.warn(
    "[Startup] stockTimestamp.json not found or invalid, proceeding with fetch."
  );
}

if (shouldFetch("timestamp.json")) {
  console.log("[Fetch] Starting fresh symbol fetch...");

  const fetchStock = new Promise((resolve, reject) => {
    finnhubClient.stockSymbols("US", (err, data) => {
      if (err) return reject("[Fetch] Stock fetch error: " + err);
      console.log("[Fetch] Stock symbols fetched:", data.length);
      saveToFile("stockSymbols.json", data);
      resolve();
    });
  });

  const fetchCrypto = new Promise((resolve, reject) => {
    finnhubClient.cryptoSymbols("BINANCE", (err, data) => {
      if (err) return reject("[Fetch] Crypto fetch error: " + err);
      console.log("[Fetch] Crypto symbols fetched:", data.length);
      saveToFile("cryptoSymbols.json", data);
      resolve();
    });
  });

  Promise.all([fetchStock, fetchCrypto])
    .then(() => {
      console.log("[Fetch] All symbols fetched and saved.");
      saveToFile("timestamp.json", Date.now());
    })
    .catch((err) => {
      console.error("[Fetch] Error during fetch:", err);
    });
}

function saveToFile(fileName, data) {
  try {
    fs.writeFileSync(fileName, JSON.stringify(data, null, 2));
    console.log(`[File] ${fileName} saved successfully.`);
  } catch (err) {
    console.error(`[File] Failed to save ${fileName}:`, err);
  }
}

function shouldFetch(fileName) {
  try {
    const timeStamp = JSON.parse(fs.readFileSync(fileName, "utf-8"));
    const should = Date.now() - timeStamp >= DAY_MS;
    console.log(`[Check] Should fetch new data? ${should}`);
    return should;
  } catch (err) {
    console.warn("[Check] Timestamp check failed, defaulting to fetch.");
    return true;
  }
}

// WebSocket connection established
socket.on("open", () => {
  console.log("[WebSocket] Connected to Finnhub");

  let stockSymbols = [];
  let cryptoSymbols = [];

  try {
    stockSymbols = JSON.parse(fs.readFileSync("stockSymbols.json", "utf-8"))
      //.slice(0, 5)
      .map((entry) => entry.symbol);
    console.log("[WebSocket] Loaded stock symbols:", stockSymbols);
  } catch (e) {
    console.error("[WebSocket] Error reading stockSymbols.json:", e);
  }

  try {
    cryptoSymbols = JSON.parse(fs.readFileSync("cryptoSymbols.json", "utf-8"))
      // .slice(0, 5)
      .map((entry) => entry.symbol);
    console.log("[WebSocket] Loaded crypto symbols:", cryptoSymbols);
  } catch (e) {
    console.error("[WebSocket] Error reading cryptoSymbols.json:", e);
  }

  const allSymbols = [...stockSymbols, ...cryptoSymbols];
  allSymbols.forEach((symbol) => {
    socket.send(JSON.stringify({ type: "subscribe", symbol }));
    console.log(`[WebSocket] Subscribed to: ${symbol}`);
  });

  console.log("[Polling] Starting quote polling...");
  initQuotePolling(allSymbols, 10000);
});

// On WebSocket message
socket.on("message", (msg) => {
  console.log("[WebSocket] Received message.");
  try {
    const data = JSON.parse(msg);
    console.log(data);
    if (data.type === "trade") {
      console.log("[WebSocket] Trade data received, emitting to clients.");
      io.emit("stockData", data);
    }
  } catch (err) {
    console.error("[WebSocket] Message parse error:", err);
  }
});

socket.on("error", (err) => {
  console.error("[WebSocket] Connection error:", err.message);
});

socket.on("close", (code, reason) => {
  console.warn(
    `[WebSocket] Connection closed. Code: ${code}, Reason: ${reason}`
  );
});

const PORT = process.env.PORT || 8000;

server.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
  console.log(`[Server] Visit: http://localhost:${PORT}`);
});

// API endpoints
app.get("/symbols/stocks", (req, res) => {
  try {
    const stockSymbols = JSON.parse(
      fs.readFileSync("stockSymbols.json", "utf-8")
    ).map((entry) => entry.symbol);
    console.log("[API] /symbols/stocks requested.");
    res.json(stockSymbols);
  } catch (err) {
    console.error("[API] Failed to get stock symbols:", err);
    res.status(500).json({ error: "Failed to read stock symbols." });
  }
});

app.get("/symbols/crypto", (req, res) => {
  try {
    const cryptoSymbols = JSON.parse(
      fs.readFileSync("cryptoSymbols.json", "utf-8")
    ).map((entry) => entry.symbol);
    console.log("[API] /symbols/crypto requested.");
    res.json(cryptoSymbols);
  } catch (err) {
    console.error("[API] Failed to get crypto symbols:", err);
    res.status(500).json({ error: "Failed to read crypto symbols." });
  }
});

app.get("/history/:symbol", async (req, res) => {
  const { symbol } = req.params;

  const data = await Quote.find({ symbol })
    .sort({ timestamp: 1 }) // ascending by time
    .limit(100); // adjust as needed

  res.json(data);
});

app.post("/watchlist/add", async (req, res) => {
  const userID = req.user.id;
  const { symbol } = req.body;

  try {
    await pool.query(
      "INSERT INTO watchlists (user_id, stock_symbol) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [userID, symbol]
    );

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.post("/watchlist/remove", async (req, res) => {
  const userID = req.user.id;
  const { symbol } = req.body;

  try {
    await pool.query(
      "DELETE FROM watchlists WHERE user_id=$1 AND stock_symbol=$2",
      [userID, symbol]
    );

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.get("/watchlist", async (req, res) => {
  const userID = req.user.id;

  try {
    const result = await pool.query(
      "SELECT stock_symbols FROM watchlists WHERE users=$1", [userID]
    )

    const symbols = result.rows.map(r => r.stock_symbol)

    






  }




})






// Quote polling
async function fetchQuote(symbol) {
  return new Promise((resolve, reject) => {
    finnhubClient.quote(symbol, async (error, data) => {
      if (error) {
        console.error(`[Quote] Error fetching ${symbol}:`, error);
        return reject(error);
      }

      const quote = {
        price: data.c,
        change: data.d,
        change_percent: data.dp,
        open: data.o,
        high: data.h,
        low: data.l,
        close_previous: data.pc,
        timeStamp: new Date(),
      };

      console.log(`[Quote] Fetched quote for ${symbol}:`, quote);

      // Save to MongoDB
      try {
        const newQuote = new Quote({ symbol, ...quote });
        await newQuote.save();
        console.log(`[MongoDB] Saved quote for ${symbol}`);
      } catch (err) {
        console.error(`[MongoDB] Error saving quote for ${symbol}:`, err);
      }

      resolve(quote);
    });
  });
}

function initQuotePolling(symbols, interval) {
  setInterval(async () => {
    for (const symbol of symbols) {
      try {
        const quote = await fetchQuote(symbol);
        const cache = await redis.get(symbol);
        if (JSON.stringify(quote) !== JSON.stringify(cache)) {
          console.log(
            `[Polling] Quote changed for ${symbol}, emitting update.`
          );
          io.emit("quoteUpdate", { symbol, ...quote });
          await redis.set(symbol, JSON.stringify(quote), "EX", 10);
        } else {
          console.log(`[Polling] No change in quote for ${symbol}.`);
        }
      } catch (err) {
        console.error(`[Polling] Error in polling quote for ${symbol}:`, err);
      }
    }
  }, interval);
}
