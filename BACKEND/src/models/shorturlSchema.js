import mongoose from "mongoose";

const shortUrlSchema=new mongoose.Schema({
    full_url:{
        type:String,
        required:true,
        index: true, // Index for faster lookups by full URL
    },
    short_url:{
         type:String,
        required:true,
        index:true,
        unique:true,
    },
    clicks:{
        type:Number,
        required:true,
        default:0,
        index: true, // Index for analytics queries
    },
    user:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User",
        index: true, // Index for user-based queries
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true, // Index for time-based queries
    }

});

const shortUrl=mongoose.model("ShortUrl",shortUrlSchema);

export default shortUrl;