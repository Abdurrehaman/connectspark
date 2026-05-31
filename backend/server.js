require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const Razorpay = require('razorpay');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize SQLite Database
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error('Error connecting to SQLite:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    
    // Create tables
    db.run(`CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reported_ip TEXT,
      reporter_ip TEXT,
      reason TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT UNIQUE,
      banned_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS wallets (
      user_id TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0
    )`);
  }
});

// Initialize Razorpay
// Note: In production, these should be real keys in a .env file.
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_mock_key',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'rzp_test_mock_secret',
});

// Payment Endpoints
app.post('/api/create-order', async (req, res) => {
  const { amount } = req.body; // Amount in INR (e.g. 2 for ₹2, 20 for ₹20)
  
  try {
    const options = {
      amount: amount * 100, // Razorpay takes amount in paise (1 INR = 100 paise)
      currency: "INR",
      receipt: "receipt_order_" + Date.now(),
    };
    
    // Since we are mocking if keys are not real, we will return a mock order if it fails
    if (razorpay.key_id === 'rzp_test_mock_key') {
      return res.json({ id: "order_mock_" + Date.now(), amount: options.amount, currency: "INR" });
    }
    
    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (err) {
    console.error("Payment Order Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/verify-payment', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  
  if (razorpay.key_id === 'rzp_test_mock_key') {
    // Always succeed in mock mode
    return res.json({ success: true });
  }
  
  const sign = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSign = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(sign.toString())
    .digest("hex");

  if (razorpay_signature === expectedSign) {
    return res.json({ success: true, message: "Payment verified successfully" });
  } else {
    return res.status(400).json({ success: false, message: "Invalid signature" });
  }
});

app.get('/api/wallet/balance/:userId', (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: "No user ID" });
  
  db.get(`SELECT balance FROM wallets WHERE user_id = ?`, [userId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) {
      // Create wallet if it doesn't exist
      db.run(`INSERT INTO wallets (user_id, balance) VALUES (?, ?)`, [userId, 0]);
      return res.json({ balance: 0 });
    }
    res.json({ balance: row.balance });
  });
});

app.post('/api/wallet/verify-funds', (req, res) => {
  const { userId, amount, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  
  // Quick mock verify
  let success = false;
  if (razorpay.key_id === 'rzp_test_mock_key') {
    success = true;
  } else {
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(sign.toString()).digest("hex");
    success = (razorpay_signature === expectedSign);
  }

  if (success) {
    // Add funds
    db.run(`INSERT INTO wallets (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?`, 
      [userId, amount, amount], 
      (err) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, added: amount });
      }
    );
  } else {
    res.status(400).json({ success: false, message: "Invalid signature" });
  }
});

