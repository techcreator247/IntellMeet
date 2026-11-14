
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

require("dotenv").config();

const { protect } = require("./middleware/authMiddleware");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const meetingRoutes = require("./routes/meetingRoutes");

const app = express();
const server = http.createServer(app);
const allowedOrigins = [
    "http://localhost:5173",
    "https://localhost:5173",
    "http://192.168.211.157:5173",
    "https://192.168.211.157:5173",
    process.env.CLIENT_URL
].filter(Boolean);
// =====================================
// EXPRESS CORS CONFIGURATION
// =====================================

app.use(cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

app.use(express.json());

// =====================================
// API HEALTH CHECK
// =====================================

app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Welcome to IntellMeet API!",
        status: "Server is running"
    });
});

// =====================================
// AUTHENTICATION ROUTES
// =====================================

app.use("/api/auth", authRoutes);

// =====================================
// MEETING ROUTES
// =====================================

app.use("/api/meetings", meetingRoutes);

// =====================================
// GET LOGGED-IN USER PROFILE
// =====================================

app.get("/api/auth/me", protect, (req, res) => {
    res.status(200).json({
        success: true,
        user: req.user
    });
});

// =====================================
// SOCKET.IO CONFIGURATION
// =====================================

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});

// =====================================
// REAL-TIME CONNECTIONS + WEBRTC
// =====================================

io.on("connection", (socket) => {

    console.log("User connected:", socket.id);

    // JOIN MEETING ROOM
    socket.on("join-room", async (roomId) => {

        if (!roomId) return;

        try {

            // Get existing participants
            const existingSockets = await io.in(roomId).fetchSockets();

            const existingUsers = existingSockets.map(
                (participant) => participant.id
            );

            // Join room
            socket.join(roomId);

            // Send existing participants to new user
            socket.emit("existing-users", existingUsers);

            // Notify other participants
            socket.to(roomId).emit("user-joined", {
                userId: socket.id
            });

            console.log(`User ${socket.id} joined room ${roomId}`);

        } catch (error) {

            console.error("Join room error:", error);

        }
    });

    // LIVE CHAT
    socket.on("send-message", (data) => {

        if (!data || !data.roomId || !data.message) return;

        io.to(data.roomId).emit("receive-message", {
            message: data.message,
            sender: data.sender || "Anonymous",
            time: new Date()
        });

    });

    // WEBRTC: SEND OFFER
    socket.on("webrtc-offer", ({ to, offer }) => {

        if (!to || !offer) return;

        io.to(to).emit("webrtc-offer", {
            from: socket.id,
            offer
        });

    });

    // WEBRTC: SEND ANSWER
    socket.on("webrtc-answer", ({ to, answer }) => {

        if (!to || !answer) return;

        io.to(to).emit("webrtc-answer", {
            from: socket.id,
            answer
        });

    });

    // WEBRTC: EXCHANGE ICE CANDIDATES
    socket.on("webrtc-ice-candidate", ({ to, candidate }) => {

        if (!to || !candidate) return;

        io.to(to).emit("webrtc-ice-candidate", {
            from: socket.id,
            candidate
        });

    });

    // LEAVE MEETING ROOM
    socket.on("leave-room", (roomId) => {

        if (!roomId) return;

        socket.leave(roomId);

        socket.to(roomId).emit("user-left", {
            userId: socket.id
        });

        console.log(`User ${socket.id} left room ${roomId}`);

    });

    // DISCONNECT
    socket.on("disconnect", () => {

        console.log("User disconnected:", socket.id);

    });

});

// =====================================
// START SERVER AFTER MONGODB CONNECTS
// =====================================

const PORT = process.env.PORT || 5000;

const startServer = async () => {

    try {

        await connectDB();

        server.listen(PORT, "0.0.0.0", () => {

            console.log("----------------------------------");
            console.log("   INTELLMEET BACKEND STARTED");
            console.log("----------------------------------");
            console.log(`Server: http://localhost:${PORT}`);
            console.log(`Mobile: http://192.168.211.157:${PORT}`);
            console.log("MongoDB: Connected");
            console.log("Socket.io: Ready");
            console.log("WebRTC Signaling: Ready");
            console.log("Authentication: Ready");
            console.log("----------------------------------");

        });

    } catch (error) {

        console.error("Failed to start IntellMeet:", error.message);

        process.exit(1);

    }

};

startServer();
