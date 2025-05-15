const { io } = require("socket.io-client");

const socket = io("http://localhost:3000");
const stocksDiv = document.getElementById("stocks");
const stocks = {};

socket.on("stockData", (data) => {
  data.forEach(({ s, p, t, v }) => {
    const time = new Date(t).toLocaleTimeString();
    stocks[s] = `
      <div class="stock">
        <strong>${s}</strong><br>
        Price: $${p}<br>
        Volume: ${v}<br>
        Time: ${time}
      </div>
    `;
  });

  stocksDiv.innerHTML = Object.values(stocks).join("");
});
