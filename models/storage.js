const pg = require("pg");

const { Pool } = pg;

const pool = new Pool({
  user: "littlefinger",
  password: "icecream",
  host: "localhost",
  port: 5432,
  database: "stock_market_tracker",
});

module.exports = pool;
