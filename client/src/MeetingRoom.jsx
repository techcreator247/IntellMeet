
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
            objectFit: "cover",
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
  const peerConnections = useRef(new Map());
  const pendingCandidates = useRef(new Map());
  const messagesEndRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);

  const [participants, setParticipants] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);

  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [mediaError, setMediaError] = useState("");

  useEffect(() => {
    let active = true;
    let socket;
    let peerConfiguration = ICE_SERVERS;

    const createPeerConnection = (userId) => {
      if (peerConnections.current.has(userId)) {
        return peerConnections.current.get(userId);
      }

      const peer = new RTCPeerConnection(peerConfiguration);

      const stream = localStreamRef.current;

      if (stream) {
        stream.getTracks().forEach((track) => {
          peer.addTrack(track, stream);
        });
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

    const initializeMeeting = async () => {
      // Load Metered TURN servers before creating peer connections
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

      // STEP 1: Access camera and microphone
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
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

      // STEP 2: Connect Socket.IO
      socket = io(SOCKET_URL);
      socketRef.current = socket;

      socket.on("connect", () => {
        setConnected(true);

        socket.emit("join-room", meeting.roomId);
      });

      socket.on("disconnect", () => {
        setConnected(false);
      });

      // STEP 3: Receive existing participants
      socket.on("existing-users", (users) => {
        setParticipants(users);

        users.forEach((userId) => {
          createOffer(userId);
        });
      });

      // STEP 4: New participant joined
      socket.on("user-joined", (data) => {
        const userId = data.userId;

        setParticipants((previous) =>
          previous.includes(userId)
            ? previous
            : [...previous, userId]
        );

        console.log("New participant:", userId);
      });

      // STEP 5: Receive WebRTC offer
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

      // STEP 6: Receive WebRTC answer
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

      // STEP 7: Exchange ICE candidates
      socket.on(
        "webrtc-ice-candidate",
        async ({ from, candidate }) => {
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
        }
      );

      // STEP 8: Participant left
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

      // STEP 9: Receive chat messages
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

    return () => {
      active = false;

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

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          track.stop();
        });

        localStreamRef.current = null;
      }
    };
  }, [meeting.roomId]);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth"
    });
  }, [messages]);

  // Send chat message
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

  // Copy Room ID
  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(meeting.roomId);
      alert("Meeting Room ID copied!");
    } catch {
      alert("Unable to copy Room ID.");
    }
  };

  // Mute / Unmute microphone
  const toggleMic = () => {
    const tracks = localStreamRef.current?.getAudioTracks() || [];

    const nextValue = !micOn;

    tracks.forEach((track) => {
      track.enabled = nextValue;
    });

    setMicOn(nextValue);
  };

  // Camera On / Off
  const toggleCamera = () => {
    const tracks = localStreamRef.current?.getVideoTracks() || [];

    const nextValue = !cameraOn;

    tracks.forEach((track) => {
      track.enabled = nextValue;
    });

    setCameraOn(nextValue);
  };

  // Leave meeting
  const leaveMeeting = () => {
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

          <span className={connected ? "connection online" : "connection"}>
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

            <span className="live-indicator">
              ● LIVE ROOM
            </span>
          </div>

          {mediaError && (
            <div className="media-notice">
              {mediaError}
            </div>
          )}

          <div className="video-grid">

            <VideoTile
              stream={localStream}
              name={user?.name || "You"}
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
              className={!micOn ? "control-btn control-off" : "control-btn"}
              onClick={toggleMic}
            >
              {micOn ? "🎙 Mute" : "🔇 Unmute"}
            </button>

            <button
              className={!cameraOn ? "control-btn control-off" : "control-btn"}
              onClick={toggleCamera}
            >
              {cameraOn ? "📹 Camera off" : "📷 Camera on"}
            </button>

            <button
              className="leave-btn"
              onClick={leaveMeeting}
            >
              ☎ Leave Meeting
            </button>

          </div>

        </section>

        <aside className="chat-panel">

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

        </aside>

      </main>

    </div>
  );
}

export default MeetingRoom;
