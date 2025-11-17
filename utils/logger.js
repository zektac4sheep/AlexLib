const fs = require("fs");
const path = require("path");
const { createLogger, format, transports } = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");

const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, "..", "logs");

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

const logFormat = format.printf(
    ({ timestamp, level, message, stack, ...meta }) => {
        const metaString = Object.keys(meta).length
            ? ` ${JSON.stringify(meta)}`
            : "";
        return `${timestamp} [${level}] ${stack || message}${metaString}`;
    }
);

const logger = createLogger({
    level: LOG_LEVEL,
    format: format.combine(
        format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        format.errors({ stack: true }),
        format.splat(),
        logFormat
    ),
    transports: [
        new DailyRotateFile({
            filename: path.join(LOG_DIR, "error-%DATE%.log"),
            datePattern: "YYYY-MM-DD",
            level: "error",
            maxSize: "20m",
            maxFiles: "14d",
            zippedArchive: true,
        }),
        new DailyRotateFile({
            filename: path.join(LOG_DIR, "app-%DATE%.log"),
            datePattern: "YYYY-MM-DD",
            maxSize: "20m",
            maxFiles: "14d",
            zippedArchive: true,
        }),
    ],
});

if (process.env.NODE_ENV !== "production") {
    logger.add(
        new transports.Console({
            format: format.combine(format.colorize(), format.simple()),
        })
    );
}

// Create a separate logger for book search debugging
const bookSearchLogger = createLogger({
    level: LOG_LEVEL,
    format: format.combine(
        format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        format.errors({ stack: true }),
        format.splat(),
        logFormat
    ),
    transports: [
        new DailyRotateFile({
            filename: path.join(LOG_DIR, "booksearch-%DATE%.log"),
            datePattern: "YYYY-MM-DD",
            maxSize: "20m",
            maxFiles: "14d",
            zippedArchive: true,
        }),
    ],
});

if (process.env.NODE_ENV !== "production") {
    bookSearchLogger.add(
        new transports.Console({
            format: format.combine(format.colorize(), format.simple()),
        })
    );
}

module.exports = logger;
module.exports.bookSearchLogger = bookSearchLogger;
