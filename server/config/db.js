
const mongoose = require("mongoose");

const connectDB = async () => {
    try {
        // Check whether MongoDB URI exists
        if (!process.env.MONGO_URI) {
            throw new Error("MONGO_URI is missing in .env file");
        }

        // Connect to MongoDB Atlas
        const connection = await mongoose.connect(
            process.env.MONGO_URI,
            {
                serverSelectionTimeoutMS: 10000
            }
        );

        console.log("----------------------------------");
        console.log("MongoDB connected successfully!");
        console.log(`Database Host: ${connection.connection.host}`);
        console.log(`Database Name: ${connection.connection.name}`);
        console.log("----------------------------------");

        return connection;

    } catch (error) {
        console.error("----------------------------------");
        console.error("MongoDB CONNECTION FAILED!");
        console.error("Error:", error.message);
        console.error("----------------------------------");

        throw error;
    }
};

module.exports = connectDB;
