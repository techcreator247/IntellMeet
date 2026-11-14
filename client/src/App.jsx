
import { useState } from "react";
import "./App.css";
import MeetingRoom from "./MeetingRoom";

// API URLS
const API_URL = "https://intellmeet-844o.onrender.com/api/auth";
const MEETING_API_URL = "https://intellmeet-844o.onrender.com/api/meetings";

function App() {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);

  const [meetingTitle, setMeetingTitle] = useState("");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [meeting, setMeeting] = useState(null);
  const [activeMeeting, setActiveMeeting] = useState(null);
  const [meetingLoading, setMeetingLoading] = useState(false);
  const [meetingError, setMeetingError] = useState("");

  // COMMON HEADERS
  const getHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("intellmeet_token")}`,
  });

  // LOGIN / REGISTER
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = isLogin ? "/login" : "/register";

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          isLogin
            ? { email, password }
            : { name, email, password }
        ),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Authentication failed");
      }

      localStorage.setItem("intellmeet_token", data.token);
      setUser(data.user);
      setError("");

    } catch (err) {
      console.error("Authentication error:", err);
      setError(err.message || "Unable to connect to server");
    } finally {
      setLoading(false);
    }
  };

  // CREATE MEETING
  const handleCreateMeeting = async (e) => {
    e.preventDefault();
    setMeetingError("");
    setMeetingLoading(true);

    try {
      const response = await fetch(MEETING_API_URL, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          title: meetingTitle,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Unable to create meeting");
      }

      setMeeting(data.meeting);
      setActiveMeeting(data.meeting);
      setMeetingTitle("");

    } catch (err) {
      console.error("Create meeting error:", err);
      setMeetingError(err.message || "Unable to create meeting");
    } finally {
      setMeetingLoading(false);
    }
  };

  // JOIN MEETING
  const handleJoinMeeting = async (e) => {
    e.preventDefault();
    setMeetingError("");
    setMeetingLoading(true);

    try {
      const roomId = roomIdInput.trim();

      const response = await fetch(
        `${MEETING_API_URL}/${encodeURIComponent(roomId)}/join`,
        {
          method: "POST",
          headers: getHeaders(),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Unable to join meeting");
      }

      setMeeting(data.meeting);
      setActiveMeeting(data.meeting);

    } catch (err) {
      console.error("Join meeting error:", err);
      setMeetingError(err.message || "Unable to join meeting");
    } finally {
      setMeetingLoading(false);
    }
  };

  // LOGOUT
  const handleLogout = () => {
    localStorage.removeItem("intellmeet_token");

    setUser(null);
    setMeeting(null);
    setActiveMeeting(null);
    setEmail("");
    setPassword("");
    setName("");
    setMeetingError("");
    setError("");
  };

  // MEETING ROOM
  if (activeMeeting && user) {
    return (
      <MeetingRoom
        meeting={activeMeeting}
        user={user}
        onLeave={() => setActiveMeeting(null)}
      />
    );
  }

  // DASHBOARD
  if (user) {
    return (
      <div className="dashboard">
        <nav className="navbar">
          <div className="brand">
            <span className="brand-icon">I</span>
            IntellMeet
          </div>

          <button className="logout-btn" onClick={handleLogout}>
            Logout
          </button>
        </nav>

        <main className="welcome-section">
          <div className="welcome-tag">YOUR WORKSPACE</div>

          <h1>
            Welcome back, <span>{user.name}!</span>
          </h1>

          <p>
            Your intelligent meeting workspace is ready.
            Collaborate, connect and make every meeting productive.
          </p>

          <div className="dashboard-grid">

            {/* CREATE MEETING */}
            <div className="dashboard-card">
              <div className="card-icon">🎥</div>
              <h3>Start a Meeting</h3>
              <p>Create a new meeting room for your team.</p>

              <form onSubmit={handleCreateMeeting}>
                <input
                  type="text"
                  placeholder="Enter meeting title"
                  value={meetingTitle}
                  onChange={(e) => setMeetingTitle(e.target.value)}
                  required
                />

                <button
                  className="submit-btn"
                  type="submit"
                  disabled={meetingLoading}
                >
                  {meetingLoading ? "Please wait..." : "Create Meeting"}
                </button>
              </form>
            </div>

            {/* JOIN MEETING */}
            <div className="dashboard-card">
              <div className="card-icon">👥</div>
              <h3>Join a Meeting</h3>
              <p>Enter a room ID to join an existing meeting.</p>

              <form onSubmit={handleJoinMeeting}>
                <input
                  type="text"
                  placeholder="Enter meeting Room ID"
                  value={roomIdInput}
                  onChange={(e) => setRoomIdInput(e.target.value)}
                  required
                />

                <button
                  className="submit-btn"
                  type="submit"
                  disabled={meetingLoading}
                >
                  {meetingLoading ? "Please wait..." : "Join Meeting"}
                </button>
              </form>
            </div>

            {/* AI ASSISTANT */}
            <div className="dashboard-card">
              <div className="card-icon">🤖</div>
              <h3>AI Meeting Assistant</h3>
              <p>
                Get intelligent meeting summaries and action items.
              </p>

              <button disabled className="coming-btn">
                Coming soon
              </button>
            </div>

          </div>

          {meetingError && (
            <div className="error-message">
              {meetingError}
            </div>
          )}

          {meeting && (
            <div className="account-info meeting-info">
              <h2>Meeting Details</h2>

              <p>
                <strong>Title:</strong> {meeting.title}
              </p>

              <p>
                <strong>Room ID:</strong> {meeting.roomId}
              </p>

              <p>
                <strong>Status:</strong> {meeting.status}
              </p>

              <button
                className="submit-btn"
                onClick={() => {
                  navigator.clipboard.writeText(meeting.roomId);
                }}
              >
                Copy Room ID
              </button>
            </div>
          )}

          <div className="account-info">
            <strong>Account information</strong>

            <p>Name: {user.name}</p>
            <p>Email: {user.email}</p>

            <span className="status">
              ● Authenticated
            </span>
          </div>

        </main>
      </div>
    );
  }

  // LOGIN / REGISTER PAGE
  return (
    <div className="app-container">

      <div className="left-panel">
        <nav className="navbar">
          <div className="brand">
            <span className="brand-icon">I</span>
            IntellMeet
          </div>

          <span className="nav-caption">
            SMARTER MEETINGS
          </span>
        </nav>

        <div className="hero-content">

          <div className="hero-badge">
            <span>✦</span> AI-POWERED COLLABORATION
          </div>

          <h1>
            Meetings that
            <br />
            <span>move ideas</span>
            <br />
            forward.
          </h1>

          <p>
            Connect your team, collaborate in real time
            and let AI turn conversations into meaningful
            outcomes.
          </p>

          <div className="feature-list">
            <div>✓ Seamless video collaboration</div>
            <div>✓ Intelligent meeting assistance</div>
            <div>✓ One workspace for your team</div>
          </div>

          <div className="hero-decoration">
            <div className="orbit orbit-one"></div>
            <div className="orbit orbit-two"></div>
            <div className="center-symbol">I</div>
            <span className="floating-dot dot-one"></span>
            <span className="floating-dot dot-two"></span>
            <span className="floating-dot dot-three"></span>
          </div>

        </div>

        <div className="left-footer">
          © 2026 IntellMeet. All rights reserved.
        </div>
      </div>

      <div className="right-panel">
        <div className="auth-card">

          <div className="mobile-brand">
            <span className="brand-icon">I</span> IntellMeet
          </div>

          <div className="auth-heading">

            <span className="welcome-label">
              {isLogin ? "WELCOME BACK" : "GET STARTED"}
            </span>

            <h2>
              {isLogin
                ? "Sign in to IntellMeet"
                : "Create your account"}
            </h2>

            <p>
              {isLogin
                ? "Enter your details to access your workspace."
                : "Join IntellMeet and make collaboration smarter."}
            </p>

          </div>

          {/* AUTH TABS */}
          <div className="auth-tabs">

            <button
              className={isLogin ? "active" : ""}
              onClick={() => {
                setIsLogin(true);
                setError("");
              }}
            >
              Sign In
            </button>

            <button
              className={!isLogin ? "active" : ""}
              onClick={() => {
                setIsLogin(false);
                setError("");
              }}
            >
              Create Account
            </button>

          </div>

          {/* AUTH FORM */}
          <form onSubmit={handleSubmit}>

            {!isLogin && (
              <div className="form-group">
                <label>Full Name</label>

                <input
                  type="text"
                  placeholder="Enter your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="form-group">
              <label>Email Address</label>

              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Password</label>

              <input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            <button
              className="submit-btn"
              type="submit"
              disabled={loading}
            >
              {loading
                ? "Please wait..."
                : isLogin
                ? "Sign In →"
                : "Create Account →"}
            </button>

          </form>

          <div className="auth-switch">

            {isLogin
              ? "Don't have an account?"
              : "Already have an account?"}

            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setError("");
              }}
            >
              {isLogin ? "Sign up" : "Sign in"}
            </button>

          </div>

          <div className="security-note">
            🔒 Your account information is securely protected.
          </div>

        </div>
      </div>

    </div>
  );
}

export default App;
