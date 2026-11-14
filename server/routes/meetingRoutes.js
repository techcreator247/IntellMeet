
const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");

const {
  createMeeting,
  getMeeting,
  joinMeeting
} = require("../controllers/meetingController");

router.post("/", protect, createMeeting);
router.get("/:roomId", protect, getMeeting);
router.post("/:roomId/join", protect, joinMeeting);

module.exports = router;
