const e = require("express");
const { createClient } = require("redis");
const { connect } = require("socket.io-client");

const redis = createClient();

redis.on("error", (err) => {
  console.error("Redis Client Error", err);
});

async function connectRedis() {
  await redis.connect();
  console.log("Redis connected");
}

connectRedis();

module.exports = redis;
