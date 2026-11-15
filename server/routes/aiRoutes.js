
const express = require("express");
const OpenAI = require("openai");

const router = express.Router();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Generate AI meeting summary
router.post("/summarize", async (req, res) => {
    try {
        const { transcript } = req.body;

        if (!transcript || typeof transcript !== "string") {
            return res.status(400).json({
                success: false,
                message: "Meeting transcript is required."
            });
        }

        if (transcript.trim().length < 20) {
            return res.status(400).json({
                success: false,
                message: "Transcript is too short to summarize."
            });
        }

        if (transcript.length > 50000) {
            return res.status(400).json({
                success: false,
                message: "Transcript is too long. Please shorten it."
            });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are an AI meeting assistant.
Create a clear and structured meeting summary.
Include:
1. Meeting Overview
2. Key Discussion Points
3. Decisions Made
4. Action Items
5. Conclusion

Only include information supported by the transcript.
If something is not discussed, write "Not specified".`
                },
                {
                    role: "user",
                    content: `Summarize this meeting transcript:\n\n${transcript}`
                }
            ],
            temperature: 0.3
        });

        const summary = completion.choices[0]?.message?.content;

        if (!summary) {
            throw new Error("AI returned an empty summary.");
        }

        return res.status(200).json({
            success: true,
            summary
        });

    } catch (error) {
        console.error("AI Summary Error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to generate meeting summary."
        });
    }
});

module.exports = router;
