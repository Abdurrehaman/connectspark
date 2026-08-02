import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import io from 'socket.io-client';
import { Send, SkipForward, AlertTriangle, Video, VideoOff, Mic, MicOff, Zap, Gift, Globe, LogOut, Sparkles, Star } from 'lucide-react';
import { auth, signInWithGoogle, logOut, RecaptchaVerifier, signInWithPhoneNumber } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import './App.css';

const SOCKET_SERVER_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID;

// ── SPARK PACKAGES ─────────────────────────────────────────────────────────────
const SPARK_PACKAGES = [
  { id: 'starter', price: 1.49,  sparks: 100,  label: 'Starter', badge: null,      color: '#38bdf8' },
  { id: 'popular', price: 4.99,  sparks: 500,  label: 'Popular', badge: '⭐ Best',  color: '#f43f5e' },
  { id: 'whale',   price: 14.99, sparks: 2000, label: 'Whale',   badge: '🔥 Max',   color: '#a855f7' },
];

const SPARK_COSTS = { super_spark: 20, premium_gift: 10 };

const INTEREST_TAGS = [
  { id: 'music',   label: '🎵 Music'   },
  { id: 'gaming',  label: '🎮 Gaming'  },
  { id: 'fitness', label: '💪 Fitness' },
  { id: 'movies',  label: '🎬 Movies'  },
  { id: 'memes',   label: '😂 Memes'   },
  { id: 'study',   label: '📚 Study'   },
  { id: 'travel',  label: '✈️ Travel'  },
  { id: 'tech',    label: '💻 Tech'    },
];

const GIFTS = [
  { id: 'rose',    emoji: '🌹', label: 'Rose',    premium: false },
  { id: 'fire',    emoji: '🔥', label: 'Fire',    premium: false },
  { id: 'heart',   emoji: '💜', label: 'Heart',   premium: false },
  { id: 'crown',   emoji: '👑', label: 'Crown',   premium: true  },
  { id: 'diamond', emoji: '💎', label: 'Diamond', premium: true  },
];

// ── FRAMER VARIANTS ────────────────────────────────────────────────────────────
const fadeUp   = { hidden: { opacity: 0, y: 30 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } } };
const fadeIn   = { hidden: { opacity: 0 },         show: { opacity: 1, transition: { duration: 0.4 } } };
const popIn    = { hidden: { opacity: 0, scale: 0.85 }, show: { opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 300, damping: 20 } } };
const slideUp  = { hidden: { opacity: 0, y: 60 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 250, damping: 25 } } };
const stagger  = { show: { transition: { staggerChildren: 0.08 } } };

const getFlagEmoji = (code) => {
  if (!code) return '🌍';
  return code.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt()));
};

