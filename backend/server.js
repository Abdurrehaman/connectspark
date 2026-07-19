require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize PostgreSQL (Supabase)
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

db.connect()
  .then(() => console.log('Connected to Supabase PostgreSQL ✅'))
  .catch(err => console.error('Database connection error:', err.message));

// Initialize Razorpay
// Note: In production, these should be real keys in a .env file.
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_mock_key',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'rzp_test_mock_secret',
});

// Payment Endpoints
app.post('/api/create-order', async (req, res) => {
  const { amount } = req.body; // Amount in INR
  
  if (!amount || amount * 100 < 100) {
    return res.status(400).json({ error: "Minimum amount is ₹1 (100 paise)" });
  }

  try {
    const options = {
      amount: Math.round(amount * 100), // Convert to paise
      currency: "INR",
      receipt: "receipt_" + Date.now(),
    };
    const order = await razorpay.orders.create(options);
    res.json({ order_id: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    console.error("Payment Order Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/verify-payment', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, message: "Missing required payment fields" });
  }
  
  const sign = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSign = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(sign)
    .digest("hex");

  if (razorpay_signature === expectedSign) {
    return res.json({ success: true, message: "Payment verified successfully" });
  } else {
    return res.status(400).json({ success: false, message: "Signature mismatch — payment not verified" });
  }
});

app.get('/api/wallet/balance/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: "No user ID" });
  
  try {
    const result = await db.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
    if (result.rows.length === 0) {
      await db.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING', [userId]);
      return res.json({ balance: 0 });
    }
    res.json({ balance: result.rows[0].balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wallet/verify-funds', async (req, res) => {
  const { userId, amount, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  const sign = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSign = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(sign).digest("hex");

  if (razorpay_signature !== expectedSign) {
    return res.status(400).json({ success: false, message: "Invalid signature" });
  }

  try {
    await db.query(
      `INSERT INTO wallets (user_id, balance) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET balance = wallets.balance + $2, updated_at = NOW()`,
      [userId, amount]
    );
    res.json({ success: true, added: amount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/wallet/deduct', async (req, res) => {
  const { userId, amount } = req.body;
  
  try {
    const result = await db.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
    const currentBalance = result.rows.length > 0 ? result.rows[0].balance : 0;
    
    if (currentBalance < amount) {
      return res.status(400).json({ success: false, message: "Insufficient Prime Balance" });
    }
    await db.query(
      'UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2',
      [amount, userId]
    );
    res.json({ success: true, newBalance: currentBalance - amount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const queues = {
  'soul_search': [],
  'flirt': [],
  'after_hours': [],
  'global': []
};

const DARE_CARDS = [
  { text: "Show the weirdest thing in your room right now!" },
  { text: "Do your best celebrity impression!" },
  { text: "Sing the first line of any song!" },
  { text: "Show us your best dance move!" },
  { text: "Tell us the most embarrassing thing that happened to you this week." },
  { text: "Do 5 push-ups on camera!" },
  { text: "Show your phone's most recent photo (no deleting allowed!)" },
  { text: "Speak in an accent for the next 2 minutes!" },
];

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
  ],
  'global': [
    { text: "What's one thing your country does better than anywhere else?", answers: ["The food — nothing beats home cooking!", "The hospitality — strangers become friends fast.", "The festivals — nothing compares to our celebrations!"] },
    { text: "What is one thing you wish people knew about your culture?", answers: ["We're much more open-minded than stereotypes suggest.", "Family is everything — it shapes who we are.", "Our music and art are world class, just underrated globally."] }
  ]
};

const connectedUsers = new Map();

const broadcastOnlineCount = () => {
  const total = connectedUsers.size;
  const vibes = {};
  connectedUsers.forEach(u => {
    if (u.vibe) vibes[u.vibe] = (vibes[u.vibe] || 0) + 1;
  });
  io.emit('online_count', { total, vibes });
};

const getRandomIcebreaker = (vibe) => {
  const list = icebreakers[vibe] || icebreakers['flirt'];
  return list[Math.floor(Math.random() * list.length)];
};

const getRandomDare = () => DARE_CARDS[Math.floor(Math.random() * DARE_CARDS.length)];

const tryMatch = (queue, socket, userData) => {
  // Try tag-based match first
  const tagIdx = queue.findIndex(id => {
    const u = connectedUsers.get(id);
    return u && userData.tags && u.tags && userData.tags.some(t => u.tags.includes(t));
  });
  const idx = tagIdx >= 0 ? tagIdx : 0;
  return queue.splice(idx, 1)[0];
};

io.on('connection', async (socket) => {
  const userIp = socket.handshake.address;

  // Check if banned
  try {
    const banResult = await db.query('SELECT ip FROM bans WHERE ip = $1', [userIp]);
    if (banResult.rows.length > 0) {
      socket.emit('banned', { message: "You are banned from the platform." });
      socket.disconnect(true);
      return;
    }
  } catch (err) {
    console.error('Ban check error:', err.message);
  }

  connectedUsers.set(socket.id, { currentPartner: null, vibe: null, spark: false, ip: userIp, gender: null, tags: [], country: null, dareTimer: null });
  broadcastOnlineCount();

  socket.on('join_queue', ({ vibe, gender, tags, country, userId }) => {
    const user = connectedUsers.get(socket.id);
    if (!user || user.currentPartner) return;

    user.vibe = vibe;
    user.gender = gender;
    user.tags = tags || [];
    user.country = country || null;
    user.spark = false;

    const queue = queues[vibe];
    if (!queue) return;

    if (queue.length > 0) {
      // For global mode: prefer different country
      let partnerSocketId;
      if (vibe === 'global') {
        const diffIdx = queue.findIndex(id => {
          const u = connectedUsers.get(id);
          return u && u.country !== country;
        });
        partnerSocketId = diffIdx >= 0 ? queue.splice(diffIdx, 1)[0] : queue.shift();
      } else {
        partnerSocketId = tryMatch(queue, socket, user);
      }

      if (io.sockets.sockets.get(partnerSocketId)) {
        const partner = connectedUsers.get(partnerSocketId);
        user.currentPartner = partnerSocketId;
        partner.currentPartner = socket.id;

        socket.emit('matched', { partnerId: partnerSocketId, partnerGender: partner.gender, partnerTags: partner.tags, partnerCountry: partner.country ? { code: partner.country } : null });
        io.to(partnerSocketId).emit('matched', { partnerId: socket.id, partnerGender: user.gender, partnerTags: user.tags, partnerCountry: user.country ? { code: user.country } : null });

        // Send icebreaker after 3s
        setTimeout(() => {
          const icebreaker = getRandomIcebreaker(vibe);
          socket.emit('icebreaker', icebreaker);
          io.to(partnerSocketId).emit('icebreaker', icebreaker);
        }, 3000);

        // Send dare card every 90s
        const sendDare = () => {
          if (user.currentPartner === partnerSocketId) {
            const dare = getRandomDare();
            socket.emit('dare_card', dare);
            io.to(partnerSocketId).emit('dare_card', dare);
            user.dareTimer = setTimeout(sendDare, 90000);
          }
        };
        user.dareTimer = setTimeout(sendDare, 90000);
      } else {
        queue.push(socket.id);
      }
    } else {
      if (!queue.includes(socket.id)) queue.push(socket.id);
    }
    broadcastOnlineCount();
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

  socket.on('send_gift', ({ gift }) => {
    const user = connectedUsers.get(socket.id);
    if (user && user.currentPartner) {
      io.to(user.currentPartner).emit('gift_received', { gift });
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
    
    db.query(`SELECT balance FROM wallets WHERE user_id = $1`, [userId]).then(res => {
      const row = res.rows[0];
      const currentBalance = row ? row.balance : 0;
      if (currentBalance >= amount) {
        db.query(`UPDATE wallets SET balance = balance - $1 WHERE user_id = $2`, [amount, userId]).then(() => {
          callback({ success: true, newBalance: currentBalance - amount });
        }).catch(() => callback({ success: false, message: "Transaction failed" }));
      } else {
        callback({ success: false, message: "Insufficient Prime Balance" });
      }
    }).catch(() => callback({ success: false, message: "Database error" }));
  });

  const handleDisconnect = () => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    if (user.dareTimer) clearTimeout(user.dareTimer);

    if (user.vibe && queues[user.vibe]) {
      queues[user.vibe] = queues[user.vibe].filter(id => id !== socket.id);
    }

    if (user.currentPartner) {
      io.to(user.currentPartner).emit('partner_disconnected');
      const partnerUser = connectedUsers.get(user.currentPartner);
      if (partnerUser) { partnerUser.currentPartner = null; partnerUser.spark = false; }
    }

    connectedUsers.delete(socket.id);
    broadcastOnlineCount();
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

  socket.on('report', async (data) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.currentPartner) return;

    const reportedUser = connectedUsers.get(user.currentPartner);
    if (!reportedUser) return;

    const reportedIp = reportedUser.ip;
    const reporterIp = user.ip;

    try {
      await db.query(
        'INSERT INTO reports (reported_ip, reporter_ip, reason) VALUES ($1, $2, $3)',
        [reportedIp, reporterIp, data.reason]
      );

      const countResult = await db.query(
        'SELECT COUNT(*) as count FROM reports WHERE reported_ip = $1',
        [reportedIp]
      );

      if (parseInt(countResult.rows[0].count) >= 3) {
        await db.query('INSERT INTO bans (ip) VALUES ($1) ON CONFLICT (ip) DO NOTHING', [reportedIp]);
        console.log(`[BAN] IP ${reportedIp} permanently banned.`);
        io.to(user.currentPartner).emit('banned', { message: "You have been banned for multiple reports." });
        io.sockets.sockets.get(user.currentPartner)?.disconnect(true);
      }
    } catch (err) {
      console.error('Report error:', err.message);
    }
  });

  socket.on('disconnect', () => {
    handleDisconnect();
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`ConnectSpark backend running on port ${PORT} 🚀`);
});