app.post('/api/wallet/deduct', (req, res) => {
  const { userId, amount } = req.body;
  
  db.get(`SELECT balance FROM wallets WHERE user_id = ?`, [userId], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: "Database error" });
    
    const currentBalance = row ? row.balance : 0;
    if (currentBalance >= amount) {
      db.run(`UPDATE wallets SET balance = balance - ? WHERE user_id = ?`, [amount, userId], function(err) {
        if (err) return res.status(500).json({ success: false, message: "Transaction failed" });
        res.json({ success: true, newBalance: currentBalance - amount });
      });
    } else {
      res.status(400).json({ success: false, message: "Insufficient Prime Balance" });
    }
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const queues = {
  'soul_search': [],
  'flirt': [],
  'after_hours': []
};

// ... [Keep Icebreakers exactly the same]
const icebreakers = {
  'soul_search': [
    { text: "What's a life lesson you learned the hard way?", answers: ["That you can't pour from an empty cup—self-care isn't selfish.", "Not everyone who smiles at you is your friend.", "Sometimes, peace is better than being right."] },
    { text: "If you could have dinner with any historical figure, who would it be?", answers: ["Leonardo da Vinci, just to see how his brain worked.", "Cleopatra, to learn the art of charm and strategy.", "Albert Einstein, to discuss the mysteries of the universe."] }
  ],
  'flirt': [
    { text: "What's the most spontaneous thing you've ever done?", answers: ["Booked a flight to a random city at 2 AM.", "Got a tattoo on a dare.", "Walked up to a stranger and asked them out on the spot."] },
    { text: "What's your biggest dealbreaker on a first date?", answers: ["Being rude to the waiter. Instant turn-off.", "Spending the entire time on their phone.", "Only talking about their ex."] }
  ],
  'after_hours': [
    { text: "What's a secret fantasy you've never told anyone?", answers: ["Getting caught doing something risky in public.", "A weekend getaway with zero inhibitions and no rules.", "Roleplaying a complete stranger in a fancy hotel bar."] },
    { text: "What's your biggest guilty pleasure?", answers: ["Binge-watching trashy reality TV all night.", "Eating a whole tub of ice cream in bed.", "Listening to 2000s boy bands unironically."] }
  ]
};

const connectedUsers = new Map(); 

const getRandomIcebreaker = (vibe) => {
  const list = icebreakers[vibe] || icebreakers['flirt'];
  return list[Math.floor(Math.random() * list.length)];
};

io.on('connection', (socket) => {
  const userIp = socket.handshake.address;

  // Check if banned
  db.get(`SELECT ip FROM bans WHERE ip = ?`, [userIp], (err, row) => {
    if (row) {
      socket.emit('banned', { message: "You are banned from the platform." });
      socket.disconnect(true);
    }
  });

  connectedUsers.set(socket.id, { currentPartner: null, vibe: null, spark: false, ip: userIp });

  socket.on('join_queue', ({ vibe, isSuperSpark }) => {
    const user = connectedUsers.get(socket.id);
    if (!user || user.currentPartner) return; 

    user.vibe = vibe;
    user.spark = false; 
    
    const queue = queues[vibe];
    if (!queue) return; 

    if (queue.length > 0) {
      const partnerSocketId = queue.shift();
      
      if (io.sockets.sockets.get(partnerSocketId)) {
        const partner = connectedUsers.get(partnerSocketId);
        user.currentPartner = partnerSocketId;
        partner.currentPartner = socket.id;

        socket.emit('matched', { partnerId: partnerSocketId });
        io.to(partnerSocketId).emit('matched', { partnerId: socket.id });

        setTimeout(() => {
          const icebreaker = getRandomIcebreaker(vibe);
          socket.emit('icebreaker', icebreaker);
          io.to(partnerSocketId).emit('icebreaker', icebreaker);
        }, 3000);

      } else {
        // partner disconnected, put them back
        queue.push(socket.id);
      }
    } else {
      if (!queue.includes(socket.id)) {
        if (isSuperSpark) {
          // Priority! Push to front of the line
          queue.unshift(socket.id);
        } else {
          queue.push(socket.id);
        }
      }
    }
  });

  socket.on('spark', () => {
    const user = connectedUsers.get(socket.id);
    if (user && user.currentPartner) {
      user.spark = true;
      const partner = connectedUsers.get(user.currentPartner);
      
      if (partner && partner.spark) {
        socket.emit('mutual_spark');
        io.to(user.currentPartner).emit('mutual_spark');
      }
    }
  });

  socket.on('sendMessage', (data) => {
    const user = connectedUsers.get(socket.id);
    if (user && user.currentPartner) {
      io.to(user.currentPartner).emit('receiveMessage', {
        message: data.message,
        senderId: socket.id
      });
    }
  });

  socket.on('offer', (data) => {
    const user = connectedUsers.get(socket.id);
    if (user && user.currentPartner) {
      io.to(user.currentPartner).emit('offer', data);
    }
  });

  socket.on('answer', (data) => {
    const user = connectedUsers.get(socket.id);
    if (user && user.currentPartner) {
      io.to(user.currentPartner).emit('answer', data);
    }
  });

  socket.on('ice_candidate', (data) => {
    const user = connectedUsers.get(socket.id);
    if (user && user.currentPartner) {
      io.to(user.currentPartner).emit('ice_candidate', data);
    }
  });

  socket.on('deduct_balance', (data, callback) => {
    const { userId, amount, feature } = data;
    
    db.get(`SELECT balance FROM wallets WHERE user_id = ?`, [userId], (err, row) => {
      if (err) return callback({ success: false, message: "Database error" });
      
      const currentBalance = row ? row.balance : 0;
      if (currentBalance >= amount) {
        db.run(`UPDATE wallets SET balance = balance - ? WHERE user_id = ?`, [amount, userId], function(err) {
          if (err) return callback({ success: false, message: "Transaction failed" });
          callback({ success: true, newBalance: currentBalance - amount });
        });
      } else {
        callback({ success: false, message: "Insufficient Prime Balance" });
      }
    });
  });

  const handleDisconnect = () => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    if (user.vibe && queues[user.vibe]) {
      queues[user.vibe] = queues[user.vibe].filter(id => id !== socket.id);
    }

    if (user.currentPartner) {
      const partnerId = user.currentPartner;
      io.to(partnerId).emit('partner_disconnected');
      
      const partnerUser = connectedUsers.get(partnerId);
      if (partnerUser) {
        partnerUser.currentPartner = null;
        partnerUser.spark = false;
      }
    }
    
    connectedUsers.delete(socket.id);
  };

  socket.on('next', () => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;
    
    const previousVibe = user.vibe;
    handleDisconnect();
    
    connectedUsers.set(socket.id, { currentPartner: null, vibe: previousVibe, spark: false, ip: user.ip });
    if (previousVibe && queues[previousVibe]) {
       queues[previousVibe].push(socket.id);
    }
  });

  socket.on('report', (data) => {
      const user = connectedUsers.get(socket.id);
      if (!user || !user.currentPartner) return;
      
      const reportedUser = connectedUsers.get(user.currentPartner);
      if (!reportedUser) return;

      const reportedIp = reportedUser.ip;
      const reporterIp = user.ip;

      // Log report in DB
      db.run(`INSERT INTO reports (reported_ip, reporter_ip, reason) VALUES (?, ?, ?)`, 
        [reportedIp, reporterIp, data.reason], 
        function(err) {
          if (err) return console.error(err);
          
          // Check if they reached the ban threshold (3 reports)
          db.get(`SELECT COUNT(*) as count FROM reports WHERE reported_ip = ?`, [reportedIp], (err, row) => {
            if (row && row.count >= 3) {
              db.run(`INSERT OR IGNORE INTO bans (ip) VALUES (?)`, [reportedIp], (err) => {
                if (!err) {
                  console.log(`[BAN] IP ${reportedIp} has been permanently banned.`);
                  // Disconnect them immediately
                  io.to(user.currentPartner).emit('banned', { message: "You have been banned for multiple reports." });
                  io.sockets.sockets.get(user.currentPartner)?.disconnect(true);
                }
              });
            }
          });
        }
      );
  });

  socket.on('disconnect', () => {
    handleDisconnect();
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
