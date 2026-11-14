
const crypto = require("crypto");
const Meeting = require("../models/Meeting");

// CREATE MEETING
exports.createMeeting = async (req, res) => {
  try {
    const { title } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: "Meeting title is required"
      });
    }

    const roomId = crypto.randomBytes(5).toString("hex");

    const meeting = await Meeting.create({
      title: title.trim(),
      roomId,
      createdBy: req.user._id,
      participants: [req.user._id]
    });

    res.status(201).json({
      success: true,
      message: "Meeting created successfully",
      meeting
    });

  } catch (error) {
    console.error("Create meeting error:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to create meeting"
    });
  }
};

// GET MEETING DETAILS
exports.getMeeting = async (req, res) => {
  try {
    const meeting = await Meeting.findOne({
      roomId: req.params.roomId
    }).populate("createdBy", "name email");

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: "Meeting not found"
      });
    }

    res.status(200).json({
      success: true,
      meeting
    });

  } catch (error) {
    console.error("Get meeting error:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to retrieve meeting"
    });
  }
};

// JOIN MEETING
exports.joinMeeting = async (req, res) => {
  try {
    const meeting = await Meeting.findOne({
      roomId: req.params.roomId
    });

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: "Meeting not found"
      });
    }

    if (meeting.status === "ended") {
      return res.status(400).json({
        success: false,
        message: "This meeting has ended"
      });
    }

    const alreadyJoined = meeting.participants.some(
      id => id.toString() === req.user._id.toString()
    );

    if (!alreadyJoined) {
      meeting.participants.push(req.user._id);
      await meeting.save();
    }

    res.status(200).json({
      success: true,
      message: "Joined meeting successfully",
      meeting
    });

  } catch (error) {
    console.error("Join meeting error:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to join meeting"
    });
  }
};
