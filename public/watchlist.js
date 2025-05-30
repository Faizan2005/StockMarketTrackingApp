const socket = io();

// Ensure stockTableBody correctly points to the table body in watchlist.html
// In watchlist.html, the tbody ID is 'watchlist-table-body'.
// If watchlist.js is meant to be the script for watchlist.html, it should target that ID.
const stockTableBody = document.getElementById("watchlist-table-body"); 

let userWatchlist = new Set(); // Start with an empty watchlist

// Extended Placeholder logos using clearbit.com for better coverage
// For production, consider a dedicated logo API like Financial Modeling Prep, Alpha Vantage, etc.
const logos = {
  // Existing major stocks
  AAPL: "https://logo.clearbit.com/apple.com",
  MSFT: "https://logo.clearbit.com/microsoft.com",
  AMZN: "https://logo.clearbit.com/amazon.com",
  TSLA: "https://logo.clearbit.com/tesla.com",
  META: "https://logo.clearbit.com/meta.com",
  NVDA: "https://logo.clearbit.com/nvidia.com",
  "BRK.A": "https://logo.clearbit.com/berkshirehathaway.com", // Note: BRK.A also covered by BRK/A in getLogo for PDF match
  JNJ: "https://logo.clearbit.com/jnj.com",
  WMT: "https://logo.clearbit.com/walmart.com",

  // Newly added prominent stocks from PDF
  XOM: "https://logo.clearbit.com/exxonmobil.com",
  GE: "https://logo.clearbit.com/ge.com",
  BP: "https://logo.clearbit.com/bp.com",
  C: "https://logo.clearbit.com/citigroup.com",
  PG: "https://logo.clearbit.com/pg.com",
  PFE: "https://logo.clearbit.com/pfizer.com",
  HBC: "https://logo.clearbit.com/hsbc.com",
  TM: "https://logo.clearbit.com/toyota.com",
  BAC: "https://logo.clearbit.com/bankofamerica.com",
  AIG: "https://logo.clearbit.com/aig.com",
  "BRK/A": "https://logo.clearbit.com/berkshirehathaway.com", // Handle the /A variant from PDF

  // Cryptocurrencies (aiming for coin logos)
  BTC: "https://logo.clearbit.com/bitcoin.org",
  ETH: "https://logo.clearbit.com/ethereum.org",
  DOGE: "https://logo.clearbit.com/dogecoin.com",
  USDT: "https://logo.clearbit.com/tether.to",
  XRP: "https://logo.clearbit.com/ripple.com",
  USDC: "https://logo.clearbit.com/centre.io", // USDC is from Centre Consortium
  BNB: "https://logo.clearbit.com/binance.com", // BNB is Binance's native coin, so clearbit.com/binance.com is appropriate
  ADA: "https://logo.clearbit.com/cardano.org",
  TRX: "https://logo.clearbit.com/tron.network",
  LINK: "https://logo.clearbit.com/chain.link",

  DEFAULT: "https://cdn-icons-png.flaticon.com/512/616/616408.png", // Generic stock icon fallback for non-crypto
  DEFAULT_CRYPTO: "https://logo.clearbit.com/bitcoin.org" // Default for undeclared cryptos
};

function getLogo(symbol) {
  const baseSymbol = symbol.split(":").pop().toUpperCase();
  const normalizedBaseSymbol = baseSymbol.replace(".A", "/A");

  // First, check for exact matches in the logos object
  if (logos[baseSymbol]) {
      return logos[baseSymbol];
  } else if (logos[normalizedBaseSymbol]) {
      return logos[normalizedBaseSymbol];
  }

  // Heuristic to determine if the symbol is likely a cryptocurrency
  // Check if it's one of the common crypto base symbols or if it came with an exchange prefix
  const knownCryptoBaseSymbols = new Set([
    "BTC", "ETH", "DOGE", "USDT", "XRP", "USDC", "BNB", "ADA", "TRX", "LINK",
    "LTC", "BCH", "SOL", "DOT", "MATIC", "AVAX", "SHIB", "XLM", "DOT", "UNI",
    "ICP", "DAI", "VET", "ETC", "FIL", "THETA", "EOS", "LEO", "XMR", "NEO"
  ]);
  const isCryptoCandidate = knownCryptoBaseSymbols.has(baseSymbol) || symbol.includes(":");

  if (isCryptoCandidate) {
      return logos.DEFAULT_CRYPTO; // Use Bitcoin logo as default for unknown crypto symbols
  }

  return logos.DEFAULT; // Fallback for stock symbols not found
}

function getDisplaySymbol(fullSymbol) {
  // Extracts the base symbol for display, e.g., "BINANCE:BTC" becomes "BTC"
  // or "NASDAQ:AAPL" becomes "AAPL".
  return fullSymbol.split(":").pop().toUpperCase();
}


