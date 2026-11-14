
const mongoose = require("mongoose");

const meetingSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },

    roomId: {
      type: String,
      required: true,
      unique: true
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    ],

    status: {
      type: String,
      enum: ["scheduled", "active", "ended"],
      default: "scheduled"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Meeting", meetingSchema);
