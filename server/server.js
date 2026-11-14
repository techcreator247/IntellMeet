
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

// EXPRESS CORS
app.use(cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

app.use(express.json());

// HEALTH CHECK
app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Welcome to IntellMeet API!",
        status: "Server is running"
    });
});

// ROUTES
app.use("/api/auth", authRoutes);
app.use("/api/meetings", meetingRoutes);

// USER PROFILE
app.get("/api/auth/me", protect, (req, res) => {
    res.status(200).json({
        success: true,
        user: req.user
    });
});

// SOCKET.IO
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});

// REAL-TIME MEETINGS
io.on("connection", (socket) => {

    console.log("User connected:", socket.id);

    // JOIN ROOM
    socket.on("join-room", async (roomId) => {
        if (!roomId) return;

        try {
            roomId = String(roomId);

            // Prevent the same socket joining twice
            if (socket.rooms.has(roomId)) {
                console.log("Duplicate room join prevented:", socket.id);
                return;
            }

            // Get existing participants BEFORE joining
            const existingSockets = await io.in(roomId).fetchSockets();

            const existingUsers = existingSockets
                .map((participant) => participant.id)
                .filter((id) => id !== socket.id);

            // Join room
            await socket.join(roomId);

            // Send existing participants to the new user
            socket.emit("existing-users", existingUsers);

            // Notify other participants
            socket.to(roomId).emit("user-joined", {
                userId: socket.id
            });

            console.log(
                `User ${socket.id} joined ${roomId}. Participants: ${existingUsers.length + 1}`
            );

        } catch (error) {
            console.error("Join room error:", error);
        }
    });

    // CHAT
    socket.on("send-message", (data) => {
        if (!data || !data.roomId || !data.message) return;

        io.to(data.roomId).emit("receive-message", {
            message: data.message,
            sender: data.sender || "Anonymous",
            time: new Date()
        });
    });

    // WEBRTC OFFER
    socket.on("webrtc-offer", ({ to, offer }) => {
        if (!to || !offer) return;

        io.to(to).emit("webrtc-offer", {
            from: socket.id,
            offer
        });
    });

    // WEBRTC ANSWER
    socket.on("webrtc-answer", ({ to, answer }) => {
        if (!to || !answer) return;

        io.to(to).emit("webrtc-answer", {
            from: socket.id,
            answer
        });
    });

    // WEBRTC ICE CANDIDATES
    socket.on("webrtc-ice-candidate", ({ to, candidate }) => {
        if (!to || !candidate) return;

        io.to(to).emit("webrtc-ice-candidate", {
            from: socket.id,
            candidate
        });
    });

    // LEAVE ROOM
    socket.on("leave-room", async (roomId) => {
        if (!roomId) return;

        roomId = String(roomId);

        if (!socket.rooms.has(roomId)) return;

        await socket.leave(roomId);

        socket.to(roomId).emit("user-left", {
            userId: socket.id
        });

        console.log(`User ${socket.id} left ${roomId}`);
    });

    // HANDLE DISCONNECTION FROM ALL ROOMS
    socket.on("disconnecting", () => {

        for (const roomId of socket.rooms) {

            // Skip the socket's private room
            if (roomId === socket.id) continue;

            socket.to(roomId).emit("user-left", {
                userId: socket.id
            });

            console.log(
                `User ${socket.id} disconnected from room ${roomId}`
            );
        }
    });

    socket.on("disconnect", (reason) => {
        console.log("User disconnected:", socket.id, reason);
    });

});

// START SERVER
const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        await connectDB();

        server.listen(PORT, "0.0.0.0", () => {
            console.log("----------------------------------");
            console.log("   INTELLMEET BACKEND STARTED");
            console.log("----------------------------------");
            console.log(`Server running on port ${PORT}`);
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