function getChangeClass(change) {
  if (change === null || change === undefined || isNaN(change)) return "change-neutral";
  if (change > 0) return "change-positive";
  if (change < 0) return "change-negative";
  return "change-neutral";
}

// Store current stock data to update efficiently
const stockDisplayData = {};

// Function to check if a stock has "nil/zero" values
function hasNilValues(data) {
  const relevantKeys = ['price', 'change', 'change_percent', 'open', 'high', 'low', 'close_previous'];
  return relevantKeys.every(key => {
    const value = data[key];
    // Check for undefined, null, NaN, or 0
    return value === undefined || value === null || isNaN(value) || value === 0;
  });
}

// Function to check if a symbol is likely a cryptocurrency
function isCrypto(symbol) {
  const baseSymbol = symbol.split(":").pop().toUpperCase();
  const knownCryptoBaseSymbols = new Set([
    "BTC", "ETH", "DOGE", "USDT", "XRP", "USDC", "BNB", "ADA", "TRX", "LINK",
    "LTC", "BCH", "SOL", "DOT", "MATIC", "AVAX", "SHIB", "XLM", "DOT", "UNI",
    "ICP", "DAI", "VET", "ETC", "FIL", "THETA", "EOS", "LEO", "XMR", "NEO"
  ]);
  return knownCryptoBaseSymbols.has(baseSymbol) || symbol.includes(":");
}

// Sorting function for table rows
function sortStocks(a, b) {
  const aIsCrypto = isCrypto(a.symbol);
  const bIsCrypto = isCrypto(b.symbol);

  // 1. Sort by crypto vs non-crypto (non-crypto first)
  if (!aIsCrypto && bIsCrypto) {
    return -1; // a (non-crypto) comes before b (crypto)
  }
  if (aIsCrypto && !bIsCrypto) {
    return 1; // a (crypto) comes after b (non-crypto)
  }

  // If both are crypto or both are non-crypto
  if (aIsCrypto && bIsCrypto) {
    // 2. Within crypto, prioritize Bitcoin (BTC)
    if (getDisplaySymbol(a.symbol) === "BTC" && getDisplaySymbol(b.symbol) !== "BTC") {
      return -1;
    }
    if (getDisplaySymbol(a.symbol) !== "BTC" && getDisplaySymbol(b.symbol) === "BTC") {
      return 1;
    }
  }

  // 3. Then sort by "nil/zero" values (valid values first)
  const aHasNil = hasNilValues(a);
  const bHasNil = hasNilValues(b);

  if (aHasNil && !bHasNil) {
    return 1;
  }
  if (!aHasNil && bHasNil) {
    return -1;
  }

  // 4. Finally, sort alphabetically by display symbol
  return getDisplaySymbol(a.symbol).localeCompare(getDisplaySymbol(b.symbol));
}

// Function to render/re-render the entire table based on stockDisplayData
function renderTable() {
  let stocksArray = Object.values(stockDisplayData);

  // Filter to only show stocks that are actually in the user's watchlist
  // This is crucial for the watchlist page
  stocksArray = stocksArray.filter(stock => userWatchlist.has(stock.symbol));


  stocksArray.sort(sortStocks);

  // Clear existing table body efficiently
  while (stockTableBody.firstChild) {
      stockTableBody.removeChild(stockTableBody.firstChild);
  }

  // Re-populate the table
  stocksArray.forEach((stock, index) => {
    let row = document.createElement("tr"); // Always create a new row for re-rendering
    row.id = `stock-row-${stock.symbol}`;
    row.setAttribute("data-symbol", stock.symbol); // Keep full symbol in data-attribute for reference

    const displaySymbol = getDisplaySymbol(stock.symbol); // Get the cleaned symbol for display
    const isAddedToWatchlist = userWatchlist.has(stock.symbol);
    const watchlistEmojiClass = isAddedToWatchlist ? "added" : "not-added";

    // Prepare data for display
    const currentData = stockDisplayData[stock.symbol]; // Ensure we get the latest data
    
    // Check for null/undefined/NaN values before formatting
    const price = currentData.price !== undefined && currentData.price !== null && !isNaN(currentData.price) ? currentData.price.toFixed(2) : "N/A";
    const change = currentData.change !== undefined && currentData.change !== null && !isNaN(currentData.change) ? currentData.change.toFixed(2) : "N/A";
    const changePercent = currentData.change_percent !== undefined && currentData.change_percent !== null && !isNaN(currentData.change_percent) ? currentData.change_percent.toFixed(2) + "%" : "N/A";
    const open = currentData.open !== undefined && currentData.open !== null && !isNaN(currentData.open) ? currentData.open.toFixed(2) : "N/A";
    const high = currentData.high !== undefined && currentData.high !== null && !isNaN(currentData.high) ? currentData.high.toFixed(2) : "N/A";
    const low = currentData.low !== undefined && currentData.low !== null && !isNaN(currentData.low) ? currentData.low.toFixed(2) : "N/A";
    const prevClose = currentData.close_previous !== undefined && currentData.close_previous !== null && !isNaN(currentData.close_previous) ? currentData.close_previous.toFixed(2) : "N/A";

    // Determine change class directly for both change and percent cells
    const changeClass = getChangeClass(currentData.change);

    // Set innerHTML directly with the formatted values
    row.innerHTML = `
        <td><span class="watchlist-toggle-emoji ${watchlistEmojiClass}">&#x2714;</span></td>
        <td class="stock-index">${index + 1}</td>
        <td>
          <img src="${getLogo(stock.symbol)}" alt="${displaySymbol} logo" class="logo" />
          ${displaySymbol}
        </td>
        <td class="price-value">$<span>${price}</span></td>
        <td class="change-value-cell"><span class="${changeClass}">${change}</span></td>
        <td class="change-percent-cell"><span class="${changeClass}">${changePercent}</span></td>
        <td>$<span class="open-value">${open}</span></td>
        <td>$<span class="high-value">${high}</span></td>
        <td>$<span class="low-value">${low}</span></td>
        <td>$<span class="prevclose-value">${prevClose}</span></td>
      `;
    
    // Add event listener for the watchlist emoji
    const emojiSpan = row.querySelector(".watchlist-toggle-emoji");
    emojiSpan.addEventListener("click", () => toggleWatchlist(stock.symbol, emojiSpan));
    
    // Append the row to the table body after all its content is set
    stockTableBody.appendChild(row);
  });
}

