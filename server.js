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
// REMOVED: const Quote = require("./models/schema"); // Removed MongoDB model import
const pool = require("./models/storage");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const jwt = require("jsonwebtoken");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Database Connection Test and Log ---
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("[Database] Connection Test FAILED:", err.stack);
    // Consider exiting the process if database is critical and not connected
    // process.exit(1);
  } else {
    console.log(
      "[Database] Connected to PostgreSQL! Current DB time:",
      res.rows[0].now
    );
  }
});

pool.on("error", (err) => {
  console.error("[Database] Unexpected error on idle client", err);
  // It's often good practice to exit if the main database pool has a critical error
  // process.exit(-1);
});
// --- End Database Connection Test and Log ---

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

// Middleware to parse JSON body for API requests
app.use(express.json());
// Serve static frontend files
app.use(express.static(path.join(__dirname, "public")));

app.use(passport.initialize());

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.REDIRECT_URI,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // This function is called after user authenticates with Google
        // 'profile' contains user info from Google (e.g., profile.id, profile.emails[0].value, profile.displayName)

        let user = await pool.query(
          "SELECT * FROM users WHERE oauth_id=$1 AND oauth_provider=$2",
          [profile.id, "google"]
        );

        if (user.rows.length === 0) {
          // New user: Save to database
          const newUser = await pool.query(
            "INSERT INTO users (oauth_id, oauth_provider, email, name) VALUES ($1, $2, $3, $4) RETURNING *",
            [profile.id, "google", profile.emails[0].value, profile.displayName]
          );
          user = newUser;
        }

        // Pass the user object (from your DB) to Passport
        return done(null, user.rows[0]);
      } catch (err) {
        return done(err, false);
      }
    }
  )
);

// Route to initiate Google OAuth login
app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// OAuth callback route
app.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: process.env.CLIENT_FAILURE_REDIRECT_URL,
    session: false
  }),
  (req, res) => {
    // If authentication succeeds, req.user will contain the user object from your DB
    // Now, generate a JWT
    const token = jwt.sign({ userId: req.user.id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    }); // Token expires in 1 hour

    // Option 1: Send JWT in an HTTP-only cookie
    res.cookie("jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 3600000,
    }); // 1 hour
    res.redirect(process.env.CLIENT_SUCCESS_REDIRECT_URL); // Redirect to your main app page
  }
);

// Logout route (for cookie-based JWTs)
app.get("/auth/logout", (req, res) => {
  res.clearCookie("jwt"); // Clear the JWT cookie
  // If using passport sessions, you might also do req.logout() and req.session.destroy()
  res.redirect(process.env.CLIENT_FAILURE_REDIRECT_URL); // Redirect to login or home
});

const authorize = (req, res, next) => {
  const token = req.cookies.jwt;

  if (!token) {
    return res.status(401).json({ error: "No token, authorization denied" });
  }

  try {
    const decoded = jwt.decode(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    console.error("Token verification failed:", err);
    return res.status(403).json({ error: "Token is not valid" });
  }
};

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
      .slice(0, 5) // UNCOMMENTED THIS LINE to limit symbols
      .map((entry) => entry.symbol);
    console.log("[WebSocket] Loaded stock symbols:", stockSymbols);
  } catch (e) {
    console.error("[WebSocket] Error reading stockSymbols.json:", e);
  }

  try {
    cryptoSymbols = JSON.parse(fs.readFileSync("cryptoSymbols.json", "utf-8"))
      .slice(0, 5) // UNCOMMENTED THIS LINE to limit symbols
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
    } else if (data.type === "ping") {
      console.log("[WebSocket] Received Finnhub ping.");
    } else {
      console.log(`[WebSocket] Received other message type: ${data.type}`);
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

// --- API endpoints ---

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

// REMOVED: app.get("/history/:symbol", async (req, res) => { ... }); // Removed MongoDB history endpoint

app.post("/watchlist/add", authorize, async (req, res) => {
  const userID = req.userId;
  const { symbol } = req.body;

  if (!symbol) {
    return res.status(400).json({ error: "Symbol is required" });
  }

  try {
    await pool.query(
      "INSERT INTO watchlists (user_id, stock_symbol) VALUES ($1, $2) ON CONFLICT (user_id, stock_symbol) DO NOTHING",
      [userID, symbol]
    );
    console.log(`[Watchlist] ${symbol} added for user ${userID}.`);
    res.status(200).json({ message: `${symbol} added to watchlist` });
  } catch (err) {
    console.error(
      `[Watchlist] Error adding ${symbol} for user ${userID}:`,
      err
    );
    res.status(500).json({ error: "Failed to add to watchlist." });
  }
});

app.post("/watchlist/remove", authorize, async (req, res) => {
  const userID = req.userId;
  const { symbol } = req.body;

  if (!symbol) {
    return res.status(400).json({ error: "Symbol is required" });
  }

  try {
    await pool.query(
      "DELETE FROM watchlists WHERE user_id=$1 AND stock_symbol=$2",
      [userID, symbol]
    );
    console.log(`[Watchlist] ${symbol} removed for user ${userID}.`);
    res.status(200).json({ message: `${symbol} removed from watchlist` });
  } catch (err) {
    console.error(
      `[Watchlist] Error removing ${symbol} for user ${userID}:`,
      err
    );
    res.status(500).json({ error: "Failed to remove from watchlist." });
  }
});

app.get("/watchlist", authorize, async (req, res) => {
  const userID = req.userId;

  try {
    const result = await pool.query(
      "SELECT stock_symbol FROM watchlists WHERE user_id=$1",
      [userID]
    );

    const watchlistSymbols = result.rows.map((row) => row.stock_symbol);

    console.log(
      `[Watchlist] User ${userID} watchlist symbols:`,
      watchlistSymbols
    );

    const watchlistQuotes = [];

    for (const symbol of watchlistSymbols) {
      try {
        const cacheData = await redis.get(symbol);
        let quoteData;

        if (cacheData) {
          quoteData = JSON.parse(cacheData);
          console.log(`[Watchlist] Fetched ${symbol} from Redis cache.`);
        } else {
          quoteData = await fetchQuote(symbol);
          await redis.set(symbol, JSON.stringify(quoteData), "EX", 10);
          console.log(`[Watchlist] Fetched ${symbol} from Finnhub and cached.`);
        }

        watchlistQuotes.push({ symbol, ...quoteData });
      } catch (err) {
        console.error(`[Watchlist] Error fetching quote for ${symbol}:`, err);
        watchlistQuotes.push({
          symbol: symbol,
          price: "N/A",
          change: "N/A",
          change_percent: "N/A",
          open: "N/A",
          high: "N/A",
          low: "N/A",
          close_previous: "N/A",
        });
      }
    }

    res.status(200).json(watchlistQuotes);
  } catch (err) {
    console.error(
      `[Watchlist] Error fetching user ${userID}'s watchlist:`,
      err
    );
    res.status(500).json({ error: "Failed to retrieve watchlist" });
  }
});

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

      // REMOVED: MongoDB Save - This part is removed as requested
      // No longer saving to MongoDB
      // console.log(`[MongoDB] Saved quote for ${symbol}`); // Removed log
      // console.error(`[MongoDB] Error saving quote for ${symbol}:`, err); // Removed log

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
