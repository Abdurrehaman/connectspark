import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { Send, SkipForward, AlertTriangle, Video, VideoOff, Mic, MicOff, Heart, Zap, Star, Wallet } from 'lucide-react';
import './App.css';

const SOCKET_SERVER_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

function App() {
  const [userId, setUserId] = useState(() => {
    let id = localStorage.getItem('connectSparkUserId');
    if (!id) {
      id = 'user_' + Math.random().toString(36).substr(2, 9) + Date.now();
      localStorage.setItem('connectSparkUserId', id);
    }
    return id;
  });

  const [socket, setSocket] = useState(null);
  const [selectedVibe, setSelectedVibe] = useState(null);
  const [isMatching, setIsMatching] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  
  const [icebreaker, setIcebreaker] = useState(null);
  const [showPremiumAnswers, setShowPremiumAnswers] = useState(false);
  const [unlockedAnswers, setUnlockedAnswers] = useState(new Set());
  
  const [sparkSent, setSparkSent] = useState(false);
  const [mutualSpark, setMutualSpark] = useState(false);
  
  const [hasVideo, setHasVideo] = useState(true);
  const [hasAudio, setHasAudio] = useState(true);

  const [walletBalance, setWalletBalance] = useState(0);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const messagesEndRef = useRef(null);
  
  const peerConnection = useRef(null);
  const localStream = useRef(null);
  
  const icebreakerTimeoutRef = useRef(null);
  const premiumTimeoutRef = useRef(null);
  const iceCandidateQueue = useRef([]);

  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    // Fetch initial wallet balance
    const fetchBalance = async () => {
      try {
        const res = await fetch(`${SOCKET_SERVER_URL}/api/wallet/balance/${userId}`);
        const data = await res.json();
        if (data.balance !== undefined) {
          setWalletBalance(data.balance);
        }
      } catch (err) {
        console.error("Failed to fetch balance", err);
      }
    };
    fetchBalance();
  }, [userId]);

  const loadRazorpay = () => {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handleTopUp = async () => {
    const amount = 100; // Flat ₹100 top up
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      });
      const order = await res.json();

      const resLoad = await loadRazorpay();
      if (!resLoad) {
        alert("Razorpay SDK failed to load. Simulating success for testing.");
        const fakeVerifyRes = await fetch(`${SOCKET_SERVER_URL}/api/wallet/verify-funds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            amount,
            razorpay_order_id: 'mock',
            razorpay_payment_id: 'mock',
            razorpay_signature: 'mock'
          })
        });
        const fakeVerifyData = await fakeVerifyRes.json();
        if (fakeVerifyData.success) {
          setWalletBalance(prev => prev + amount);
          alert(`Successfully added ₹${amount} to your Prime Balance!`);
        }
        return;
      }

      const options = {
        key: 'rzp_test_mock_key',
        amount: order.amount,
        currency: order.currency,
        name: 'ConnectSpark',
        description: 'Prime Subscription Top-Up',
        order_id: order.id,
        handler: async function (response) {
          const verifyRes = await fetch(`${SOCKET_SERVER_URL}/api/wallet/verify-funds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              amount,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            })
          });
          const verifyData = await verifyRes.json();
          if (verifyData.success) {
            setWalletBalance(prev => prev + amount);
            alert(`Successfully added ₹${amount} to your Prime Balance!`);
          } else {
            alert("Payment verification failed.");
          }
        },
        prefill: { name: 'Anonymous User', email: 'user@example.com', contact: '9999999999' },
        theme: { color: '#f43f5e' }
      };

      const paymentObject = new window.Razorpay(options);
      try {
        paymentObject.open();
      } catch (e) {
        console.log("Mock payment fallback");
      }

    } catch (err) {
      console.error(err);
      alert("Error processing payment.");
    }
  };

  const deductFromWallet = async (amount, feature, onSuccess) => {
    if (walletBalance < amount) {
      alert(`Insufficient Prime Balance! You need ₹${amount} for this feature. Please Top Up.`);
      return;
    }

    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/wallet/deduct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amount, feature })
      });
      const data = await res.json();
      
      if (data.success) {
        setWalletBalance(data.newBalance);
        onSuccess();
      } else {
        alert(data.message || "Transaction failed");
      }
    } catch (err) {
      console.error(err);
      alert("Error contacting wallet server.");
    }
  };

  const buySuperSpark = (vibe) => {
    deductFromWallet(20, 'super_spark', () => {
      alert("Super Spark Activated! You are jumping to the front of the line.");
      startMatching(vibe, true);
    });
  };

  const unlockAnswer = (index) => {
    deductFromWallet(2, 'icebreaker_answer', () => {
      setUnlockedAnswers(prev => {
        const newSet = new Set(prev);
        newSet.add(index);
        return newSet;
      });
    });
  };

  const getMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, 
        audio: true 
      });
      localStream.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing media devices.", err);
      alert("Could not access camera/microphone.");
    }
  };

  const createPeerConnection = (socketInstance) => {
    const pc = new RTCPeerConnection(configuration);

    if (localStream.current) {
      localStream.current.getTracks().forEach(track => {
        pc.addTrack(track, localStream.current);
      });
    }

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketInstance.emit('ice_candidate', event.candidate);
      }
    };

    return pc;
  };

  const cleanupConnection = () => {
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (icebreakerTimeoutRef.current) clearTimeout(icebreakerTimeoutRef.current);
    if (premiumTimeoutRef.current) clearTimeout(premiumTimeoutRef.current);
    iceCandidateQueue.current = [];
    setIsConnected(false);
    setIcebreaker(null);
    setShowPremiumAnswers(false);
    setUnlockedAnswers(new Set());
    setSparkSent(false);
    setMutualSpark(false);
  };

  const startMatching = async (vibe, isSuperSpark = false) => {
    setSelectedVibe(vibe);
    setIsMatching(true);
    setMessages([]);
    
    // Crucial: cleanup old connection fully before matching again
    cleanupConnection();
    
    if (!localStream.current) {
      await getMedia();
    }

    let newSocket = socket;
    if (!newSocket) {
      newSocket = io(SOCKET_SERVER_URL);
      setSocket(newSocket);
      
      newSocket.on('banned', (data) => {
        alert(data.message);
        window.location.reload();
      });

      // Bind WebRTC events ONLY once per socket
      newSocket.on('matched', async ({ partnerId }) => {
        setIsMatching(false);
        setIsConnected(true);
        setMessages([{ text: "You are now chatting with a random stranger.", type: 'system' }]);

        // Prevent overwriting if offer arrived before matched
        if (!peerConnection.current) {
          peerConnection.current = createPeerConnection(newSocket);
        }

        if (newSocket.id < partnerId) {
          try {
            const offer = await peerConnection.current.createOffer();
            await peerConnection.current.setLocalDescription(offer);
            newSocket.emit('offer', offer);
          } catch (e) {
            console.error(e);
          }
        }
      });

      newSocket.on('offer', async (offer) => {
        if (!peerConnection.current) {
          peerConnection.current = createPeerConnection(newSocket);
        }
        try {
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(offer));
          
          // Flush ICE candidates that arrived early
          iceCandidateQueue.current.forEach(c => peerConnection.current.addIceCandidate(new RTCIceCandidate(c)).catch(e => console.error(e)));
          iceCandidateQueue.current = [];

          const answer = await peerConnection.current.createAnswer();
          await peerConnection.current.setLocalDescription(answer);
          newSocket.emit('answer', answer);
        } catch (e) {
          console.error(e);
        }
      });

      newSocket.on('answer', async (answer) => {
        try {
          if (peerConnection.current && peerConnection.current.signalingState !== "stable") {
            await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
            
            // Flush ICE candidates that arrived early
            iceCandidateQueue.current.forEach(c => peerConnection.current.addIceCandidate(new RTCIceCandidate(c)).catch(e => console.error(e)));
            iceCandidateQueue.current = [];
          }
        } catch (e) {
          console.error(e);
        }
      });

      newSocket.on('ice_candidate', async (candidate) => {
        try {
          if (!peerConnection.current || !peerConnection.current.remoteDescription || !peerConnection.current.remoteDescription.type) {
            // Connection not fully ready, queue the candidate
            iceCandidateQueue.current.push(candidate);
          } else {
            await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
          }
        } catch (e) {
          console.error("ICE candidate error:", e);
        }
      });

      newSocket.on('receiveMessage', (data) => {
        setMessages(prev => [...prev, { text: data.message, type: 'partner' }]);
      });
      
      newSocket.on('icebreaker', (data) => {
        setIcebreaker(data);
        setShowPremiumAnswers(true);
        setUnlockedAnswers(new Set());
        
        // 40 second timer for the question itself
        if (icebreakerTimeoutRef.current) clearTimeout(icebreakerTimeoutRef.current);
        icebreakerTimeoutRef.current = setTimeout(() => {
          setIcebreaker(null);
        }, 40000);

        // 30 second timer for the premium answers modal
        if (premiumTimeoutRef.current) clearTimeout(premiumTimeoutRef.current);
        premiumTimeoutRef.current = setTimeout(() => {
          setShowPremiumAnswers(false);
        }, 30000);
      });
      
      newSocket.on('mutual_spark', () => {
        setMutualSpark(true);
        setMessages(prev => [...prev, { text: "You both sparked! Share socials before you disconnect!", type: 'system' }]);
        setTimeout(() => setMutualSpark(false), 5000); 
      });

      newSocket.on('partner_disconnected', () => {
        setMessages(prev => [...prev, { text: "Stranger disconnected.", type: 'system' }]);
        cleanupConnection();
      });
    }

    newSocket.emit('join_queue', { vibe, isSuperSpark });
  };

  const handleNext = () => {
    if (socket) {
      socket.emit('next');
      cleanupConnection();
      setIsMatching(true);
      setMessages([{ text: "Looking for someone you can connect with...", type: 'system' }]);
    }
  };
  
  const handleSpark = () => {
    if (socket && isConnected && !sparkSent) {
      setSparkSent(true);
      socket.emit('spark');
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || !socket || !isConnected) return;
    
    socket.emit('sendMessage', { message: inputMessage });
    setMessages(prev => [...prev, { text: inputMessage, type: 'self' }]);
    setInputMessage("");
  };

  const toggleVideo = () => {
    if (localStream.current) {
      const videoTrack = localStream.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setHasVideo(videoTrack.enabled);
      }
    }
  };

  const toggleAudio = () => {
    if (localStream.current) {
      const audioTrack = localStream.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setHasAudio(audioTrack.enabled);
      }
    }
  };

  const WalletDisplay = () => (
    <div className="wallet-display">
      <div className="wallet-balance">
        <Wallet size={16} color="#fb7185"/> <span>₹{walletBalance}</span>
      </div>
      <button className="top-up-btn" onClick={handleTopUp}>Top Up ₹100</button>
    </div>
  );

  if (!selectedVibe && !isMatching && !isConnected) {
    return (
      <div className="app-container">
        <div className="landing-wrapper">
          
          {/* Landing Header with Wallet */}
          <div className="landing-top-bar">
            <div className="logo-small">ConnectSpark</div>
            <WalletDisplay />
          </div>

          <div className="landing-header">
            <h1>ConnectSpark</h1>
            <p>Choose your vibe. No profiles, no filters. Just instant connections based on what you are looking for.</p>
          </div>
          
          <div className="vibes-container">
            <div className="vibe-card soul_search" onClick={() => startMatching('soul_search')}>
              <div className="vibe-icon">✨</div>
              <h3 className="vibe-title">Soul Search</h3>
              <p className="vibe-desc">Deep conversations, genuine ties, and meaningful connections.</p>
              <button className="super-spark-btn" onClick={(e) => { e.stopPropagation(); buySuperSpark('soul_search'); }}>
                 <Star size={16}/> Super Spark (₹20)
              </button>
            </div>
            
            <div className="vibe-card flirt" onClick={() => startMatching('flirt')}>
              <div className="vibe-icon">🔥</div>
              <h3 className="vibe-title">Flirt & Spark</h3>
              <p className="vibe-desc">Casual vibes, playful banter, and quick chemistry.</p>
              <button className="super-spark-btn" onClick={(e) => { e.stopPropagation(); buySuperSpark('flirt'); }}>
                 <Star size={16}/> Super Spark (₹20)
              </button>
            </div>
            
            <div className="vibe-card after_hours" onClick={() => startMatching('after_hours')}>
              <div className="vibe-icon">🌙</div>
              <h3 className="vibe-title">After Hours</h3>
              <p className="vibe-desc">Spicy, no-holds-barred conversations for the adventurous.</p>
              <button className="super-spark-btn" onClick={(e) => { e.stopPropagation(); buySuperSpark('after_hours'); }}>
                 <Star size={16}/> Super Spark (₹20)
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="chat-wrapper">
        
        {/* Top Header */}
        <div className="glass-header">
          <div className="logo-small">ConnectSpark</div>
          <div style={{display: 'flex', gap: '15px', alignItems: 'center'}}>
             <WalletDisplay />
             <button className="report-btn super-buy" onClick={() => buySuperSpark(selectedVibe)} disabled={!isConnected}>
               <Star size={16} /> Super Spark (₹20)
             </button>
             <button className="report-btn" onClick={() => {
               if(window.confirm("Are you sure you want to report this user? (3 reports = ban)")) {
                 socket.emit('report', { reason: 'user_reported' });
                 handleNext();
               }
             }}>
               <AlertTriangle size={16} /> Report
             </button>
          </div>
        </div>

        {/* Icebreaker Question (Top Center - 40s Timer) */}
        {icebreaker && isConnected && (
          <div className="icebreaker-toast">
            <span>Icebreaker (Disappears in 40s)</span>
            <p>{icebreaker.text}</p>
          </div>
        )}
        
        {/* Premium Answers Modal (Absolute Center - 30s Timer) */}
        {icebreaker && icebreaker.answers && showPremiumAnswers && isConnected && (
          <div className="premium-center-widget">
            <div className="widget-header">
               <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                 <Zap size={16}/> Witty Answers <span style={{fontSize: '0.7rem', color: '#94a3b8', fontWeight: 'normal'}}>(Disappears in 30s)</span>
               </div>
               <button className="close-widget-btn" onClick={() => setShowPremiumAnswers(false)} title="Dismiss">
                 &times;
               </button>
            </div>
            
            <div className="premium-answers-list">
              {icebreaker.answers.map((ans, idx) => {
                const isUnlocked = unlockedAnswers.has(idx);
                return (
                  <div key={idx} className="premium-answer-card">
                    <div className={`premium-answer-text ${isUnlocked ? '' : 'locked'}`}>
                      {ans}
                    </div>
                    {!isUnlocked && (
                      <div className="unlock-overlay">
                        <button className="unlock-btn" onClick={() => unlockAnswer(idx)}>
                           Unlock (₹2)
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 50/50 Split Screen Video Layout */}
        <div className="videos-container">
          <div className="video-box">
            <span className="video-label">You</span>
            <video ref={localVideoRef} autoPlay playsInline muted onLoadedMetadata={(e) => e.target.play().catch(console.error)}></video>
            <div className="media-controls">
              <button className="circle-btn" onClick={toggleVideo}>
                {hasVideo ? <Video size={16} /> : <VideoOff size={16} color="#ef4444" />}
              </button>
              <button className="circle-btn" onClick={toggleAudio}>
                {hasAudio ? <Mic size={16} /> : <MicOff size={16} color="#ef4444" />}
              </button>
            </div>
          </div>
          
          <div className="video-box">
            <span className="video-label">Stranger</span>
            <video ref={remoteVideoRef} autoPlay playsInline onLoadedMetadata={(e) => e.target.play().catch(console.error)}></video>
          </div>
        </div>

        {/* Floating Chat */}
        <div className="floating-chat">
          <div className="messages-area">
            {messages.map((msg, i) => (
              <div key={i} className={`msg-bubble msg-${msg.type}`}>
                {msg.text}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form className="chat-input-wrapper" onSubmit={sendMessage}>
            <input 
              type="text" 
              placeholder="Type a message..." 
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              disabled={!isConnected}
            />
            <button type="submit" className="send-btn" disabled={!isConnected || !inputMessage.trim()}>
              <Send size={16} />
            </button>
          </form>
        </div>

        {/* Main Controls (Spark & Next) */}
        <div className="main-controls">
          <button className={`action-btn spark-btn ${sparkSent ? 'active' : ''}`} onClick={handleSpark} disabled={!isConnected || sparkSent}>
            <Zap size={20} />
            {sparkSent ? 'Spark Sent!' : 'Spark'}
          </button>
          
          <button className="action-btn next-btn" onClick={handleNext}>
            <SkipForward size={20} /> Next
          </button>
        </div>

        {/* Match / Wait Overlays */}
        {isMatching && (
          <div className="status-overlay">
            <div className="loader"></div>
            <h2>Finding your vibe...</h2>
            {/* Loading Screen Ad Placeholder */}
            <div className="ad-container">
               <span className="ad-label">Advertisement</span>
               <div className="ad-content">
                  <h3>Your Ad Here</h3>
                  <p>Reach thousands of active users!</p>
               </div>
            </div>
          </div>
        )}
        
        {mutualSpark && (
          <div className="mutual-spark-overlay">
            <Heart size={80} color="#f43f5e" fill="#f43f5e" style={{marginBottom: '20px', animation: 'pulse 1s infinite'}} />
            <h2>MUTUAL SPARK!</h2>
            <p style={{marginTop: '10px', fontSize: '1.2rem'}}>You both liked each other!</p>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
