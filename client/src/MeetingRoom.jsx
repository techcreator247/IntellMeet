
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./MeetingRoom.css";

const SOCKET_URL = "https://intellmeet-844o.onrender.com";

const ICE_SERVERS = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302"
    }
  ]
};

// Video component
function VideoTile({ stream, name, isLocal = false, micOn }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream || null;
    }
  }, [stream]);

  return (
    <div className="video-tile">
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          style={{
            width: "100%",
            minHeight: "200px",
            height: "100%",
            objectFit: "contain",
            background: "#111",
            borderRadius: "12px"
          }}
        />
      ) : (
        <div className="avatar-circle">
          {name?.charAt(0)?.toUpperCase() || "U"}
        </div>
      )}

      <h3>{name}</h3>

      <span className="tile-caption">
        {isLocal ? "You" : "Participant"}
      </span>

      <div className="tile-status">
        {micOn ? "🎙 Mic on" : "🔇 Mic muted"}
      </div>
    </div>
  );
}

function MeetingRoom({ meeting, user, onLeave }) {
  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);

  const peerConnections = useRef(new Map());
  const pendingCandidates = useRef(new Map());
  const messagesEndRef = useRef(null);
  const transcriptEndRef = useRef(null);

  const recognitionRef = useRef(null);
  const transcriptionEnabledRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);

  const [participants, setParticipants] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);

  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [mediaError, setMediaError] = useState("");

  // TRANSCRIPTION STATES
  const [transcript, setTranscript] = useState([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [activePanel, setActivePanel] = useState("chat");
  const [transcriptionError, setTranscriptionError] = useState("");

  // MEETING SUMMARY STATES
  const [meetingSummary, setMeetingSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");

  // RECEIVE TRANSCRIPT FROM PARTICIPANTS
  useEffect(() => {
    const socket = socketRef.current;

    if (!socket) return;

    const handleTranscript = (data) => {
      setTranscript((previous) => [
        ...previous,
        {
          id: data.id || `${Date.now()}-${Math.random()}`,
          text: data.text,
          sender: data.sender || "Anonymous",
          time: data.time || new Date()
        }
      ]);
    };

    socket.on("receive-transcript", handleTranscript);

    return () => {
      socket.off("receive-transcript", handleTranscript);
    };
  }, [connected]);

  // RECEIVE GENERATED MEETING SUMMARY
  useEffect(() => {
    const socket = socketRef.current;

    if (!socket) return;

    const handleSummary = (data) => {
      setSummaryLoading(false);

      if (!data.success) {
        setSummaryError(
          data.message || "Unable to generate summary."
        );
        return;
      }

      setMeetingSummary(data);
      setSummaryError("");
    };

    socket.on("meeting-summary", handleSummary);

    return () => {
      socket.off("meeting-summary", handleSummary);
    };
  }, [connected]);

  // AUTO-SCROLL TRANSCRIPT
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({
      behavior: "smooth"
    });
  }, [transcript]);

  // MAIN MEETING INITIALIZATION
  useEffect(() => {
    let active = true;
    let socket;
    let peerConfiguration = ICE_SERVERS;

    // CREATE WEBRTC PEER CONNECTION
    const createPeerConnection = (userId) => {
      if (peerConnections.current.has(userId)) {
        return peerConnections.current.get(userId);
      }

      const peer = new RTCPeerConnection(peerConfiguration);
      const stream = localStreamRef.current;
      const screenStream = screenStreamRef.current;

      if (stream) {
        stream.getAudioTracks().forEach((track) => {
          peer.addTrack(track, stream);
        });

        const videoTrack =
          screenStream?.getVideoTracks()[0] ||
          stream.getVideoTracks()[0];

        if (videoTrack) {
          peer.addTrack(videoTrack, screenStream || stream);
        }
      }

      peer.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit("webrtc-ice-candidate", {
            to: userId,
            candidate: event.candidate
          });
        }
      };

      peer.ontrack = (event) => {
        const remoteStream =
          event.streams[0] ||
          new MediaStream([event.track]);

        setRemoteStreams((previous) => {
          const exists = previous.some(
            (item) => item.userId === userId
          );

          if (exists) {
            return previous.map((item) =>
              item.userId === userId
                ? { ...item, stream: remoteStream }
                : item
            );
          }

          return [
            ...previous,
            {
              userId,
              stream: remoteStream
            }
          ];
        });
      };

      peer.onconnectionstatechange = () => {
        console.log(
          `WebRTC connection with ${userId}:`,
          peer.connectionState
        );
      };

      peerConnections.current.set(userId, peer);

      return peer;
    };

    // PROCESS PENDING ICE CANDIDATES
    const flushCandidates = async (userId, peer) => {
      const candidates =
        pendingCandidates.current.get(userId) || [];

      pendingCandidates.current.delete(userId);

      for (const candidate of candidates) {
        try {
          await peer.addIceCandidate(
            new RTCIceCandidate(candidate)
          );
        } catch (error) {
          console.error("ICE candidate error:", error);
        }
      }
    };

    // CREATE WEBRTC OFFER
    const createOffer = async (userId) => {
      try {
        const peer = createPeerConnection(userId);
        const offer = await peer.createOffer();

        await peer.setLocalDescription(offer);

        socket.emit("webrtc-offer", {
          to: userId,
          offer: peer.localDescription
        });
      } catch (error) {
        console.error("Offer creation error:", error);
      }
    };

    // INITIALIZE MEETING
    const initializeMeeting = async () => {
      // LOAD METERED TURN SERVERS
      try {
        const response = await fetch(
          "https://intellmeet-webrtc.metered.live/api/v1/turn/credentials?apiKey=ed47e7d41c574933fa451fd45811e3068b34"
        );

        if (!response.ok) {
          throw new Error(`TURN API error: ${response.status}`);
        }

        const iceServers = await response.json();

        if (!Array.isArray(iceServers) || iceServers.length === 0) {
          throw new Error("Invalid TURN server response");
        }

        peerConfiguration = { iceServers };

        console.log(
          "Metered TURN servers loaded:",
          iceServers.length
        );
      } catch (error) {
        console.error(
          "TURN unavailable. Using Google STUN fallback:",
          error
        );

        peerConfiguration = ICE_SERVERS;
      }

      if (!active) return;

      // STEP 1: ACCESS CAMERA AND MICROPHONE
      try {
        const stream =
          await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
          });

        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        localStreamRef.current = stream;
        setLocalStream(stream);
      } catch (error) {
        console.error("Camera/Microphone error:", error);

        if (active) {
          setMediaError(
            "Camera or microphone permission denied. Please allow access."
          );
        }
      }

      if (!active) return;

      // STEP 2: CONNECT SOCKET.IO
      socket = io(SOCKET_URL);
      socketRef.current = socket;

      socket.on("connect", () => {
        setConnected(true);
        socket.emit("join-room", meeting.roomId);
      });

      socket.on("disconnect", () => {
        setConnected(false);
      });

      socket.on("connect_error", (error) => {
        console.error("Socket connection error:", error.message);
      });

      // STEP 3: RECEIVE EXISTING PARTICIPANTS
      socket.on("existing-users", (users) => {
        setParticipants(users);

        users.forEach((userId) => {
          createOffer(userId);
        });
      });

      // STEP 4: NEW PARTICIPANT JOINED
      socket.on("user-joined", (data) => {
        const userId = data.userId;

        setParticipants((previous) =>
          previous.includes(userId)
            ? previous
            : [...previous, userId]
        );

        console.log("New participant:", userId);
      });

      // STEP 5: RECEIVE WEBRTC OFFER
      socket.on("webrtc-offer", async ({ from, offer }) => {
        try {
          const peer = createPeerConnection(from);

          await peer.setRemoteDescription(
            new RTCSessionDescription(offer)
          );

          await flushCandidates(from, peer);

          const answer = await peer.createAnswer();

          await peer.setLocalDescription(answer);

          socket.emit("webrtc-answer", {
            to: from,
            answer: peer.localDescription
          });
        } catch (error) {
          console.error("Answer creation error:", error);
        }
      });

      // STEP 6: RECEIVE WEBRTC ANSWER
      socket.on("webrtc-answer", async ({ from, answer }) => {
        try {
          const peer = peerConnections.current.get(from);

          if (!peer) return;

          await peer.setRemoteDescription(
            new RTCSessionDescription(answer)
          );

          await flushCandidates(from, peer);
        } catch (error) {
          console.error("Remote answer error:", error);
        }
      });

      // STEP 7: EXCHANGE ICE CANDIDATES
      socket.on("webrtc-ice-candidate", async ({ from, candidate }) => {
        try {
          const peer = peerConnections.current.get(from);

          if (!peer || !peer.remoteDescription) {
            const previous =
              pendingCandidates.current.get(from) || [];

            pendingCandidates.current.set(from, [
              ...previous,
              candidate
            ]);

            return;
          }

          await peer.addIceCandidate(
            new RTCIceCandidate(candidate)
          );
        } catch (error) {
          console.error("ICE candidate error:", error);
        }
      });

      // STEP 8: PARTICIPANT LEFT
      socket.on("user-left", (data) => {
        const userId =
          typeof data === "string" ? data : data.userId;

        setParticipants((previous) =>
          previous.filter((id) => id !== userId)
        );

        const peer = peerConnections.current.get(userId);

        if (peer) {
          peer.close();
          peerConnections.current.delete(userId);
        }

        pendingCandidates.current.delete(userId);

        setRemoteStreams((previous) =>
          previous.filter((item) => item.userId !== userId)
        );
      });

      // STEP 9: RECEIVE CHAT MESSAGES
      socket.on("receive-message", (data) => {
        setMessages((previous) => [
          ...previous,
          {
            id: `${Date.now()}-${Math.random()}`,
            message: data.message,
            sender: data.sender || "Anonymous",
            time: data.time
          }
        ]);
      });
    };

    initializeMeeting();

    // CLEANUP
    return () => {
      active = false;

      transcriptionEnabledRef.current = false;

      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }

      if (socketRef.current) {
        socketRef.current.emit("leave-room", meeting.roomId);
        socketRef.current.disconnect();
        socketRef.current = null;
      }

      peerConnections.current.forEach((peer) => {
        peer.close();
      });

      peerConnections.current.clear();
      pendingCandidates.current.clear();

      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => {
          track.stop();
        });

        screenStreamRef.current = null;
      }

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          track.stop();
        });

        localStreamRef.current = null;
      }
    };
  }, [meeting.roomId]);

  // AUTO-SCROLL CHAT
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth"
    });
  }, [messages]);

  // SEND CHAT MESSAGE
  const sendMessage = (e) => {
    e.preventDefault();

    if (!message.trim() || !socketRef.current?.connected) {
      return;
    }

    socketRef.current.emit("send-message", {
      roomId: meeting.roomId,
      message: message.trim(),
      sender: user?.name || "Anonymous"
    });

    setMessage("");
  };

  // START LIVE TRANSCRIPTION
  const startTranscription = () => {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setTranscriptionError(
        "Speech recognition is not supported by this browser. Please try Google Chrome."
      );
      return;
    }

    if (!socketRef.current?.connected) {
      setTranscriptionError(
        "Please wait until the meeting is connected."
      );
      return;
    }

    if (transcriptionEnabledRef.current) return;

    try {
      const recognition = new SpeechRecognition();

      recognitionRef.current = recognition;
      transcriptionEnabledRef.current = true;

      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsTranscribing(true);
        setTranscriptionError("");
      };

      recognition.onresult = (event) => {
        for (
          let i = event.resultIndex;
          i < event.results.length;
          i++
        ) {
          const result = event.results[i];

          if (!result.isFinal) continue;

          const recognizedText = result[0].transcript.trim();

          if (!recognizedText) continue;

          socketRef.current?.emit("send-transcript", {
            roomId: meeting.roomId,
            text: recognizedText,
            sender: user?.name || "Anonymous"
          });
        }
      };

      recognition.onerror = (event) => {
        console.error(
          "Speech recognition error:",
          event.error
        );

        if (event.error === "no-speech") {
          setTranscriptionError(
            "No speech detected. Please speak clearly."
          );
          return;
        }

        transcriptionEnabledRef.current = false;
        setIsTranscribing(false);

        if (
          event.error === "not-allowed" ||
          event.error === "service-not-allowed"
        ) {
          setTranscriptionError(
            "Microphone permission denied. Allow microphone access in Chrome."
          );
        } else if (event.error === "network") {
          setTranscriptionError(
            "Chrome speech recognition service is unavailable. Check your internet connection and try again."
          );
        } else {
          setTranscriptionError(
            `Transcription failed: ${event.error}`
          );
        }
      };

      recognition.onend = () => {
        if (transcriptionEnabledRef.current) {
          try {
            recognition.start();
          } catch (error) {
            console.error(
              "Recognition restart error:",
              error
            );

            transcriptionEnabledRef.current = false;
            setIsTranscribing(false);

            setTranscriptionError(
              "Unable to restart speech recognition. Please try again."
            );
          }
        } else {
          setIsTranscribing(false);
        }
      };

      recognition.start();
    } catch (error) {
      console.error(
        "Unable to start transcription:",
        error
      );

      transcriptionEnabledRef.current = false;
      setIsTranscribing(false);

      setTranscriptionError(
        "Unable to start speech recognition."
      );
    }
  };

  // STOP LIVE TRANSCRIPTION
  const stopTranscription = () => {
    transcriptionEnabledRef.current = false;

    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    setIsTranscribing(false);
    setTranscriptionError("");
  };

  // CLEAR TRANSCRIPT FROM CURRENT SCREEN
  const clearTranscript = () => {
    if (
      window.confirm(
        "Are you sure you want to clear the transcript displayed here?"
      )
    ) {
      setTranscript([]);
    }
  };

  // GENERATE MEETING SUMMARY
  const generateMeetingSummary = () => {
    if (!socketRef.current?.connected) {
      setSummaryError("Meeting connection is unavailable.");
      return;
    }

    if (transcript.length === 0) {
      setSummaryError(
        "No transcript available. Start transcription first."
      );
      return;
    }

    setSummaryLoading(true);
    setSummaryError("");
    setMeetingSummary(null);

    socketRef.current.emit("generate-summary", {
      roomId: meeting.roomId
    });
  };

  // COPY ROOM ID
  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(meeting.roomId);
      alert("Meeting Room ID copied!");
    } catch {
      alert("Unable to copy Room ID.");
    }
  };

  // MUTE / UNMUTE MICROPHONE
  const toggleMic = () => {
    const tracks =
      localStreamRef.current?.getAudioTracks() || [];

    const nextValue = !micOn;

    tracks.forEach((track) => {
      track.enabled = nextValue;
    });

    setMicOn(nextValue);
  };

  // CAMERA ON / OFF
  const toggleCamera = () => {
    const tracks =
      localStreamRef.current?.getVideoTracks() || [];

    const nextValue = !cameraOn;

    tracks.forEach((track) => {
      track.enabled = nextValue;
    });

    setCameraOn(nextValue);
  };

  // START SCREEN SHARING
  const startScreenSharing = async () => {
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        alert("Screen sharing is not supported by this browser.");
        return;
      }

      const screenStream =
        await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        });

      const screenTrack = screenStream.getVideoTracks()[0];

      if (!screenTrack) {
        screenStream.getTracks().forEach((track) => track.stop());
        return;
      }

      screenStreamRef.current = screenStream;

      const replacements = [];

      for (const peer of peerConnections.current.values()) {
        const sender = peer
          .getSenders()
          .find((item) => item.track?.kind === "video");

        if (sender) {
          replacements.push(sender.replaceTrack(screenTrack));
        }
      }

      await Promise.all(replacements);

      const previewTracks = [
        ...(localStreamRef.current?.getAudioTracks() || []),
        screenTrack
      ];

      setLocalStream(new MediaStream(previewTracks));
      setIsScreenSharing(true);

      screenTrack.onended = () => {
        stopScreenSharing();
      };
    } catch (error) {
      console.error("Screen sharing error:", error);

      if (error.name !== "NotAllowedError") {
        alert("Unable to start screen sharing.");
      }
    }
  };

  // STOP SCREEN SHARING
  const stopScreenSharing = async () => {
    const screenStream = screenStreamRef.current;

    if (!screenStream) return;

    screenStreamRef.current = null;

    const cameraTrack =
      localStreamRef.current?.getVideoTracks()[0];

    try {
      if (cameraTrack) {
        for (const peer of peerConnections.current.values()) {
          const sender = peer
            .getSenders()
            .find((item) => item.track?.kind === "video");

          if (sender) {
            await sender.replaceTrack(cameraTrack);
          }
        }
      }

      screenStream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });

      setLocalStream(localStreamRef.current);
      setIsScreenSharing(false);
    } catch (error) {
      console.error("Error stopping screen sharing:", error);

      setLocalStream(localStreamRef.current);
      setIsScreenSharing(false);
    }
  };

  // TOGGLE SCREEN SHARING
  const toggleScreenShare = () => {
    if (isScreenSharing) {
      stopScreenSharing();
    } else {
      startScreenSharing();
    }
  };

  // LEAVE MEETING
  const leaveMeeting = () => {
    stopTranscription();
    onLeave();
  };

  return (
    <div className="meeting-page">
      <header className="meeting-header">
        <div className="meeting-brand">
          <span className="meeting-logo">I</span>
          <span>IntellMeet</span>
        </div>

        <div className="meeting-heading">
          <h2>{meeting.title}</h2>

          <span
            className={
              connected
                ? "connection online"
                : "connection"
            }
          >
            ● {connected ? "Connected" : "Connecting..."}
          </span>
        </div>

        <button className="room-id-button" onClick={copyRoomId}>
          Room ID: {meeting.roomId} ⧉
        </button>
      </header>

      <main className="meeting-layout">
        <section className="video-section">
          <div className="video-topbar">
            <div>
              <h2>Meeting Room</h2>

              <p>
                {participants.length + 1} participant
                {participants.length !== 0 ? "s" : ""} in this room
              </p>
            </div>

            <span className="live-indicator">● LIVE ROOM</span>
          </div>

          {mediaError && (
            <div className="media-notice">{mediaError}</div>
          )}

          <div className="video-grid">
            <VideoTile
              stream={localStream}
              name={
                isScreenSharing
                  ? `${user?.name || "You"} (Sharing screen)`
                  : user?.name || "You"
              }
              isLocal={true}
              micOn={micOn}
            />

            {remoteStreams.map((item) => (
              <VideoTile
                key={item.userId}
                stream={item.stream}
                name="Participant"
                micOn={true}
              />
            ))}

            {participants.length > remoteStreams.length && (
              <div className="video-tile waiting-tile">
                <div className="waiting-icon">👥</div>
                <h3>Connecting participants...</h3>
                <p>Please wait for their video.</p>
              </div>
            )}

            {participants.length === 0 && (
              <div className="video-tile waiting-tile">
                <div className="waiting-icon">👥</div>
                <h3>Waiting for participants</h3>
                <p>Share your Room ID to invite others.</p>

                <button onClick={copyRoomId}>
                  Copy invitation ID
                </button>
              </div>
            )}
          </div>

          <div className="meeting-controls">
            <button
              className={
                !micOn ? "control-btn control-off" : "control-btn"
              }
              onClick={toggleMic}
            >
              {micOn ? "🎙 Mute" : "🔇 Unmute"}
            </button>

            <button
              className={
                !cameraOn
                  ? "control-btn control-off"
                  : "control-btn"
              }
              onClick={toggleCamera}
              disabled={isScreenSharing}
              title={
                isScreenSharing
                  ? "Stop screen sharing before changing camera"
                  : "Toggle camera"
              }
            >
              {cameraOn ? "📹 Camera off" : "📷 Camera on"}
            </button>

            <button
              className={
                isScreenSharing
                  ? "control-btn control-off"
                  : "control-btn"
              }
              onClick={toggleScreenShare}
            >
              {isScreenSharing
                ? "🛑 Stop Sharing"
                : "🖥 Share Screen"}
            </button>

            <button className="leave-btn" onClick={leaveMeeting}>
              ☎ Leave Meeting
            </button>
          </div>
        </section>

        <aside className="chat-panel">
          {/* CHAT, TRANSCRIPT AND SUMMARY TABS */}
          <div
            style={{
              display: "flex",
              gap: "8px",
              padding: "12px",
              borderBottom: "1px solid #ddd"
            }}
          >
            <button
              onClick={() => setActivePanel("chat")}
              style={{
                flex: 1,
                padding: "10px",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                background:
                  activePanel === "chat" ? "#4f46e5" : "#eee",
                color:
                  activePanel === "chat" ? "#fff" : "#333"
              }}
            >
              💬 Chat
            </button>

            <button
              onClick={() => setActivePanel("transcript")}
              style={{
                flex: 1,
                padding: "10px",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                background:
                  activePanel === "transcript" ? "#4f46e5" : "#eee",
                color:
                  activePanel === "transcript" ? "#fff" : "#333"
              }}
            >
              📝 Transcript
            </button>

            <button
              onClick={() => setActivePanel("summary")}
              style={{
                flex: 1,
                padding: "10px",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                background:
                  activePanel === "summary" ? "#4f46e5" : "#eee",
                color:
                  activePanel === "summary" ? "#fff" : "#333"
              }}
            >
              ✨ Summary
            </button>
          </div>

          {/* CHAT PANEL */}
          {activePanel === "chat" ? (
            <>
              <div className="chat-header">
                <div>
                  <h2>Meeting Chat</h2>
                  <p>Communicate with your team</p>
                </div>

                <span>💬</span>
              </div>

              <div className="chat-messages">
                {messages.length === 0 ? (
                  <div className="empty-chat">
                    <span>💬</span>
                    <h3>No messages yet</h3>
                    <p>Send the first message to your team!</p>
                  </div>
                ) : (
                  messages.map((item) => (
                    <div className="chat-message" key={item.id}>
                      <strong>{item.sender}</strong>
                      <p>{item.message}</p>

                      <small>
                        {item.time
                          ? new Date(item.time).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit"
                            })
                          : ""}
                      </small>
                    </div>
                  ))
                )}

                <div ref={messagesEndRef} />
              </div>

              <form className="chat-input-area" onSubmit={sendMessage}>
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />

                <button
                  type="submit"
                  disabled={!connected || !message.trim()}
                >
                  ➤
                </button>
              </form>
            </>

          ) : activePanel === "transcript" ? (
            <>
              <div className="chat-header">
                <div>
                  <h2>Live Transcription</h2>
                  <p>Automatic speech-to-text</p>
                </div>

                <span>📝</span>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  padding: "12px"
                }}
              >
                <button
                  onClick={startTranscription}
                  disabled={isTranscribing || !connected}
                  style={{
                    flex: 1,
                    padding: "10px",
                    border: "none",
                    borderRadius: "8px",
                    background: "#16a34a",
                    color: "#fff",
                    cursor: "pointer",
                    opacity:
                      isTranscribing || !connected ? 0.5 : 1
                  }}
                >
                  ▶ Start
                </button>

                <button
                  onClick={stopTranscription}
                  disabled={!isTranscribing}
                  style={{
                    flex: 1,
                    padding: "10px",
                    border: "none",
                    borderRadius: "8px",
                    background: "#dc2626",
                    color: "#fff",
                    cursor: "pointer",
                    opacity: !isTranscribing ? 0.5 : 1
                  }}
                >
                  ■ Stop
                </button>
              </div>

              <div
                style={{
                  padding: "0 12px 10px",
                  fontSize: "13px",
                  color: isTranscribing ? "#16a34a" : "#777"
                }}
              >
                ●{" "}
                {isTranscribing
                  ? "Transcription is active"
                  : "Transcription is stopped"}
              </div>

              {transcriptionError && (
                <div
                  className="media-notice"
                  style={{ margin: "0 12px 10px" }}
                >
                  {transcriptionError}
                </div>
              )}

              <div
                className="chat-messages"
                style={{ padding: "12px" }}
              >
                {transcript.length === 0 ? (
                  <div className="empty-chat">
                    <span>🎙️</span>
                    <h3>No transcript yet</h3>
                    <p>
                      Click Start and speak clearly.
                      Recognized speech will appear here.
                    </p>
                  </div>
                ) : (
                  transcript.map((item) => (
                    <div key={item.id} className="chat-message">
                      <strong>{item.sender}</strong>
                      <p>{item.text}</p>

                      <small>
                        {new Date(item.time).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit"
                        })}
                      </small>
                    </div>
                  ))
                )}

                <div ref={transcriptEndRef} />
              </div>

              <div
                style={{
                  padding: "10px 12px",
                  borderTop: "1px solid #ddd",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
              >
                <small>
                  {transcript.length} transcript entries
                </small>

                <button
                  onClick={clearTranscript}
                  disabled={transcript.length === 0}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#dc2626",
                    cursor: "pointer"
                  }}
                >
                  Clear
                </button>
              </div>
            </>

          ) : (
            // MEETING SUMMARY PANEL
            <>
              <div className="chat-header">
                <div>
                  <h2>AI Meeting Summary</h2>
                  <p>Meeting highlights and action items</p>
                </div>

                <span>✨</span>
              </div>

              <div style={{ padding: "15px", overflowY: "auto" }}>
                <button
                  onClick={generateMeetingSummary}
                  disabled={
                    summaryLoading ||
                    !connected ||
                    transcript.length === 0
                  }
                  style={{
                    width: "100%",
                    padding: "12px",
                    border: "none",
                    borderRadius: "8px",
                    background: "#4f46e5",
                    color: "white",
                    cursor: "pointer",
                    opacity:
                      summaryLoading ||
                      !connected ||
                      transcript.length === 0
                        ? 0.5
                        : 1
                  }}
                >
                  {summaryLoading
                    ? "Generating Summary..."
                    : "✨ Generate Meeting Summary"}
                </button>

                {summaryError && (
                  <div
                    className="media-notice"
                    style={{ marginTop: "12px" }}
                  >
                    {summaryError}
                  </div>
                )}

                {!meetingSummary &&
                  !summaryLoading &&
                  !summaryError && (
                    <div
                      className="empty-chat"
                      style={{ marginTop: "20px" }}
                    >
                      <span>📝</span>
                      <h3>No Summary Yet</h3>
                      <p>
                        Start transcription and generate a summary
                        after discussing your meeting topics.
                      </p>
                    </div>
                  )}

                {meetingSummary && (
                  <div style={{ marginTop: "20px" }}>
                    <h3>📋 Meeting Overview</h3>

                    <p style={{ lineHeight: "1.6" }}>
                      {meetingSummary.summary}
                    </p>

                    <hr />

                    <h3>🔑 Key Discussion Points</h3>

                    {meetingSummary.keyPoints?.length > 0 ? (
                      <ul style={{ paddingLeft: "20px", lineHeight: "1.8" }}>
                        {meetingSummary.keyPoints.map((point, index) => (
                          <li key={index}>{point}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No key points identified.</p>
                    )}

                    <hr />

                    <h3>✅ Action Items</h3>

                    {meetingSummary.actionItems?.length > 0 ? (
                      meetingSummary.actionItems.map((item, index) => (
                        <div
                          key={index}
                          style={{
                            padding: "10px",
                            marginBottom: "10px",
                            background: "#f3f4f6",
                            borderRadius: "8px"
                          }}
                        >
                          <p>{item.text}</p>

                          <small>
                            Possible responsible participant:{" "}
                            {item.assignedTo}
                          </small>
                        </div>
                      ))
                    ) : (
                      <p>No possible action items identified.</p>
                    )}

                    <hr />

                    <small>
                      Transcript entries processed:{" "}
                      {meetingSummary.transcriptCount}
                    </small>

                    <p>
                      <small>
                        Generated:{" "}
                        {new Date(
                          meetingSummary.generatedAt
                        ).toLocaleString()}
                      </small>
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}

export default MeetingRoom;
