const mongoose = require("mongoose");

const quoteSchema = new mongoose.Schema({
  symbol: String,
  price: Number,
  open: Number,
  high: Number,
  low: Number,
  close_previous: Number,
  change: Number,
  change_percent: Number,
  timeStamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Quote", quoteSchema);
