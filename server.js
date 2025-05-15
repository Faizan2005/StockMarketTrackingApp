require("dotenv").config();
const express = require("express");
const WebSocket = require("ws");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const finnhub = require("finnhub");
const fs = require("fs");
const { timeStamp } = require("console");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Refresh every 24 hrs = 24 * 60 * 60 * 1000 ms
const DAY_MS = 86400000;

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const FINNHUB_API_URL = `wss://ws.finnhub.io?token=${FINNHUB_API_KEY}`;
console.log("Establishing connection with:", FINNHUB_API_URL);

// WebSocket connection to Finnhub
const socket = new WebSocket(FINNHUB_API_URL);

// Serve static frontend files
app.use(express.static(path.join(__dirname, "public")));

const api_key = finnhub.ApiClient.instance.authentications["api_key"];
api_key.apiKey = FINNHUB_API_KEY;
const finnhubClient = new finnhub.DefaultApi();

// Check timestamps and conditionally fetch new data
const now = Date.now();
let lastStockTimestamp = 0;

try {
  lastStockTimestamp = JSON.parse(fs.readFileSync("stockTimestamp.json", "utf-8"));
} catch (e) {
  console.warn("stockTimestamp.json not found or invalid, fetching data...");
}

if (shouldFetch('timestamp.json')) {
  console.log("Fetching fresh stock and crypto symbols...");

  // Promisify the fetches to wait for both
  const fetchStock = new Promise((resolve, reject) => {
    finnhubClient.stockSymbols("US", (err, data) => {
      if (err) return reject("Stock fetch error: " + err);
      saveToFile("stockSymbols.json", data);
      resolve();
    });
  });

  const fetchCrypto = new Promise((resolve, reject) => {
    finnhubClient.cryptoSymbols("BINANCE", (err, data) => {
      if (err) return reject("Crypto fetch error: " + err);
      saveToFile("cryptoSymbols.json", data);
      resolve();
    });
  });

  Promise.all([fetchStock, fetchCrypto])
    .then(() => {
      saveToFile("timestamp.json", Date.now());
    })
    .catch((err) => {
      console.error("Error during data fetch:", err);
    });
}

function saveToFile(fileName, data) {
  fs.writeFileSync(fileName, JSON.stringify(data, null, 2));
  console.log(`${fileName} saved. Total ${data.length ?? "?"}`);
}

function shouldFetch(fileName) {
    try{
        const timeStamp = JSON.parse(fs.readFileSync(fileName, 'utf-8'))
        return Date.now() - timeStamp >= DAY_MS
    } catch {
    return true; // File doesn't exist or is invalid
  }
}

// When WebSocket connection opens
socket.on("open", () => {
  console.log("WebSocket connected to Finnhub");

  // Load symbols from JSON
  let stockSymbols = [];
  let cryptoSymbols = [];

  try {
    stockSymbols = JSON.parse(fs.readFileSync("stockSymbols.json", "utf-8"))
      .slice(0, 5) // Limit for testing; remove in prod
      .map((entry) => entry.symbol);
  } catch (e) {
    console.error("Error reading stockSymbols.json:", e);
  }

  try {
    cryptoSymbols = JSON.parse(fs.readFileSync("cryptoSymbols.json", "utf-8"))
      .slice(0, 5)
      .map((entry) => `BINANCE:${entry.symbol}`);
  } catch (e) {
    console.error("Error reading cryptoSymbols.json:", e);
  }

  const allSymbols = [...stockSymbols, ...cryptoSymbols];
  allSymbols.forEach((symbol) => {
    socket.send(JSON.stringify({ type: "subscribe", symbol }));
    console.log("Subscribed to:", symbol);
  });
});

// On incoming WebSocket messages
socket.on("message", (msg) => {
  console.log("Received from Finnhub:", msg); 
  try {
    const data = JSON.parse(msg);
    if (data.type === "trade") {
      io.emit("stockData", data);
    }
  } catch (err) {
    console.error("Error parsing message:", err);
  }
});

socket.on("error", (err) => {
  console.error("WebSocket error:", err.message);
});

socket.on("close", (code, reason) => {
  console.warn(`WebSocket closed. Code: ${code}, Reason: ${reason}`);
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log("Server listening on:", PORT);
  console.log(`http://localhost:${PORT}`);
});
