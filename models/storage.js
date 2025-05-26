const mongoose = require("mongoose");
const mongoURI =
  "mongodb+srv://Faizan2005:Iitjee2023@@cluster0.dtvmwqy.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

const ConnectDB = async () => {
  try {
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("Successfully connected to database...");
  } catch (err) {
    console.log("Error connecting to database: ", err);
  }
};

module.exports = ConnectDB;
