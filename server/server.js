
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

// Store meeting transcripts temporarily in server memory
const meetingTranscripts = new Map();

// =====================================
// FREE LOCAL MEETING SUMMARIZER
// =====================================

function generateMeetingSummary(messages) {

    const validMessages = messages
        .filter((item) =>
            item &&
            typeof item.text === "string" &&
            item.text.trim().length > 0
        )
        .map((item) => ({
            text: item.text.trim(),
            sender: String(item.sender || "Anonymous")
        }));

    // Convert transcript entries into sentences
    const sentences = [];

    for (const item of validMessages) {
        const parts = item.text
            .split(/(?<=[.!?])\s+|\n+/)
            .map((sentence) => sentence.trim())
            .filter((sentence) => sentence.length > 3);

        for (const part of parts) {
            sentences.push({
                text: part,
                sender: item.sender
            });
        }
    }

    // =====================================
    // MEETING OVERVIEW
    // =====================================

    const overview = validMessages
        .slice(0, 3)
        .map((item) => `${item.sender}: ${item.text}`)
        .join(" ");

    // =====================================
    // KEY DISCUSSION POINTS
    // =====================================

    const keywords =
        /\b(discuss|discussed|decided|decision|important|plan|planned|complete|completed|finish|finished|deadline|meeting|project|update|issue|problem|solution|prepare|prepared|develop|development|design|review|implement|implementation|schedule|requirement|task|work|team|goal|target|progress|testing|database|website|integration|budget|launch|deliver|presentation|report)\b/i;

    const keyPoints = [];
    const seenPoints = new Set();

    for (const sentence of sentences) {

        const cleaned = sentence.text.trim();
        const normalized = cleaned.toLowerCase();

        if (
            keywords.test(cleaned) &&
            !seenPoints.has(normalized)
        ) {
            keyPoints.push(cleaned);
            seenPoints.add(normalized);
        }

        if (keyPoints.length >= 5) break;
    }

    // If no keyword matches, use actual transcript sentences
    if (keyPoints.length === 0) {
        for (const sentence of sentences.slice(0, 5)) {
            keyPoints.push(sentence.text);
        }
    }

    // =====================================
    // IMPROVED ACTION ITEM DETECTION
    // =====================================

    // "Discuss" is intentionally excluded.
    // Discussion statements should not become tasks.

    const actionPattern =
        /\b(?:will|shall|must|should|need(?:s)? to|has to|have to|am going to|is going to|are going to|plan(?:s)? to|is responsible for|are responsible for|assigned to)\s+(?:prepare|complete|create|build|develop|design|implement|review|test|send|submit|finish|update|fix|write|deliver|check|organize|schedule|integrate|deploy|analyze|document|research|present|conduct|finalize|work on|handle|manage|verify|collect|install|configure|maintain|perform|record|upload|share|provide|coordinate|investigate|resolve|explain|demonstrate)\b/i;

    const actionItems = [];
    const seenActions = new Set();

    for (const sentence of sentences) {

        const cleaned = sentence.text.trim();
        const normalized = cleaned.toLowerCase();

        if (/^that\b/i.test(cleaned)) continue;

        if (!actionPattern.test(cleaned)) continue;

        if (seenActions.has(normalized)) continue;

        // Detect a named person at the beginning
        const personMatch = cleaned.match(
            /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:will|shall|must|should|needs to|has to|is going to|plans to)\b/
        );

        actionItems.push({
            text: cleaned,
            assignedTo: personMatch
                ? personMatch[1]
                : "Not specified"
        });

        seenActions.add(normalized);

        if (actionItems.length >= 10) break;
    }

    // =====================================
    // FINAL SUMMARY OUTPUT
    // =====================================

    return {
        summary: overview ||
            "No meeting discussion available.",

        keyPoints,

        actionItems,

        transcriptCount: validMessages.length,

        generatedAt: new Date()
    };
}

// =====================================
// EXPRESS CORS
// =====================================

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

// =====================================
// ROUTES
// =====================================

app.use("/api/auth", authRoutes);
app.use("/api/meetings", meetingRoutes);

// USER PROFILE
app.get("/api/auth/me", protect, (req, res) => {
    res.status(200).json({
        success: true,
        user: req.user
    });
});

// =====================================
// SOCKET.IO
// =====================================

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});

// =====================================
// REAL-TIME MEETINGS
// =====================================

