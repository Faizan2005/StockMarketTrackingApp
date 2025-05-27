const mongoose = require("mongoose");
const mongoURI = "mongodb+srv://Faizan2005:icecream@cluster0.dtvmwqy.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

const connectDB = async () => {
  try {
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    //   serverSelectionTimeoutMS: 20000, // Increase timeout to 20 seconds
    //   socketTimeoutMS: 45000, // Increase socket timeout to 45 seconds
    });
    console.log("[MongoDB] Connected successfully.");
  } catch (error) {
    console.error("[MongoDB] Connection error:", error);
    throw error;
  }
};

module.exports = connectDB;