// Function to toggle watchlist status - NOW CALLS BACKEND API
async function toggleWatchlist(symbol, emojiSpan) {
  const isCurrentlyInWatchlist = userWatchlist.has(symbol);
  const endpoint = isCurrentlyInWatchlist ? "/watchlist/remove" : "/watchlist/add";
  const method = "POST";

  try {
    const response = await fetch(endpoint, {
      method: method,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ symbol: symbol }),
    });

    if (response.ok) {
      if (isCurrentlyInWatchlist) {
        userWatchlist.delete(symbol);
        emojiSpan.classList.remove("added");
        emojiSpan.classList.add("not-added");
        console.log(`Successfully removed ${symbol} from watchlist`);
      } else {
        userWatchlist.add(symbol);
        emojiSpan.classList.remove("not-added");
        emojiSpan.classList.add("added");
        console.log(`Successfully added ${symbol} to watchlist`);
      }
      // Re-render the table to reflect the updated watchlist status for all symbols
      // On the watchlist page, this will filter to only show actual watchlist items
      renderTable(); 
    } else {
      const errorData = await response.json();
      console.error(`Failed to toggle watchlist for ${symbol}:`, errorData.error);
      alert(`Error: ${errorData.error || "Could not update watchlist."}`);
    }
  } catch (error) {
    console.error(`Network error toggling watchlist for ${symbol}:`, error);
    alert("A network error occurred. Could not update watchlist.");
  }
}

// Function to fetch initial watchlist from the backend
async function fetchWatchlist() {
  try {
    const response = await fetch("/watchlist");
    if (response.ok) {
      const watchlistQuotes = await response.json();
      // Populate userWatchlist Set with symbols from the fetched watchlist
      userWatchlist = new Set(watchlistQuotes.map(item => item.symbol));
      console.log("Initial watchlist fetched:", userWatchlist);

      // Populate stockDisplayData with initial watchlist quotes
      watchlistQuotes.forEach(quote => {
        stockDisplayData[quote.symbol] = quote;
      });

      renderTable(); // Render the table with initial watchlist data and correct checkmarks
    } else {
      const errorData = await response.json();
      console.error("Failed to fetch initial watchlist:", errorData.error);
      // Optionally, alert the user or show a message
    }
  } catch (error) {
    console.error("Network error fetching initial watchlist:", error);
    // Optionally, alert the user or show a message
  }
}

// Removed watchlistButton event listener as it belongs to index.html's script.
// Removed searchInput variable and its event listener as it belongs to index.html's script.

// Socket.IO listener for quote updates
socket.on("quoteUpdate", (quote) => {
    console.log("Received quote:", quote);
    if (quote && quote.symbol && userWatchlist.has(quote.symbol)) { // Only update if symbol is in watchlist
        stockDisplayData[quote.symbol] = { ...stockDisplayData[quote.symbol], ...quote };
        renderTable(); // Re-render table on every quote update
    }
});

// Call fetchWatchlist when the page loads to initialize the userWatchlist
document.addEventListener("DOMContentLoaded", fetchWatchlist);