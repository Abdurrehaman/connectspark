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

// ── DATABASE ──────────────────────────────────────────────────────────────────
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
db.connect()
  .then(() => console.log('✅ Connected to PostgreSQL'))
  .catch(err => console.error('❌ Database error:', err.message));

// ── RAZORPAY ──────────────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── SPARK PACKAGES ────────────────────────────────────────────────────────────
// Amount in INR, sparks credited on successful payment
const SPARK_PACKAGES = {
  starter: { amount: 49,  sparks: 50,  label: 'Starter' },
  popular: { amount: 99,  sparks: 130, label: 'Popular'  },
  pro:     { amount: 199, sparks: 300, label: 'Pro'       },
};

// ── TURN SERVER ────────────────────────────────────────────────────────────────
// Returns ICE servers for WebRTC — add TURN_* env vars for global relay support
app.get('/api/turn-credentials', async (req, res) => {
  let iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  // Fetch from Metered.ca dynamically
  try {
    if (process.env.METERED_API_KEY && process.env.METERED_DOMAIN) {
      // NOTE: Using native Node fetch or axios here since axios is in package.json
      const axios = require('axios');
      const response = await axios.get(`https://${process.env.METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${process.env.METERED_API_KEY}`);
      if (Array.isArray(response.data)) {
        iceServers = response.data; // Metered returns the full array including STUN/TURN
      }
    }
  } catch (err) {
    console.error('Error fetching TURN credentials from Metered:', err.message);
  }
  res.json({ iceServers });
});

// ── STEP 1: CREATE ORDER ───────────────────────────────────────────────────────
// Frontend sends: { package: 'starter' | 'popular' | 'pro' }
// Backend creates Razorpay order and returns order_id + package details
app.post('/api/create-order', async (req, res) => {
  const { package: pkg } = req.body;
  const packageData = SPARK_PACKAGES[pkg];

  if (!packageData) {
    return res.status(400).json({ error: 'Invalid package. Choose starter, popular, or pro.' });
  }

  try {
    const order = await razorpay.orders.create({
      amount: packageData.amount * 100, // Convert INR to paise
      currency: 'INR',
      receipt: `spark_${pkg}_${Date.now()}`,
      notes: { package: pkg, sparks: packageData.sparks },
    });

    res.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      package: pkg,
      sparks: packageData.sparks,
      label: packageData.label,
    });
  } catch (err) {
    console.error('❌ Create order error:', err);
    res.status(500).json({ error: err.error?.description || err.message || 'Failed to create order' });
  }
});

// ── STEP 2: VERIFY PAYMENT + CREDIT SPARKS ────────────────────────────────────
// Frontend sends: { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, package }
// Backend: verifies HMAC → credits Sparks → returns new balance
app.post('/api/verify-payment', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, package: pkg } = req.body;

  // Validate fields
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !userId || !pkg) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  // Validate package
  const packageData = SPARK_PACKAGES[pkg];
  if (!packageData) {
    return res.status(400).json({ success: false, message: 'Invalid package' });
  }

  // ✅ HMAC-SHA256 Signature Verification
  // This is the ONLY way to confirm the payment is real and not faked
  const sign = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSign = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(sign)
    .digest('hex');

  if (razorpay_signature !== expectedSign) {
    console.warn(`⚠️  Signature mismatch for user ${userId} — possible fraud attempt`);
    return res.status(400).json({ success: false, message: 'Payment signature mismatch — not verified' });
  }

  // ✅ Signature valid — credit Sparks atomically
  try {
    const result = await db.query(
      `INSERT INTO wallets (user_id, balance)
       VALUES ($1, $2)
       ON CONFLICT (user_id)
       DO UPDATE SET balance = wallets.balance + $2, updated_at = NOW()
       RETURNING balance`,
      [userId, packageData.sparks]
    );

    const newBalance = result.rows[0].balance;
    console.log(`✅ Credited ${packageData.sparks} Sparks to ${userId} — new balance: ${newBalance}`);

    res.json({
      success: true,
      message: `${packageData.sparks} Sparks added successfully!`,
      sparks_added: packageData.sparks,
      new_balance: newBalance,
    });
  } catch (err) {
    console.error('❌ Credit Sparks error:', err);
    res.status(500).json({ success: false, message: 'Payment verified but failed to credit Sparks. Contact support.' });
  }
});