io.on("connection", (socket) => {

    console.log("User connected:", socket.id);

    // =====================================
    // JOIN ROOM
    // =====================================

    socket.on("join-room", async (roomId) => {
        if (!roomId) return;

        try {
            roomId = String(roomId);

            if (socket.rooms.has(roomId)) {
                console.log(
                    "Duplicate room join prevented:",
                    socket.id
                );
                return;
            }

            const existingSockets =
                await io.in(roomId).fetchSockets();

            const existingUsers = existingSockets
                .map((participant) => participant.id)
                .filter((id) => id !== socket.id);

            await socket.join(roomId);

            socket.emit("existing-users", existingUsers);

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

    // =====================================
    // CHAT
    // =====================================

    socket.on("send-message", (data) => {
        if (!data || !data.roomId || !data.message) return;

        const roomId = String(data.roomId);

        if (!socket.rooms.has(roomId)) return;

        io.to(roomId).emit("receive-message", {
            message: data.message,
            sender: data.sender || "Anonymous",
            time: new Date()
        });
    });

    // =====================================
    // LIVE MEETING TRANSCRIPTION
    // =====================================

    socket.on("send-transcript", (data) => {
        if (!data || !data.roomId || !data.text) return;

        const roomId = String(data.roomId);
        const text = String(data.text).trim();

        if (!socket.rooms.has(roomId)) return;
        if (!text || text.length > 2000) return;

        const transcriptMessage = {
            id: `${socket.id}-${Date.now()}`,
            text,
            sender: String(
                data.sender || "Anonymous"
            ).slice(0, 50),
            time: new Date()
        };

        if (!meetingTranscripts.has(roomId)) {
            meetingTranscripts.set(roomId, []);
        }

        const roomTranscript = meetingTranscripts.get(roomId);

        roomTranscript.push(transcriptMessage);

        if (roomTranscript.length > 1000) {
            roomTranscript.shift();
        }

        io.to(roomId).emit(
            "receive-transcript",
            transcriptMessage
        );

        console.log(
            `Transcript received in ${roomId} from ${socket.id}`
        );
    });

    // =====================================
    // FREE LOCAL MEETING SUMMARY
    // =====================================

    socket.on("generate-summary", (data) => {

        if (!data || !data.roomId) return;

        const roomId = String(data.roomId);

        if (!socket.rooms.has(roomId)) return;

        const messages = meetingTranscripts.get(roomId) || [];

        console.log(
            "SUMMARY INPUT:",
            JSON.stringify(messages, null, 2)
        );

        if (messages.length === 0) {
            socket.emit("meeting-summary", {
                success: false,
                message: "No transcript available. Start transcription first."
            });
            return;
        }

        try {

            const result = generateMeetingSummary(messages);

            const summaryData = {
                success: true,
                summary: result.summary,
                keyPoints: result.keyPoints,
                actionItems: result.actionItems,
                transcriptCount: result.transcriptCount,
                generatedAt: result.generatedAt
            };

            io.to(roomId).emit(
                "meeting-summary",
                summaryData
            );

            console.log(
                `Local meeting summary generated for room ${roomId}`
            );

        } catch (error) {

            console.error("Meeting Summary Error:", error);

            socket.emit("meeting-summary", {
                success: false,
                message: "Unable to generate meeting summary."
            });
        }
    });

    // =====================================
    // WEBRTC OFFER
    // =====================================

    socket.on("webrtc-offer", ({ to, offer }) => {
        if (!to || !offer) return;

        io.to(to).emit("webrtc-offer", {
            from: socket.id,
            offer
        });
    });

    // =====================================
    // WEBRTC ANSWER
    // =====================================

    socket.on("webrtc-answer", ({ to, answer }) => {
        if (!to || !answer) return;

        io.to(to).emit("webrtc-answer", {
            from: socket.id,
            answer
        });
    });

    // =====================================
    // WEBRTC ICE CANDIDATES
    // =====================================

    socket.on("webrtc-ice-candidate", ({
        to,
        candidate
    }) => {
        if (!to || !candidate) return;

        io.to(to).emit("webrtc-ice-candidate", {
            from: socket.id,
            candidate
        });
    });

    // =====================================
    // LEAVE ROOM
    // =====================================

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

    // =====================================
    // HANDLE DISCONNECTION
    // =====================================

    socket.on("disconnecting", () => {

        for (const roomId of socket.rooms) {

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
        console.log(
            "User disconnected:",
            socket.id,
            reason
        );
    });

});

// =====================================
// START SERVER
// =====================================

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
            console.log("Live Transcription: Ready");
            console.log("Local Meeting Summary: Ready");
            console.log("----------------------------------");

        });

    } catch (error) {

        console.error(
            "Failed to start IntellMeet:",
            error.message
        );

        process.exit(1);
    }
};

startServer();
