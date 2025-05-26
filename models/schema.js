const mongoose = require("mongoose");

const quoteSchema = new mongoose.Schema({
  symbol: String,
  open: Number,
  high: Number,
  low: Number,
  close: Number,
  prevClose: Number,
  change: Number,
  percentChange: Number,
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Quote", quoteSchema);