// ── GET SPARK BALANCE ──────────────────────────────────────────────────────────
app.get('/api/sparks/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: 'No user ID' });

  try {
    const result = await db.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
    if (result.rows.length === 0) {
      await db.query(
        'INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING',
        [userId]
      );
      return res.json({ sparks: 0 });
    }
    res.json({ sparks: result.rows[0].balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DEDUCT SPARKS ─────────────────────────────────────────────────────────────
// Frontend sends: { userId, sparks, reason }
app.post('/api/sparks/deduct', async (req, res) => {
  const { userId, sparks, reason } = req.body;
  if (!userId || !sparks || sparks < 1) {
    return res.status(400).json({ success: false, message: 'Invalid deduct request' });
  }

  try {
    const current = await db.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
    const balance = current.rows.length > 0 ? current.rows[0].balance : 0;

    if (balance < sparks) {
      return res.status(400).json({ success: false, message: 'Not enough Sparks', balance });
    }

    const updated = await db.query(
      'UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2 RETURNING balance',
      [sparks, userId]
    );

    console.log(`⚡ Deducted ${sparks} Sparks from ${userId} for ${reason || 'unknown'}`);
    res.json({ success: true, new_balance: updated.rows[0].balance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PROFILES ──────────────────────────────────────────────────────────────────
app.post('/api/profiles', async (req, res) => {
  const { userId, screenName } = req.body;
  if (!userId || !screenName) return res.status(400).json({ success: false, message: 'Invalid profile data' });
  try {
    await db.query(
      'INSERT INTO profiles (user_id, screen_name) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET screen_name = $2',
      [userId, screenName]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/profiles/:userId', async (req, res) => {
  try {
    const result = await db.query('SELECT screen_name FROM profiles WHERE user_id = $1', [req.params.userId]);
    res.json({ screenName: result.rows.length > 0 ? result.rows[0].screen_name : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── FRIENDS & INBOX ───────────────────────────────────────────────────────────
app.get('/api/friends/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await db.query(`
      SELECT 
        CASE WHEN f.user_id_1 = $1 THEN f.user_id_2 ELSE f.user_id_1 END as friend_id,
        p.screen_name
      FROM friends f
      JOIN profiles p ON p.user_id = (CASE WHEN f.user_id_1 = $1 THEN f.user_id_2 ELSE f.user_id_1 END)
      WHERE f.user_id_1 = $1 OR f.user_id_2 = $1
    `, [userId]);
    res.json({ friends: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages/:userId/:friendId', async (req, res) => {
  try {
    const { userId, friendId } = req.params;
    const result = await db.query(`
      SELECT sender_id, receiver_id, message, created_at 
      FROM direct_messages 
      WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
      ORDER BY created_at ASC
    `, [userId, friendId]);
    res.json({ messages: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

const connectedUsers = new Map();

const broadcastOnlineCount = () => {
  const total = connectedUsers.size;
  const vibes = {};
  connectedUsers.forEach(u => {
    if (u.vibe) vibes[u.vibe] = (vibes[u.vibe] || 0) + 1;
  });
  io.emit('online_count', { total, vibes });
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

  connectedUsers.set(socket.id, { currentPartner: null, vibe: null, spark: false, ip: userIp, gender: null, tags: [], country: null, dareTimer: null, userId: null });
  broadcastOnlineCount();

  socket.on('join_queue', ({ vibe, gender, tags, country, userId }) => {
    const user = connectedUsers.get(socket.id);
    if (!user || user.currentPartner) return;

    user.vibe = vibe;
    user.gender = gender;
    user.tags = tags || [];
    user.country = country || null;
    user.spark = false;
    user.userId = userId;

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

  socket.on('spark', async () => {
    const user = connectedUsers.get(socket.id);
    if (user && user.currentPartner) {
      user.spark = true;
      const partner = connectedUsers.get(user.currentPartner);
      
      if (partner && partner.spark) {
        socket.emit('mutual_spark');
        io.to(user.currentPartner).emit('mutual_spark');

        // Persist friendship
        if (user.userId && partner.userId) {
          try {
            // Use least/greatest to ensure unique composite primary key ordering
            const u1 = user.userId < partner.userId ? user.userId : partner.userId;
            const u2 = user.userId < partner.userId ? partner.userId : user.userId;
            await db.query(
              'INSERT INTO friends (user_id_1, user_id_2) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [u1, u2]
            );
          } catch (err) {
            console.error('Error saving friendship:', err.message);
          }
        }
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

  // Direct messaging (Inbox)
  socket.on('send_dm', async ({ senderId, receiverId, message }) => {
    try {
      await db.query(
        'INSERT INTO direct_messages (sender_id, receiver_id, message) VALUES ($1, $2, $3)',
        [senderId, receiverId, message]
      );
      
      // If receiver is online, emit to them instantly
      for (let [sockId, u] of connectedUsers.entries()) {
        if (u.userId === receiverId) {
          io.to(sockId).emit('receive_dm', { senderId, receiverId, message, created_at: new Date() });
        }
      }
    } catch (err) {
      console.error('Error sending DM:', err.message);
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
