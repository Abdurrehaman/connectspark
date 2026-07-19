import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { Send, SkipForward, AlertTriangle, Video, VideoOff, Mic, MicOff, Zap, Star, Gift, Globe, LogOut } from 'lucide-react';
import { auth, signInWithGoogle, logOut, RecaptchaVerifier, signInWithPhoneNumber } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import './App.css';

const SOCKET_SERVER_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

const INTEREST_TAGS = [
  { id: 'music', label: '🎵 Music' },
  { id: 'gaming', label: '🎮 Gaming' },
  { id: 'fitness', label: '💪 Fitness' },
  { id: 'movies', label: '🎬 Movies' },
  { id: 'memes', label: '😂 Memes' },
  { id: 'study', label: '📚 Study' },
  { id: 'travel', label: '✈️ Travel' },
  { id: 'tech', label: '💻 Tech' },
];

const GIFTS = [
  { id: 'rose', emoji: '🌹', label: 'Rose' },
  { id: 'fire', emoji: '🔥', label: 'Fire' },
  { id: 'crown', emoji: '👑', label: 'Crown' },
  { id: 'heart', emoji: '💜', label: 'Heart' },
  { id: 'star', emoji: '⭐', label: 'Star' },
];

function App() {
  // Auth state
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authScreen, setAuthScreen] = useState('login'); // 'login' | 'phone'
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [confirmResult, setConfirmResult] = useState(null);
  const recaptchaRef = useRef(null);

  // Onboarding state
  const [gender, setGender] = useState(null);
  const [selectedTags, setSelectedTags] = useState([]);
  const [onboardingDone, setOnboardingDone] = useState(false);

  // Chat state
  const [socket, setSocket] = useState(null);
  const [selectedVibe, setSelectedVibe] = useState(null);
  const [isMatching, setIsMatching] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [partnerGender, setPartnerGender] = useState(null);
  const [partnerTags, setPartnerTags] = useState([]);

  // Video state
  const [hasVideo, setHasVideo] = useState(true);
  const [hasAudio, setHasAudio] = useState(true);
  const [localFlipped, setLocalFlipped] = useState(true);
  const [remoteFlipped, setRemoteFlipped] = useState(false);

  // Mystery mode
  const [mysteryActive, setMysteryActive] = useState(false);
  const [mysteryCountdown, setMysteryCountdown] = useState(10);

  // Icebreaker
  const [icebreaker, setIcebreaker] = useState(null);
  const [showPremiumAnswers, setShowPremiumAnswers] = useState(false);

  // Dare cards
  const [dareCard, setDareCard] = useState(null);
  const [dareResponse, setDareResponse] = useState(null);

  // Gift system
  const [showGiftPicker, setShowGiftPicker] = useState(false);
  const [incomingGift, setIncomingGift] = useState(null);

  // Spark
  const [sparkSent, setSparkSent] = useState(false);
  const [mutualSpark, setMutualSpark] = useState(false);

  // Online counter
  const [onlineCount, setOnlineCount] = useState(0);
  const [vibeCount, setVibeCount] = useState({});

  // Language roulette
  const [partnerCountry, setPartnerCountry] = useState(null);
  const [myCountry, setMyCountry] = useState(null);

  // Refs
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const messagesEndRef = useRef(null);
  const peerConnection = useRef(null);
  const localStream = useRef(null);
  const iceCandidateQueue = useRef([]);
  const icebreakerTimeoutRef = useRef(null);
  const premiumTimeoutRef = useRef(null);
  const mysteryTimerRef = useRef(null);
  const mysteryCountdownRef = useRef(null);

  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]
  };

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  // Detect country
  useEffect(() => {
    fetch('https://ipapi.co/json/')
      .then(r => r.json())
      .then(d => setMyCountry({ code: d.country_code, name: d.country_name, flag: getFlagEmoji(d.country_code) }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const getFlagEmoji = (countryCode) => {
    if (!countryCode) return '🌍';
    return countryCode.toUpperCase().replace(/./g, char =>
      String.fromCodePoint(127397 + char.charCodeAt())
    );
  };

  // Phone auth setup
  const setupRecaptcha = () => {
    if (!recaptchaRef.current) {
      recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
    }
  };

  const sendOtp = async () => {
    try {
      setupRecaptcha();
      const result = await signInWithPhoneNumber(auth, phoneNumber, recaptchaRef.current);
      setConfirmResult(result);
      setOtpSent(true);
    } catch (err) {
      alert('Error sending OTP: ' + err.message);
    }
  };

  const verifyOtp = async () => {
    try {
      await confirmResult.confirm(otp);
    } catch (err) {
      alert('Invalid OTP. Please try again.');
    }
  };

  // Onboarding
  const toggleTag = (id) => {
    setSelectedTags(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : prev.length < 3 ? [...prev, id] : prev
    );
  };

  // WebRTC
  const getMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: true
      });
      localStream.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    } catch (err) {
      alert('Could not access camera/microphone.');
    }
  };

  const createPeerConnection = (socketInstance) => {
    const pc = new RTCPeerConnection(configuration);
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => pc.addTrack(track, localStream.current));
    }
    pc.ontrack = (event) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) socketInstance.emit('ice_candidate', event.candidate);
    };
    return pc;
  };

  const cleanupConnection = () => {
    if (peerConnection.current) { peerConnection.current.close(); peerConnection.current = null; }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (icebreakerTimeoutRef.current) clearTimeout(icebreakerTimeoutRef.current);
    if (premiumTimeoutRef.current) clearTimeout(premiumTimeoutRef.current);
    if (mysteryTimerRef.current) clearTimeout(mysteryTimerRef.current);
    if (mysteryCountdownRef.current) clearInterval(mysteryCountdownRef.current);
    iceCandidateQueue.current = [];
    setIsConnected(false);
    setIcebreaker(null);
    setShowPremiumAnswers(false);
    setSparkSent(false);
    setMutualSpark(false);
    setDareCard(null);
    setDareResponse(null);
    setShowGiftPicker(false);
    setIncomingGift(null);
    setMysteryActive(false);
    setMysteryCountdown(10);
    setPartnerGender(null);
    setPartnerTags([]);
    setPartnerCountry(null);
  };

  const startMysteryMode = (pGender) => {
    if (!gender || !pGender) return;
    const isOpposite = (gender === 'male' && pGender === 'female') || (gender === 'female' && pGender === 'male');
    if (!isOpposite) return;

    setMysteryActive(true);
    setMysteryCountdown(10);

    let count = 10;
    mysteryCountdownRef.current = setInterval(() => {
      count -= 1;
      setMysteryCountdown(count);
      if (count <= 0) {
        clearInterval(mysteryCountdownRef.current);
        setMysteryActive(false);
      }
    }, 1000);
  };

  const startMatching = async (vibe) => {
    setSelectedVibe(vibe);
    setIsMatching(true);
    setMessages([]);
    cleanupConnection();

    if (!localStream.current) await getMedia();

    let newSocket = socket;
    if (!newSocket) {
      newSocket = io(SOCKET_SERVER_URL);
      setSocket(newSocket);

      newSocket.on('online_count', ({ total, vibes }) => {
        setOnlineCount(total);
        setVibeCount(vibes || {});
      });

      newSocket.on('banned', (data) => { alert(data.message); window.location.reload(); });

      newSocket.on('matched', async ({ partnerId, partnerGender: pGender, partnerTags: pTags, partnerCountry: pCountry }) => {
        setIsMatching(false);
        setIsConnected(true);
        setPartnerGender(pGender);
        setPartnerTags(pTags || []);
        setPartnerCountry(pCountry);
        setMessages([{ text: '✨ You are now connected with a stranger!', type: 'system' }]);

        startMysteryMode(pGender);

        if (!peerConnection.current) peerConnection.current = createPeerConnection(newSocket);
        if (newSocket.id < partnerId) {
          const offer = await peerConnection.current.createOffer();
          await peerConnection.current.setLocalDescription(offer);
          newSocket.emit('offer', offer);
        }
      });

      newSocket.on('offer', async (offer) => {
        if (!peerConnection.current) peerConnection.current = createPeerConnection(newSocket);
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(offer));
        iceCandidateQueue.current.forEach(c => peerConnection.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
        iceCandidateQueue.current = [];
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        newSocket.emit('answer', answer);
      });

      newSocket.on('answer', async (answer) => {
        if (peerConnection.current?.signalingState !== 'stable') {
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
          iceCandidateQueue.current.forEach(c => peerConnection.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
          iceCandidateQueue.current = [];
        }
      });

      newSocket.on('ice_candidate', async (candidate) => {
        if (!peerConnection.current?.remoteDescription?.type) {
          iceCandidateQueue.current.push(candidate);
        } else {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        }
      });

      newSocket.on('receiveMessage', (data) => {
        setMessages(prev => [...prev, { text: data.message, translated: data.translated, type: 'partner' }]);
      });

      newSocket.on('icebreaker', (data) => {
        setIcebreaker(data);
        setShowPremiumAnswers(true);
        if (icebreakerTimeoutRef.current) clearTimeout(icebreakerTimeoutRef.current);
        icebreakerTimeoutRef.current = setTimeout(() => setIcebreaker(null), 40000);
        if (premiumTimeoutRef.current) clearTimeout(premiumTimeoutRef.current);
        premiumTimeoutRef.current = setTimeout(() => setShowPremiumAnswers(false), 30000);
      });

      newSocket.on('dare_card', (dare) => {
        setDareCard(dare);
        setDareResponse(null);
        setTimeout(() => setDareCard(null), 20000);
      });

      newSocket.on('gift_received', ({ gift }) => {
        setIncomingGift(gift);
        setTimeout(() => setIncomingGift(null), 3000);
      });

      newSocket.on('mutual_spark', () => {
        setMutualSpark(true);
        setMessages(prev => [...prev, { text: '💥 Mutual Spark! Share socials before you disconnect!', type: 'system' }]);
        setTimeout(() => setMutualSpark(false), 5000);
      });

      newSocket.on('partner_disconnected', () => {
        setMessages(prev => [...prev, { text: 'Stranger disconnected.', type: 'system' }]);
        cleanupConnection();
      });
    }

    newSocket.emit('join_queue', {
      vibe,
      gender,
      tags: selectedTags,
      country: myCountry?.code,
      userId: user?.uid
    });
  };

  const handleNext = () => {
    if (socket) {
      socket.emit('next');
      cleanupConnection();
      setIsMatching(true);
    }
  };

  const handleSpark = () => {
    if (socket && isConnected && !sparkSent) {
      setSparkSent(true);
      socket.emit('spark');
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || !socket || !isConnected) return;

    let translated = null;
    // Try to translate if partner is from different country
    if (partnerCountry && myCountry && partnerCountry.code !== myCountry.code) {
      try {
        const res = await fetch('https://libretranslate.com/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: inputMessage, source: 'auto', target: 'en', format: 'text' })
        });
        const data = await res.json();
        translated = data.translatedText;
      } catch { translated = null; }
    }

    socket.emit('sendMessage', { message: inputMessage, translated });
    setMessages(prev => [...prev, { text: inputMessage, type: 'self' }]);
    setInputMessage('');
  };

  const sendGift = (gift) => {
    if (socket && isConnected) {
      socket.emit('send_gift', { gift });
      setShowGiftPicker(false);
      setMessages(prev => [...prev, { text: `You sent ${gift.emoji} ${gift.label}!`, type: 'system' }]);
    }
  };

  const toggleVideo = () => {
    const track = localStream.current?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; setHasVideo(track.enabled); }
  };

  const toggleAudio = () => {
    const track = localStream.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setHasAudio(track.enabled); }
  };

  // ── AUTH LOADING ──
  if (authLoading) {
    return (
      <div className="app-container">
        <div className="auth-loading">
          <div className="search-animation">
            <div className="pulse-ring"></div>
            <div className="pulse-ring delay-1"></div>
            <div className="search-icon">⚡</div>
          </div>
          <p>Loading ConnectSpark...</p>
        </div>
      </div>
    );
  }

  // ── AUTH SCREEN ──
  if (!user) {
    return (
      <div className="app-container">
        <div className="auth-wrapper">
          <div id="recaptcha-container"></div>
          <div className="auth-card">
            <h1 className="auth-logo">ConnectSpark ⚡</h1>
            <p className="auth-subtitle">Sign in to remember your account across devices</p>

            {authScreen === 'login' && (
              <>
                <button className="google-btn" onClick={signInWithGoogle}>
                  <img src="https://www.google.com/favicon.ico" width="18" alt="Google" />
                  Continue with Google
                </button>
                <div className="auth-divider"><span>or</span></div>
                <button className="phone-btn" onClick={() => setAuthScreen('phone')}>
                  📱 Continue with Phone
                </button>
              </>
            )}

            {authScreen === 'phone' && !otpSent && (
              <>
                <p style={{ color: '#94a3b8', marginBottom: '1rem', fontSize: '0.9rem' }}>Enter your phone number with country code (e.g. +91...)</p>
                <input
                  className="auth-input"
                  type="tel"
                  placeholder="+91 9876543210"
                  value={phoneNumber}
                  onChange={e => setPhoneNumber(e.target.value)}
                />
                <button className="google-btn" onClick={sendOtp}>Send OTP</button>
                <button className="phone-btn" onClick={() => setAuthScreen('login')}>← Back</button>
              </>
            )}

            {authScreen === 'phone' && otpSent && (
              <>
                <p style={{ color: '#94a3b8', marginBottom: '1rem', fontSize: '0.9rem' }}>Enter the 6-digit OTP sent to {phoneNumber}</p>
                <input
                  className="auth-input"
                  type="text"
                  placeholder="Enter OTP"
                  value={otp}
                  onChange={e => setOtp(e.target.value)}
                  maxLength={6}
                />
                <button className="google-btn" onClick={verifyOtp}>Verify OTP</button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── ONBOARDING (Gender + Tags) ──
  if (!onboardingDone) {
    return (
      <div className="app-container">
        <div className="onboarding-wrapper">
          <div className="onboarding-card">
            <h2>Welcome, {user.displayName || user.phoneNumber}! 👋</h2>
            <p className="onboard-sub">Let's personalise your experience before you start connecting</p>

            <div className="onboard-section">
              <h3>I am a...</h3>
              <div className="gender-buttons">
                {['male', 'female', 'other'].map(g => (
                  <button
                    key={g}
                    className={`gender-btn ${gender === g ? 'selected' : ''}`}
                    onClick={() => setGender(g)}
                  >
                    {g === 'male' ? '👨 Male' : g === 'female' ? '👩 Female' : '🧑 Other'}
                  </button>
                ))}
              </div>
            </div>

            <div className="onboard-section">
              <h3>My Interests <span style={{ color: '#94a3b8', fontWeight: 'normal', fontSize: '0.85rem' }}>(pick up to 3)</span></h3>
              <div className="tags-grid">
                {INTEREST_TAGS.map(tag => (
                  <button
                    key={tag.id}
                    className={`tag-btn ${selectedTags.includes(tag.id) ? 'selected' : ''}`}
                    onClick={() => toggleTag(tag.id)}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              className="start-btn"
              disabled={!gender}
              onClick={() => setOnboardingDone(true)}
            >
              {gender ? "Let's Go! 🚀" : "Please select your gender first"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── LANDING PAGE ──
  if (!selectedVibe && !isMatching && !isConnected) {
    return (
      <div className="app-container">
        <div className="landing-wrapper">
          <div className="landing-top-bar">
            <div className="logo-small">ConnectSpark ⚡</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {myCountry && <span className="country-badge">{myCountry.flag} {myCountry.name}</span>}
              <div className="user-pill">
                {user.photoURL && <img src={user.photoURL} alt="" className="user-avatar" />}
                <span>{user.displayName || user.phoneNumber}</span>
                <button className="logout-btn" onClick={logOut}><LogOut size={14} /></button>
              </div>
            </div>
          </div>

          {onlineCount > 0 && (
            <div className="online-counter">
              <span className="online-dot"></span>
              <strong>{onlineCount.toLocaleString()}</strong> people online right now
              {Object.keys(vibeCount).length > 0 && (
                <div className="vibe-counts">
                  {vibeCount.soul_search > 0 && <span>✨ {vibeCount.soul_search}</span>}
                  {vibeCount.flirt > 0 && <span>🔥 {vibeCount.flirt}</span>}
                  {vibeCount.after_hours > 0 && <span>🌙 {vibeCount.after_hours}</span>}
                  {vibeCount.global > 0 && <span>🌍 {vibeCount.global}</span>}
                </div>
              )}
            </div>
          )}

          <div className="landing-header">
            <h1>ConnectSpark</h1>
            <p>Pick your vibe. No profiles, no filters. Just real connections.</p>
          </div>

          <div className="vibes-container">
            <div className="vibe-card soul_search" onClick={() => startMatching('soul_search')}>
              <div className="vibe-icon">✨</div>
              <h3 className="vibe-title">Soul Search</h3>
              <p className="vibe-desc">Deep conversations and genuine connections.</p>
            </div>
            <div className="vibe-card flirt" onClick={() => startMatching('flirt')}>
              <div className="vibe-icon">🔥</div>
              <h3 className="vibe-title">Flirt & Spark</h3>
              <p className="vibe-desc">Playful banter and quick chemistry.</p>
            </div>
            <div className="vibe-card after_hours" onClick={() => startMatching('after_hours')}>
              <div className="vibe-icon">🌙</div>
              <h3 className="vibe-title">After Hours</h3>
              <p className="vibe-desc">Spicy, no-holds-barred conversations.</p>
            </div>
            <div className="vibe-card global" onClick={() => startMatching('global')}>
              <div className="vibe-icon">🌍</div>
              <h3 className="vibe-title">Language Roulette</h3>
              <p className="vibe-desc">Match with someone from a different country. Auto-translated!</p>
            </div>
          </div>

          {selectedTags.length > 0 && (
            <div className="selected-tags-display">
              Your interests: {selectedTags.map(t => INTEREST_TAGS.find(x => x.id === t)?.label).join(' · ')}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── CHAT VIEW ──
  return (
    <div className="app-container">
      <div className="chat-wrapper">
        {/* Header */}
        <div className="glass-header">
          <div className="logo-small">ConnectSpark ⚡</div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {onlineCount > 0 && (
              <span className="online-pill"><span className="online-dot-sm"></span>{onlineCount.toLocaleString()} online</span>
            )}
            <button className="report-btn" onClick={() => {
              if (window.confirm('Report this user? (3 reports = ban)')) {
                socket.emit('report', { reason: 'user_reported' });
                handleNext();
              }
            }}>
              <AlertTriangle size={14} /> Report
            </button>
          </div>
        </div>

        {/* Icebreaker */}
        {icebreaker && isConnected && (
          <div className="icebreaker-toast">
            <span>Icebreaker (40s)</span>
            <p>{icebreaker.text}</p>
          </div>
        )}

        {/* Icebreaker Answers */}
        {icebreaker?.answers && showPremiumAnswers && isConnected && (
          <div className="premium-center-widget">
            <div className="widget-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Zap size={16} /> Witty Answers</div>
              <button className="close-widget-btn" onClick={() => setShowPremiumAnswers(false)}>&times;</button>
            </div>
            <div className="premium-answers-list">
              {icebreaker.answers.map((ans, idx) => (
                <div key={idx} className="premium-answer-card">
                  <div className="premium-answer-text">{ans}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dare Card */}
        {dareCard && isConnected && (
          <div className="dare-card-overlay">
            <div className="dare-card">
              <div className="dare-header">🃏 Dare Card!</div>
              <p className="dare-text">{dareCard.text}</p>
              {!dareResponse && (
                <div className="dare-actions">
                  <button className="dare-accept" onClick={() => { setDareResponse('accept'); socket.emit('dare_response', { response: 'accept' }); }}>
                    🎉 I'll Do It!
                  </button>
                  <button className="dare-skip" onClick={() => { setDareResponse('skip'); setDareCard(null); }}>
                    😅 Skip
                  </button>
                </div>
              )}
              {dareResponse === 'accept' && <p className="dare-waiting">Waiting for stranger...</p>}
            </div>
          </div>
        )}

        {/* Incoming Gift */}
        {incomingGift && (
          <div className="gift-explosion">
            <div className="gift-emoji">{incomingGift.emoji}</div>
            <p>Stranger sent you a {incomingGift.label}!</p>
          </div>
        )}

        {/* Videos */}
        <div className="videos-container">
          <div className="video-box">
            <span className="video-label">
              You {myCountry?.flag}
              {gender && <span className="gender-badge">{gender === 'male' ? '👨' : gender === 'female' ? '👩' : '🧑'}</span>}
            </span>
            {mysteryActive && <div className="mystery-overlay"><div className="mystery-countdown">{mysteryCountdown}s</div><p>Revealing...</p></div>}
            <video
              ref={localVideoRef}
              autoPlay playsInline muted
              style={{ transform: localFlipped ? 'scaleX(-1)' : 'scaleX(1)', filter: mysteryActive ? 'blur(20px)' : 'none', transition: 'filter 0.5s ease, transform 0.3s ease' }}
              onLoadedMetadata={e => e.target.play().catch(() => {})}
            />
            <div className="media-controls">
              <button className="circle-btn" onClick={toggleVideo}>{hasVideo ? <Video size={16} /> : <VideoOff size={16} color="#ef4444" />}</button>
              <button className="circle-btn" onClick={toggleAudio}>{hasAudio ? <Mic size={16} /> : <MicOff size={16} color="#ef4444" />}</button>
              <button className="circle-btn" onClick={() => setLocalFlipped(f => !f)}>🔄</button>
            </div>
          </div>

          <div className="video-box">
            <span className="video-label">
              Stranger {partnerCountry?.flag || ''}
              {partnerGender && <span className="gender-badge">{partnerGender === 'male' ? '👨' : partnerGender === 'female' ? '👩' : '🧑'}</span>}
            </span>
            {mysteryActive && <div className="mystery-overlay"><div className="mystery-countdown">{mysteryCountdown}s</div><p>Revealing...</p></div>}
            <video
              ref={remoteVideoRef}
              autoPlay playsInline
              style={{ transform: remoteFlipped ? 'scaleX(-1)' : 'scaleX(1)', filter: mysteryActive ? 'blur(20px)' : 'none', transition: 'filter 0.5s ease, transform 0.3s ease' }}
              onLoadedMetadata={e => e.target.play().catch(() => {})}
            />
            <div className="media-controls">
              <button className="circle-btn" onClick={() => setRemoteFlipped(f => !f)}>🔄</button>
            </div>
          </div>
        </div>

        {/* Common Tags Badge */}
        {partnerTags.length > 0 && (
          <div className="common-tags">
            {selectedTags.filter(t => partnerTags.includes(t)).map(t => (
              <span key={t} className="common-tag">{INTEREST_TAGS.find(x => x.id === t)?.label}</span>
            ))}
          </div>
        )}

        {/* Gift Picker */}
        {showGiftPicker && (
          <div className="gift-picker">
            {GIFTS.map(g => (
              <button key={g.id} className="gift-option" onClick={() => sendGift(g)}>
                <span>{g.emoji}</span>
                <span>{g.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Chat */}
        <div className="floating-chat">
          <div className="messages-area">
            {messages.map((msg, i) => (
              <div key={i} className={`msg-bubble msg-${msg.type}`}>
                {msg.text}
                {msg.translated && <div className="msg-translated">🌍 {msg.translated}</div>}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form className="chat-input-wrapper" onSubmit={sendMessage}>
            <input
              type="text"
              placeholder={isConnected ? 'Type a message...' : 'Waiting for connection...'}
              value={inputMessage}
              onChange={e => setInputMessage(e.target.value)}
              disabled={!isConnected}
            />
            <button type="submit" className="send-btn" disabled={!isConnected || !inputMessage.trim()}>
              <Send size={16} />
            </button>
          </form>
        </div>

        {/* Controls */}
        <div className="main-controls">
          <button className={`action-btn spark-btn ${sparkSent ? 'active' : ''}`} onClick={handleSpark} disabled={!isConnected || sparkSent}>
            <Zap size={20} /> {sparkSent ? 'Spark Sent!' : 'Spark'}
          </button>
          <button className="action-btn gift-btn" onClick={() => setShowGiftPicker(p => !p)} disabled={!isConnected}>
            <Gift size={20} /> Gift
          </button>
          <button className="action-btn next-btn" onClick={handleNext}>
            <SkipForward size={20} /> Next
          </button>
        </div>

        {/* Matching Overlay */}
        {isMatching && (
          <div className="status-overlay">
            <div className="search-animation">
              <div className="pulse-ring"></div>
              <div className="pulse-ring delay-1"></div>
              <div className="pulse-ring delay-2"></div>
              <div className="search-icon">⚡</div>
            </div>
            <h2 className="search-title">Finding your vibe...</h2>
            <p className="search-subtitle">Scanning the planet for your perfect match</p>
            <div className="search-dots"><span></span><span></span><span></span></div>
            <div className="search-tips">
              <p>🔍 Matching based on your interests: {selectedTags.map(t => INTEREST_TAGS.find(x => x.id === t)?.label).join(', ') || 'Any'}</p>
            </div>
          </div>
        )}

        {/* Mutual Spark */}
        {mutualSpark && (
          <div className="mutual-spark-overlay">
            <div style={{ fontSize: '5rem' }}>💥</div>
            <h2>MUTUAL SPARK!</h2>
            <p style={{ marginTop: '10px', fontSize: '1.2rem' }}>You both liked each other!</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