// ── SPARK PURCHASE MODAL ───────────────────────────────────────────────────────
function SparkModal({ user, onClose, onSuccess }) {
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [error, setError] = useState('');

  const createPayPalOrder = async (data, actions) => {
    setError('');
    const res = await fetch(`${SOCKET_SERVER_URL}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: selectedPkg.id }),
    });
    const orderData = await res.json();
    if (!orderData.id) {
      setError(orderData.error || 'Failed to create PayPal order');
      throw new Error('Failed to create order');
    }
    return orderData.id;
  };

  const onPayPalApprove = async (data, actions) => {
    const verifyRes = await fetch(`${SOCKET_SERVER_URL}/api/capture-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderID: data.orderID,
        userId: user.uid,
        packageId: selectedPkg.id,
      }),
    });
    const verifyData = await verifyRes.json();
    if (verifyData.success) {
      onSuccess(verifyData.new_balance, selectedPkg.sparks);
      onClose();
    } else {
      setError(verifyData.message || 'Verification failed');
    }
  };

  return (
    <PayPalScriptProvider options={{ "client-id": PAYPAL_CLIENT_ID, currency: "USD", intent: "capture" }}>
      <motion.div className="modal-backdrop" variants={fadeIn} initial="hidden" animate="show" onClick={onClose}>
        <motion.div className="spark-modal" variants={popIn} onClick={e => e.stopPropagation()}>
          <div className="modal-glow" />
          <button className="modal-close" onClick={onClose}>✕</button>
          <div className="modal-header">
            <span className="modal-icon">⚡</span>
            <h2>Buy Sparks</h2>
            <p>Select a package below to checkout with PayPal</p>
          </div>

          <motion.div className="packages-grid" variants={stagger} initial="hidden" animate="show">
            {SPARK_PACKAGES.map(pkg => (
              <motion.div
                key={pkg.id}
                variants={fadeUp}
                className={`package-card ${pkg.badge ? 'package-popular' : ''} ${selectedPkg?.id === pkg.id ? 'selected' : ''}`}
                style={{ '--pkg-color': pkg.color, cursor: 'pointer', border: selectedPkg?.id === pkg.id ? `2px solid ${pkg.color}` : '2px solid transparent' }}
                whileHover={{ scale: 1.04, y: -4 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setSelectedPkg(pkg)}
              >
                {pkg.badge && <div className="pkg-badge">{pkg.badge}</div>}
                <div className="pkg-sparks">⚡ {pkg.sparks}</div>
                <div className="pkg-label">{pkg.label}</div>
                <div className="pkg-price">${pkg.price}</div>
              </motion.div>
            ))}
          </motion.div>

          <div style={{ marginTop: '20px', minHeight: '150px' }}>
            {selectedPkg ? (
              <PayPalButtons 
                key={selectedPkg.id} 
                createOrder={createPayPalOrder} 
                onApprove={onPayPalApprove} 
                onError={(err) => setError('PayPal Error: ' + err.message)}
                style={{ layout: "vertical", shape: "pill", color: "gold" }}
              />
            ) : (
              <div style={{ textAlign: 'center', opacity: 0.5 }}>Please select a package</div>
            )}
            {error && <div className="error-text" style={{ textAlign: 'center', marginTop: '10px' }}>{error}</div>}
          </div>

        <div className="spark-spends">
          <p>What Sparks unlock:</p>
          <div className="spend-items">
            <span>⚡ 20 → Super Spark (priority match)</span>
            <span>⚡ 10 → Premium Gift (👑 💎)</span>
          </div>
        </div>

        {error && <motion.p className="modal-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>❌ {error}</motion.p>}
      </motion.div>
    </motion.div>
  </PayPalScriptProvider>
  );
}

// ── FULLSCREEN GIFT ANIMATION ──────────────────────────────────────────────────
function FullscreenGiftAnimation({ gift }) {
  if (!gift) return null;
  const count = 40;
  const particles = Array.from({ length: count });
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, overflow: 'hidden' }}>
      {particles.map((_, i) => {
        const xStart = Math.random() * 100;
        const delay = Math.random() * 0.5;
        const duration = 1.5 + Math.random();
        const size = 2 + Math.random() * 3;
        
        let animation;
        if (gift.emoji === '🌹') {
          // Petals falling down
          animation = {
            initial: { top: '-10%', left: `${xStart}%`, rotate: 0, opacity: 1, scale: size },
            animate: { top: '110%', left: `${xStart + (Math.random() * 20 - 10)}%`, rotate: 360, opacity: 0 },
          };
        } else if (gift.emoji === '❤️' || gift.emoji === '💖' || gift.emoji === '💜') {
          // Hearts floating up
          animation = {
            initial: { bottom: '-10%', left: `${xStart}%`, rotate: -20, opacity: 1, scale: size },
            animate: { bottom: '110%', left: `${xStart + (Math.random() * 20 - 10)}%`, rotate: 20, opacity: 0 },
          };
        } else if (gift.emoji === '🔥') {
          // Fire bursting from bottom center
          animation = {
            initial: { bottom: '0%', left: '50%', opacity: 1, scale: size * 1.5 },
            animate: { bottom: `${50 + Math.random()*50}%`, left: `${10 + Math.random()*80}%`, opacity: 0, scale: size * 0.5 },
          };
        } else {
          // Default: just a small burst in center
          animation = {
            initial: { top: '50%', left: '50%', opacity: 1, scale: 0 },
            animate: { top: `${Math.random()*100}%`, left: `${Math.random()*100}%`, opacity: 0, scale: size },
          };
        }

        return (
          <motion.div
            key={i}
            initial={animation.initial}
            animate={animation.animate}
            transition={{ duration, delay, ease: 'easeOut' }}
            style={{ position: 'absolute', fontSize: '2rem' }}
          >
            {gift.emoji}
          </motion.div>
        );
      })}
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────────────────────────────────────
function App() {
  // Auth
  const [user, setUser]             = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authScreen, setAuthScreen]  = useState('login');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp]               = useState('');
  const [otpSent, setOtpSent]       = useState(false);
  const [confirmResult, setConfirmResult] = useState(null);
  const recaptchaRef = useRef(null);

  // Sparks
  const [sparks, setSparks]         = useState(0);
  const [myTotalSpent, setMyTotalSpent] = useState(0);
  const [showSparkModal, setShowSparkModal] = useState(false);

  // Onboarding & App View
  const [screenName, setScreenName] = useState('');
  const [gender, setGender]         = useState(null);
  const [selectedTags, setSelectedTags] = useState([]);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [currentView, setCurrentView] = useState('explore'); // 'explore' or 'inbox'

  // Inbox
  const [friends, setFriends] = useState([]);
  const [activeFriendId, setActiveFriendId] = useState(null);
  const [inboxMessages, setInboxMessages] = useState([]);
  const [inboxInput, setInboxInput] = useState('');

  // Chat
  const [socket, setSocket]         = useState(null);
  const [selectedVibe, setSelectedVibe] = useState(null);
  const [isMatching, setIsMatching] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages]     = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [partnerGender, setPartnerGender] = useState(null);
  const [partnerTags, setPartnerTags] = useState([]);
  const [partnerCountry, setPartnerCountry] = useState(null);
  const [partnerWealthRank, setPartnerWealthRank] = useState('');
  const [partnerLocationLabel, setPartnerLocationLabel] = useState(null);
  const [myLocationLabel, setMyLocationLabel] = useState(null);
  const [myCountry, setMyCountry]   = useState(null);
  const [genderPref, setGenderPref] = useState('anyone');
  const [location, setLocation] = useState(null);

  // Video
  const [hasVideo, setHasVideo]     = useState(true);
  const [hasAudio, setHasAudio]     = useState(true);
  const [localFlipped, setLocalFlipped] = useState(true);
  const [remoteFlipped, setRemoteFlipped] = useState(false);

  // Mystery
  const [mysteryActive, setMysteryActive] = useState(false);
  const [mysteryCountdown, setMysteryCountdown] = useState(10);

  // Features
  const [dareCard, setDareCard]     = useState(null);
  const [showGiftPicker, setShowGiftPicker] = useState(false);
  const [incomingGift, setIncomingGift] = useState(null);
  const [sparkSent, setSparkSent]   = useState(false);
  const [mutualSpark, setMutualSpark] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [vibeCount, setVibeCount]   = useState({});

  // Refs
  const localVideoRef  = useRef(null);
  const remoteVideoRef = useRef(null);
  const messagesEndRef = useRef(null);
  const peerConnection = useRef(null);
  const localStream    = useRef(null);
  const iceCandidateQueue = useRef([]);
  const mysteryCountdownRef = useRef(null);
  const iceServersRef  = useRef([
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthLoading(false);
      if (u) {
        // Fetch Profile
        try {
          const pr = await fetch(`${SOCKET_SERVER_URL}/api/profiles/${u.uid}`);
          const pd = await pr.json();
          if (pd.screenName) setScreenName(pd.screenName);
        } catch {}
        // Fetch Spark balance
        try {
          const r = await fetch(`${SOCKET_SERVER_URL}/api/sparks/${u.uid}`);
          const d = await r.json();
          setSparks(d.sparks ?? 0);
          setMyTotalSpent(d.total_spent ?? 0);
        } catch {}
        // Fetch TURN credentials
        try {
          const r = await fetch(`${SOCKET_SERVER_URL}/api/turn-credentials`);
          const d = await r.json();
          if (d.iceServers) iceServersRef.current = d.iceServers;
        } catch {}
      }
    });
    return unsub;
  }, []);

  // Detect country
  useEffect(() => {
    fetch('https://ipapi.co/json/').then(r => r.json())
      .then(d => setMyCountry({ code: d.country_code, name: d.country_name, flag: getFlagEmoji(d.country_code) }))
      .catch(() => {});
  }, []);

  // Handle Stripe redirect back (payment success / cancelled)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    const sparksAdded = parseInt(params.get('sparks') || '0', 10);
    if (paymentStatus === 'success' && sparksAdded > 0) {
      setSparks(prev => prev + sparksAdded);
      // Clean URL without reload
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => alert(`✅ Payment successful! ${sparksAdded} Sparks added to your wallet ⚡`), 500);
    } else if (paymentStatus === 'cancelled') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Phone auth
  const setupRecaptcha = () => {
    if (!recaptchaRef.current) {
      recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
    }
  };
  const sendOtp = async () => {
    try {
      setupRecaptcha();
      const result = await signInWithPhoneNumber(auth, phoneNumber, recaptchaRef.current);
      setConfirmResult(result); setOtpSent(true);
    } catch (err) { alert('Error: ' + err.message); }
  };
  const verifyOtp = async () => {
    try { await confirmResult.confirm(otp); }
    catch { alert('Invalid OTP. Try again.'); }
  };

  const toggleTag = (id) => setSelectedTags(prev =>
    prev.includes(id) ? prev.filter(t => t !== id) : prev.length < 3 ? [...prev, id] : prev
  );

  // Sparks helpers
  const spendSparks = useCallback(async (amount, reason) => {
    if (!user) return false;
    try {
      const r = await fetch(`${SOCKET_SERVER_URL}/api/sparks/deduct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, sparks: amount, reason })
      });
      const d = await r.json();
      if (d.success) {
        setSparks(d.new_balance);
        setMyTotalSpent(p => p + amount);
        return true;
      } else {
        alert(d.message || 'Not enough sparks!');
        return false;
      }
    } catch {
      alert('Error connecting to server.');
      return false;
    }
  }, [user]);

  // WebRTC
  const getMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStream.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    } catch { alert('Camera/mic access required.'); }
  };

  const createPeer = (sock) => {
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    localStream.current?.getTracks().forEach(t => pc.addTrack(t, localStream.current));
    pc.ontrack = (e) => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0]; };
    pc.onicecandidate = (e) => { if (e.candidate) sock.emit('ice_candidate', e.candidate); };
    return pc;
  };

  const cleanup = () => {
    if (peerConnection.current) { peerConnection.current.close(); peerConnection.current = null; }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (mysteryCountdownRef.current) clearInterval(mysteryCountdownRef.current);
    iceCandidateQueue.current = [];
    setIsConnected(false);
    setSparkSent(false); setMutualSpark(false); setDareCard(null);
    setShowGiftPicker(false); setIncomingGift(null);
    setMysteryActive(false); setMysteryCountdown(10);
    setPartnerGender(null); setPartnerTags([]); setPartnerCountry(null);
  };

  const startMystery = (pGender) => {
    if (!gender || !pGender) return;
    const opp = (gender === 'male' && pGender === 'female') || (gender === 'female' && pGender === 'male');
    if (!opp) return;
    setMysteryActive(true); setMysteryCountdown(10);
    let c = 10;
    mysteryCountdownRef.current = setInterval(() => {
      c--; setMysteryCountdown(c);
      if (c <= 0) { clearInterval(mysteryCountdownRef.current); setMysteryActive(false); }
    }, 1000);
  };

  // Initialize Socket when onboarding is done
  useEffect(() => {
    if (user && onboardingDone && !socket) {
      const sock = io(SOCKET_SERVER_URL);
      setSocket(sock);

      sock.on('online_count', ({ total, vibes }) => { setOnlineCount(total); setVibeCount(vibes || {}); });
      sock.on('banned', (d) => { alert(d.message); window.location.reload(); });

      sock.on('matched', async ({ partnerId, partnerGender: pG, partnerTags: pT, partnerCountry: pC, partnerWealthRank: pWR, locationLabel, myLocationLabel: myLL }) => {
        setIsMatching(false); setIsConnected(true);
        setPartnerGender(pG); setPartnerTags(pT || []); setPartnerCountry(pC);
        setPartnerWealthRank(pWR || ''); 
        setPartnerLocationLabel(locationLabel || null);
        setMyLocationLabel(myLL || null);
        setMessages([{ text: '✨ Connected! Say hello!', type: 'system' }]);
        startMystery(pG);
        if (!peerConnection.current) peerConnection.current = createPeer(sock);
        if (sock.id < partnerId) {
          const offer = await peerConnection.current.createOffer();
          await peerConnection.current.setLocalDescription(offer);
          sock.emit('offer', offer);
        }
      });

      sock.on('offer', async (offer) => {
        if (!peerConnection.current) peerConnection.current = createPeer(sock);
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(offer));
        iceCandidateQueue.current.forEach(c => peerConnection.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
        iceCandidateQueue.current = [];
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        sock.emit('answer', answer);
      });

      sock.on('answer', async (answer) => {
        if (peerConnection.current?.signalingState !== 'stable') {
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
          iceCandidateQueue.current.forEach(c => peerConnection.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
          iceCandidateQueue.current = [];
        }
      });

      sock.on('ice_candidate', async (c) => {
        if (!peerConnection.current?.remoteDescription?.type) iceCandidateQueue.current.push(c);
        else await peerConnection.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      });

      sock.on('receiveMessage', (d) => setMessages(p => [...p, { text: d.message, type: 'partner' }]));
      sock.on('dare_card', (d) => { setDareCard(d); setTimeout(() => setDareCard(null), 20000); });
      sock.on('gift_received', ({ gift }) => { setIncomingGift(gift); setTimeout(() => setIncomingGift(null), 3000); });
      sock.on('mutual_spark', () => {
        setMutualSpark(true);
        setMessages(p => [...p, { text: '💥 Mutual Spark! Share socials!', type: 'system' }]);
        setTimeout(() => setMutualSpark(false), 5000);
      });
      sock.on('partner_disconnected', () => { setMessages(p => [...p, { text: 'Stranger disconnected.', type: 'system' }]); cleanup(); });
    }
  }, [user, onboardingDone, socket, gender]);

  const startMatching = async (vibe) => {
    if (genderPref !== 'anyone') {
      const ok = await spendSparks(5, 'gender_filter');
      if (!ok) return;
    }

    setSelectedVibe(vibe); setIsMatching(true); setMessages([]); cleanup();
    if (!localStream.current) await getMedia();
    
    let currentLoc = location;
    if (!currentLoc && navigator.geolocation) {
      try {
        const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 }));
        currentLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLocation(currentLoc);
      } catch (e) {
        console.warn('Location denied');
      }
    }
    
    if (socket) {
      socket.emit('join_queue', { vibe, gender, tags: selectedTags, country: myCountry?.code, userId: user?.uid, genderPref, location: currentLoc });
    }
  };

  const handleNext = () => { if (socket) { socket.emit('next'); cleanup(); setIsMatching(true); } };

  const handleSpark = async () => {
    if (!socket || !isConnected || sparkSent) return;
    const ok = await spendSparks(SPARK_COSTS.super_spark, 'spark');
    if (ok) { setSparkSent(true); socket.emit('spark'); }
  };

  const handleOnboardingSubmit = async () => {
    if (!screenName.trim()) return alert('Please enter a screen name');
    try {
      await fetch(`${SOCKET_SERVER_URL}/api/profiles`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, screenName })
      });
    } catch (e) { console.error('Failed to save profile', e); }
    setOnboardingDone(true);
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || !socket || !isConnected) return;
    socket.emit('sendMessage', { message: inputMessage });
    setMessages(p => [...p, { text: inputMessage, type: 'self' }]);
    setInputMessage('');
  };

  const sendGift = async (gift) => {
    if (!socket || !isConnected) return;
    if (gift.premium) {
      const ok = await spendSparks(SPARK_COSTS.premium_gift, 'premium_gift');
      if (!ok) return;
    }
    socket.emit('send_gift', { gift });
    setShowGiftPicker(false);
    setMessages(p => [...p, { text: `You sent ${gift.emoji} ${gift.label}!`, type: 'system' }]);
  };


  const fetchFriends = async () => {
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/friends/${user.uid}`);
      const data = await res.json();
      setFriends(data.friends || []);
    } catch (err) { console.error('Error fetching friends', err); }
  };

  const openInbox = () => {
    setCurrentView('inbox');
    fetchFriends();
  };

  const openExplore = () => {
    setCurrentView('explore');
  };

  const fetchMessages = async (friendId) => {
    setActiveFriendId(friendId);
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/messages/${user.uid}/${friendId}`);
      const data = await res.json();
      setInboxMessages(data.messages || []);
    } catch (err) { console.error('Error fetching messages', err); }
  };

  const sendInboxMessage = (e) => {
    e.preventDefault();
    if (!inboxInput.trim() || !activeFriendId) return;
    const newMsg = { sender_id: user.uid, receiver_id: activeFriendId, message: inboxInput, created_at: new Date().toISOString() };
    setInboxMessages(p => [...p, newMsg]);
    socket.emit('send_dm', { senderId: user.uid, receiverId: activeFriendId, message: inboxInput });
    setInboxInput('');
  };

  useEffect(() => {
    if (socket) {
      const handler = (msg) => {
        // If chat is open with sender or if we just sent it
        if (msg.senderId === activeFriendId || msg.receiverId === activeFriendId || msg.senderId === user.uid) {
          setInboxMessages(p => {
             // Avoid duplicates if we already optimistically added it
             if (p.some(x => x.message === msg.message && Math.abs(new Date(x.created_at) - new Date(msg.created_at)) < 5000)) return p;
             return [...p, { sender_id: msg.senderId, receiver_id: msg.receiverId, message: msg.message, created_at: msg.created_at }];
          });
        }
      };
      socket.on('receive_dm', handler);
      return () => socket.off('receive_dm', handler);
    }
  }, [socket, activeFriendId, user?.uid]);


  const toggleVideo = () => { const t = localStream.current?.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; setHasVideo(t.enabled); } };
  const toggleAudio = () => { const t = localStream.current?.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; setHasAudio(t.enabled); } };

  // ── LOADING ──────────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div className="app-container">
      <div className="auth-loading">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} style={{ fontSize: '3rem' }}>⚡</motion.div>
        <p style={{ color: '#94a3b8', marginTop: '1rem' }}>Loading ConnectSpark...</p>
      </div>
    </div>
  );

  const getWealthRank = (spent) => {
    if (!spent || spent < 100) return 'Sparkler 🤍';
    if (spent < 500) return 'Hustler ⭐';
    if (spent < 2000) return 'High Roller 🌟🌟';
    return 'Elite 👑🌟🌟🌟';
  };

  // ── AUTH ─────────────────────────────────────────────────────────────────────
  if (!user) return (
    <div className="app-container">
      <div id="recaptcha-container" />
      <div className="auth-bg">
        {[...Array(6)].map((_, i) => (
          <motion.div key={i} className="auth-orb"
            animate={{ x: [0, 60, -40, 0], y: [0, -80, 40, 0], scale: [1, 1.3, 0.8, 1] }}
            transition={{ duration: 8 + i * 2, repeat: Infinity, delay: i * 1.2 }}
            style={{ left: `${10 + i * 15}%`, top: `${20 + (i % 3) * 25}%` }}
          />
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={authScreen} className="auth-wrapper" variants={fadeIn} initial="hidden" animate="show" exit={{ opacity: 0, x: -30 }}>
          <motion.div className="auth-card" variants={slideUp}>
            <motion.h1 className="auth-logo" animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }} transition={{ duration: 4, repeat: Infinity }}>
              ConnectSpark ⚡
            </motion.h1>
            <p className="auth-subtitle">Connect with strangers. Spark real conversations.</p>

            {authScreen === 'login' && (
              <motion.div variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <motion.button variants={fadeUp} className="google-btn" onClick={signInWithGoogle} whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.98 }}>
                  <img src="https://www.google.com/favicon.ico" width="18" alt="G" />
                  Continue with Google
                </motion.button>
                <div className="auth-divider"><span>or</span></div>
                <motion.button variants={fadeUp} className="phone-btn" onClick={() => setAuthScreen('phone')} whileHover={{ scale: 1.02 }}>
                  📱 Continue with Phone
                </motion.button>
              </motion.div>
            )}

            {authScreen === 'phone' && !otpSent && (
              <motion.div variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <p className="auth-hint">Enter number with country code (e.g. +91 98765...)</p>
                <motion.input variants={fadeUp} className="auth-input" type="tel" placeholder="+91 9876543210" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} />
                <motion.button variants={fadeUp} className="google-btn" onClick={sendOtp} whileHover={{ scale: 1.02 }}>Send OTP</motion.button>
                <motion.button variants={fadeUp} className="phone-btn" onClick={() => setAuthScreen('login')}>← Back</motion.button>
              </motion.div>
            )}

            {authScreen === 'phone' && otpSent && (
              <motion.div variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <p className="auth-hint">Enter the 6-digit OTP sent to {phoneNumber}</p>
                <motion.input variants={fadeUp} className="auth-input" type="text" placeholder="123456" value={otp} onChange={e => setOtp(e.target.value)} maxLength={6} />
                <motion.button variants={fadeUp} className="google-btn" onClick={verifyOtp} whileHover={{ scale: 1.02 }}>Verify & Enter</motion.button>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </div>
  );

  // ── ONBOARDING ───────────────────────────────────────────────────────────────
  if (!onboardingDone) return (
    <div className="app-container">
      <div className="auth-bg">
        {[...Array(4)].map((_, i) => (
          <motion.div key={i} className="auth-orb" animate={{ scale: [1, 1.4, 1], opacity: [0.3, 0.6, 0.3] }} transition={{ duration: 4 + i, repeat: Infinity, delay: i }} style={{ left: `${15 + i * 20}%`, top: `${15 + i * 18}%` }} />
        ))}
      </div>
      <div className="onboarding-wrapper">
        <motion.div className="onboarding-card" variants={slideUp} initial="hidden" animate="show">
          <h2>Welcome, {user.displayName?.split(' ')[0] || 'friend'}! 👋</h2>
          <p className="onboard-sub">Quick setup before you start connecting with the world</p>

          <motion.div className="onboard-section" variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.05 }}>
            <h3>Screen Name</h3>
            <input 
              className="auth-input" 
              style={{ width: '100%', boxSizing: 'border-box' }}
              placeholder="e.g. Maverick" 
              value={screenName} 
              onChange={e => setScreenName(e.target.value)} 
            />
          </motion.div>

          <motion.div className="onboard-section" variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.1 }}>
            <h3>I am a...</h3>
            <div className="gender-buttons">
              {['male', 'female', 'other'].map(g => (
                <motion.button key={g} className={`gender-btn ${gender === g ? 'selected' : ''}`}
                  onClick={() => setGender(g)} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  {g === 'male' ? '👨 Male' : g === 'female' ? '👩 Female' : '🧑 Other'}
                </motion.button>
              ))}
            </div>
          </motion.div>

          <motion.div className="onboard-section" variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.2 }}>
            <h3>My Interests <span className="tag-hint">(pick up to 3)</span></h3>
            <motion.div className="tags-grid" variants={stagger} initial="hidden" animate="show">
              {INTEREST_TAGS.map(tag => (
                <motion.button key={tag.id} variants={fadeUp} className={`tag-btn ${selectedTags.includes(tag.id) ? 'selected' : ''}`}
                  onClick={() => toggleTag(tag.id)} whileHover={{ scale: 1.07 }} whileTap={{ scale: 0.93 }}>
                  {tag.label}
                </motion.button>
              ))}
            </motion.div>
          </motion.div>

          <motion.button className="start-btn" disabled={!gender || !screenName.trim()} onClick={handleOnboardingSubmit}
            whileHover={(gender && screenName) ? { scale: 1.03, y: -2 } : {}} whileTap={(gender && screenName) ? { scale: 0.97 } : {}}
            animate={(gender && screenName) ? { boxShadow: ['0 0 20px rgba(244,63,94,0.4)', '0 0 40px rgba(244,63,94,0.7)', '0 0 20px rgba(244,63,94,0.4)'] } : {}}
            transition={{ duration: 2, repeat: Infinity }}>
            {(gender && screenName) ? "Let's Connect! 🚀" : 'Fill details to start'}
          </motion.button>
        </motion.div>
      </div>
    </div>
  );

  // ── LANDING ───────────────────────────────────────────────────────────────────
  if (!selectedVibe && !isMatching && !isConnected) return (
    <div className="app-container">
      <div className="landing-bg">
        {[...Array(8)].map((_, i) => (
          <motion.div key={i} className="bg-orb"
            animate={{ x: [0, 80, -50, 0], y: [0, -100, 60, 0], scale: [1, 1.5, 0.7, 1], opacity: [0.2, 0.5, 0.1, 0.2] }}
            transition={{ duration: 10 + i * 2, repeat: Infinity, delay: i * 1.5, ease: 'easeInOut' }}
            style={{ left: `${5 + i * 12}%`, top: `${10 + (i % 4) * 22}%`, '--orb-size': `${120 + i * 30}px`, '--orb-color': ['#f43f5e','#a855f7','#38bdf8','#22c55e','#fb923c','#e879f9','#34d399','#60a5fa'][i] }}
          />
        ))}
      </div>

      {/* Top Bar */}
      <motion.div className="landing-top-bar" initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}>
        <div className="logo-small">ConnectSpark ⚡</div>
        
        <div className="view-toggle">
          <button className={currentView === 'explore' ? 'active' : ''} onClick={openExplore}>Explore</button>
          <button className={currentView === 'inbox' ? 'active' : ''} onClick={openInbox}>Inbox</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {myCountry && <span className="country-badge">{myCountry.flag} {myCountry.name}</span>}
          {/* Sparks balance */}
          <motion.button className="sparks-pill" onClick={() => setShowSparkModal(true)} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <motion.span animate={{ rotate: [0, 15, -15, 0] }} transition={{ duration: 2, repeat: Infinity }}>⚡</motion.span>
            <span>{sparks} Sparks</span>
          </motion.button>
          <div className="user-pill">
            {user.photoURL && <img src={user.photoURL} alt="" className="user-avatar" />}
            <span>{user.displayName?.split(' ')[0] || user.phoneNumber}</span>
            <button className="logout-btn" onClick={logOut}><LogOut size={14} /></button>
          </div>
        </div>
      </motion.div>

      {/* Online Counter */}
      <AnimatePresence>
        {onlineCount > 0 && (
          <motion.div className="online-counter" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ marginTop: '80px' }}>
            <motion.span className="online-dot" animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />
            <strong>{onlineCount.toLocaleString()}</strong> people online right now
            {Object.keys(vibeCount).length > 0 && (
              <div className="vibe-counts">
                {vibeCount.soul_search > 0 && <span>✨ {vibeCount.soul_search}</span>}
                {vibeCount.flirt > 0 && <span>🔥 {vibeCount.flirt}</span>}
                {vibeCount.after_hours > 0 && <span>🌙 {vibeCount.after_hours}</span>}
                {vibeCount.global > 0 && <span>🌍 {vibeCount.global}</span>}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {currentView === 'explore' ? (
        <>
          {/* Hero */}
          <motion.div className="landing-header" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.7 }}>
            <motion.h1 animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }} transition={{ duration: 5, repeat: Infinity }}>
              ConnectSpark
            </motion.h1>
            <p>Pick your vibe. No profiles. No filters. Just real connections.</p>
            {selectedTags.length > 0 && (
              <p className="tags-preview">{selectedTags.map(t => INTEREST_TAGS.find(x => x.id === t)?.label).join(' · ')}</p>
            )}
            
            <div className="gender-filter" style={{ marginTop: '20px', background: 'rgba(0,0,0,0.5)', padding: '10px 20px', borderRadius: '20px', display: 'inline-block' }}>
              <label style={{ marginRight: '10px', fontWeight: 'bold' }}>Match With:</label>
              <select value={genderPref} onChange={(e) => setGenderPref(e.target.value)} style={{ background: 'transparent', color: 'white', border: '1px solid rgba(255,255,255,0.2)', padding: '5px 10px', borderRadius: '10px', outline: 'none', cursor: 'pointer' }}>
                <option value="anyone" style={{ color: 'black' }}>Anyone (Free)</option>
                <option value="male" style={{ color: 'black' }}>Men (⚡ 5 Sparks)</option>
                <option value="female" style={{ color: 'black' }}>Women (⚡ 5 Sparks)</option>
              </select>
            </div>
          </motion.div>

          {/* Vibe Cards */}
          <motion.div className="vibes-container" variants={stagger} initial="hidden" animate="show">
            {[
              { id: 'soul_search',  icon: '✨', title: 'Soul Search',       desc: 'Deep conversations and genuine connections.', color: '#38bdf8' },
              { id: 'flirt',        icon: '🔥', title: 'Flirt & Spark',    desc: 'Playful banter and electric chemistry.',     color: '#f43f5e' },
              { id: 'after_hours',  icon: '🌙', title: 'After Hours',       desc: 'Spicy, no-holds-barred conversations.',       color: '#a855f7' },
              { id: 'global',       icon: '🌍', title: 'Language Roulette', desc: 'Match globally. Auto-translated!',           color: '#22c55e' },
            ].map((v, i) => (
              <motion.div key={v.id} className={`vibe-card ${v.id}`} variants={fadeUp} onClick={() => startMatching(v.id)}
                whileHover={{ y: -12, scale: 1.03, boxShadow: `0 20px 60px ${v.color}55` }}
                whileTap={{ scale: 0.97 }}
                style={{ '--vibe-color': v.color }}>
                <motion.div className="vibe-icon" animate={{ rotate: [0, 10, -10, 0] }} transition={{ duration: 4, repeat: Infinity, delay: i * 0.5 }}>
                  {v.icon}
                </motion.div>
                <h3 className="vibe-title">{v.title}</h3>
                <p className="vibe-desc">{v.desc}</p>
                <motion.div className="vibe-arrow" initial={{ x: 0 }} whileHover={{ x: 5 }}>→</motion.div>
              </motion.div>
            ))}
          </motion.div>
        </>
      ) : (
        <div className="inbox-portal" style={{ marginTop: '140px', zIndex: 10, display: 'flex', width: '90%', maxWidth: '1000px', height: '60vh', background: 'rgba(15,12,30,0.85)', backdropFilter: 'blur(20px)', borderRadius: '24px', border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden' }}>
          
          <div className="inbox-sidebar" style={{ width: '280px', borderRight: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px', fontSize: '1.2rem', fontWeight: 800, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>Friends</div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {friends.length === 0 ? <p style={{ padding: '20px', color: '#94a3b8', fontSize: '0.9rem' }}>No friends yet. Go spark some connections!</p> : null}
              {friends.map(f => (
                <div key={f.friend_id} 
                     onClick={() => fetchMessages(f.friend_id)}
                     style={{ padding: '15px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', background: activeFriendId === f.friend_id ? 'rgba(244,63,94,0.1)' : 'transparent', borderLeft: activeFriendId === f.friend_id ? '3px solid #f43f5e' : '3px solid transparent' }}>
                  <div style={{ fontWeight: 700 }}>{f.screen_name || 'Anonymous'}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="inbox-chat" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {activeFriendId ? (
              <>
                <div style={{ padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)', fontWeight: 800 }}>
                  Chat with {friends.find(x => x.friend_id === activeFriendId)?.screen_name}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {inboxMessages.map((m, i) => {
                    const isMe = m.sender_id === user.uid;
                    return (
                      <div key={i} style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', background: isMe ? '#f43f5e' : 'rgba(255,255,255,0.1)', padding: '10px 15px', borderRadius: '18px', borderBottomRightRadius: isMe ? '4px' : '18px', borderBottomLeftRadius: !isMe ? '4px' : '18px', maxWidth: '75%', fontSize: '0.9rem' }}>
                        {m.message}
                      </div>
                    );
                  })}
                </div>
                <form onSubmit={sendInboxMessage} style={{ padding: '15px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '10px' }}>
                  <input value={inboxInput} onChange={e => setInboxInput(e.target.value)} placeholder="Type a message..." style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 16px', borderRadius: '20px', color: 'white', outline: 'none' }} />
                  <button type="submit" style={{ background: '#f43f5e', border: 'none', color: 'white', padding: '0 20px', borderRadius: '20px', fontWeight: 700, cursor: 'pointer' }}>Send</button>
                </form>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                Select a friend to start chatting
              </div>
            )}
          </div>
        </div>
      )}


      {/* Spark Modal in landing */}
      <AnimatePresence>
        {showSparkModal && <SparkModal user={user} onClose={() => setShowSparkModal(false)} onSuccess={(bal) => setSparks(bal)} />}
      </AnimatePresence>

    </div>
  );

  // ── CHAT VIEW ─────────────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      <div className="chat-wrapper">
        {/* Header */}
        <motion.div className="glass-header" initial={{ y: -60 }} animate={{ y: 0 }}>
          <div className="logo-small">ConnectSpark ⚡</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {onlineCount > 0 && <span className="online-pill"><span className="online-dot-sm" />{onlineCount.toLocaleString()}</span>}
            <motion.button className="sparks-pill-sm" whileHover={{ scale: 1.05 }}>
              ⚡ {sparks}
            </motion.button>
            <button className="report-btn" onClick={() => { if (window.confirm('Report this user?')) { socket.emit('report', { reason: 'reported' }); handleNext(); } }}>
              <AlertTriangle size={13} /> Report
            </button>
          </div>
        </motion.div>


        {/* Dare Card */}
        <AnimatePresence>
          {dareCard && isConnected && (
            <motion.div className="dare-card-overlay" variants={fadeIn} initial="hidden" animate="show" exit="hidden">
              <motion.div className="dare-card" variants={popIn}>
                <div className="dare-header">🃏 Dare!</div>
                <p className="dare-text">{dareCard.text}</p>
                <div className="dare-actions">
                  <motion.button className="dare-accept" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    onClick={() => { socket.emit('dare_response', { response: 'accept' }); setDareCard(null); }}>
                    🎉 I'll Do It!
                  </motion.button>
                  <button className="dare-skip" onClick={() => setDareCard(null)}>😅 Skip</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Gift Explosion */}
        <AnimatePresence>
          {incomingGift && (
            <>
              <FullscreenGiftAnimation gift={incomingGift} />
              <motion.div className="gift-explosion" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <motion.div className="gift-emoji" initial={{ scale: 0 }} animate={{ scale: [0, 1.5, 1] }} transition={{ type: 'spring', stiffness: 300 }}>
                  {incomingGift.emoji}
                </motion.div>
                <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                  Stranger sent you {incomingGift.label}!
                </motion.p>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Videos */}
        <div className="videos-container">
          {[
            { ref: localVideoRef, label: `You ${myCountry?.flag || ''}`, flipped: localFlipped, setFlipped: setLocalFlipped, muted: true, showControls: true, mystery: mysteryActive, wealth: getWealthRank(myTotalSpent), locLabel: myLocationLabel },
            { ref: remoteVideoRef, label: `Stranger ${partnerCountry?.flag || ''}`, flipped: remoteFlipped, setFlipped: setRemoteFlipped, muted: false, showControls: false, mystery: mysteryActive, wealth: partnerWealthRank, locLabel: partnerLocationLabel },
          ].map((v, i) => (
            <motion.div key={i} className="video-box" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.1 }}>
              <span className="video-label" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div>
                  {v.label}
                  {(i === 0 ? gender : partnerGender) && <span className="gender-badge">{(i === 0 ? gender : partnerGender) === 'male' ? '👨' : (i === 0 ? gender : partnerGender) === 'female' ? '👩' : '🧑'}</span>}
                </div>
                {v.wealth && <div style={{ fontSize: '0.8rem', color: '#fbbf24', fontWeight: 'bold' }}>{v.wealth}</div>}
                {v.locLabel && <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>📍 {v.locLabel}</div>}
              </span>
              {v.mystery && (
                <motion.div className="mystery-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <motion.div className="mystery-countdown" animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                    {mysteryCountdown}s
                  </motion.div>
                  <p>Revealing...</p>
                </motion.div>
              )}
              <video ref={v.ref} autoPlay playsInline muted={v.muted}
                style={{ transform: v.flipped ? 'scaleX(-1)' : 'scaleX(1)', filter: v.mystery ? 'blur(22px)' : 'none', transition: 'filter 0.6s ease, transform 0.3s ease' }}
                onLoadedMetadata={e => e.target.play().catch(() => {})}
              />
              <div className="media-controls">
                {v.showControls && <>
                  <motion.button className="circle-btn" onClick={toggleVideo} whileHover={{ scale: 1.1 }}>{hasVideo ? <Video size={15} /> : <VideoOff size={15} color="#ef4444" />}</motion.button>
                  <motion.button className="circle-btn" onClick={toggleAudio} whileHover={{ scale: 1.1 }}>{hasAudio ? <Mic size={15} /> : <MicOff size={15} color="#ef4444" />}</motion.button>
                </>}
                <motion.button className="circle-btn" onClick={() => v.setFlipped(f => !f)} whileHover={{ scale: 1.1 }}>🔄</motion.button>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Common tags */}
        <AnimatePresence>
          {partnerTags.filter(t => selectedTags.includes(t)).length > 0 && (
            <motion.div className="common-tags" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              {selectedTags.filter(t => partnerTags.includes(t)).map(t => (
                <span key={t} className="common-tag">{INTEREST_TAGS.find(x => x.id === t)?.label}</span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Gift Picker */}
        <AnimatePresence>
          {showGiftPicker && (
            <motion.div className="gift-picker" variants={slideUp} initial="hidden" animate="show" exit={{ opacity: 0, y: 20 }}>
              {GIFTS.map(g => (
                <motion.button key={g.id} className="gift-option" onClick={() => sendGift(g)} whileHover={{ scale: 1.15, y: -4 }} whileTap={{ scale: 0.9 }}>
                  <span>{g.emoji}</span>
                  <span>{g.label}</span>
                  {g.premium && <span className="gift-cost">⚡{SPARK_COSTS.premium_gift}</span>}
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat */}
        <div className="floating-chat">
          <div className="messages-area">
            <AnimatePresence>
              {messages.map((msg, i) => (
                <motion.div key={i} className={`msg-bubble msg-${msg.type}`}
                  initial={{ opacity: 0, y: 10, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300 }}>
                  {msg.text}
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
          <form className="chat-input-wrapper" onSubmit={sendMessage}>
            <input type="text" placeholder={isConnected ? 'Type a message...' : 'Waiting...'} value={inputMessage}
              onChange={e => setInputMessage(e.target.value)} disabled={!isConnected} />
            <motion.button type="submit" className="send-btn" disabled={!isConnected || !inputMessage.trim()} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
              <Send size={15} />
            </motion.button>
          </form>
        </div>

        {/* Controls */}
        <motion.div className="main-controls" initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}>
          <motion.button className={`action-btn spark-btn ${sparkSent ? 'active' : ''}`} onClick={handleSpark}
            disabled={!isConnected || sparkSent} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Zap size={18} /> {sparkSent ? 'Sparked!' : `Spark ⚡${SPARK_COSTS.super_spark}`}
          </motion.button>
          <motion.button className="action-btn gift-btn" onClick={() => setShowGiftPicker(p => !p)}
            disabled={!isConnected} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Gift size={18} /> Gift
          </motion.button>
          <motion.button className="action-btn next-btn" onClick={handleNext} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <SkipForward size={18} /> Next
          </motion.button>
          <motion.button className="action-btn leave-btn" onClick={() => { setSelectedVibe(null); setIsMatching(false); cleanup(); }} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} style={{ background: 'rgba(239, 68, 68, 0.2)', borderColor: 'rgba(239, 68, 68, 0.5)', color: '#fca5a5' }}>
            Leave
          </motion.button>
        </motion.div>

        {/* Matching overlay */}
        <AnimatePresence>
          {isMatching && (
            <motion.div className="status-overlay" variants={fadeIn} initial="hidden" animate="show" exit="hidden">
              <div className="search-animation">
                {[0,1,2].map(i => (
                  <motion.div key={i} className="pulse-ring"
                    animate={{ scale: [0.3, 2], opacity: [0.8, 0] }}
                    transition={{ duration: 2, repeat: Infinity, delay: i * 0.6 }}
                  />
                ))}
                <motion.div className="search-icon" animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}>⚡</motion.div>
              </div>
              <motion.h2 className="search-title" animate={{ opacity: [0.7, 1, 0.7] }} transition={{ duration: 2, repeat: Infinity }}>
                Finding your match...
              </motion.h2>
              <p className="search-subtitle">Scanning the planet for your perfect vibe</p>
              <div className="search-dots">
                {[0,1,2].map(i => <motion.span key={i} animate={{ y: [0, -12, 0] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }} />)}
              </div>
              <div className="search-tips">
                <p>🎯 Matching on: {selectedTags.map(t => INTEREST_TAGS.find(x => x.id === t)?.label).join(', ') || 'Any interests'}</p>
              </div>
              <motion.button className="cancel-match-btn" onClick={() => { setIsMatching(false); setSelectedVibe(null); }} whileHover={{ scale: 1.03 }}>
                Cancel
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mutual Spark */}
        <AnimatePresence>
          {mutualSpark && (
            <motion.div className="mutual-spark-overlay" variants={fadeIn} initial="hidden" animate="show" exit="hidden">
              <motion.div style={{ fontSize: '5rem' }} animate={{ scale: [1, 1.3, 1], rotate: [0, 10, -10, 0] }} transition={{ duration: 0.5 }}>💥</motion.div>
              <motion.h2 animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }} transition={{ duration: 2, repeat: Infinity }}>
                MUTUAL SPARK!
              </motion.h2>
              <p>You both liked each other!</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Spark Modal in chat */}
        <AnimatePresence>
          {showSparkModal && <SparkModal user={user} onClose={() => setShowSparkModal(false)} onSuccess={(bal) => setSparks(bal)} />}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default App;
