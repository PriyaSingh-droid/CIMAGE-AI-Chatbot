require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE;
const FAQ_DATA_PATH = path.join(__dirname, "data", "faqs.json");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizeText = (value) => value.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
const getKeywords = (value) => normalizeText(value)
    .split(/\s+/)
    .filter((word) => word.length > 2);
const memoryFaqs = [];
const memoryQueries = [];
let nextMemoryFaqId = 1;
let isMongoConnected = false;
let databaseReadyPromise;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
        return res.status(400).json({
            error: "Invalid JSON request body."
        });
    }

    next(err);
});

function requireAdmin(req, res, next) {
    const passcode = req.get("x-admin-passcode");

    if (!ADMIN_PASSCODE) {
        return res.status(503).json({
            error: "Admin passcode is not configured on the server."
        });
    }

    if (!passcode || passcode !== ADMIN_PASSCODE) {
        return res.status(401).json({
            error: "Invalid admin passcode."
        });
    }

    next();
}


// FAQ Schema
const faqSchema = new mongoose.Schema({
    question: {
        type: String,
        required: true
    },
    answer: {
        type: String,
        required: true
    },
    category: String
});

const Faq = mongoose.model("Faq", faqSchema);

const querySchema = new mongoose.Schema({
    question: {
        type: String,
        required: true
    },
    answer: String,
    matched: {
        type: Boolean,
        default: false
    },
    matchedFaqId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Faq"
    },
    category: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Query = mongoose.model("Query", querySchema);

function loadStarterFaqs() {
    try {
        const file = fs.readFileSync(FAQ_DATA_PATH, "utf8");
        return JSON.parse(file);
    } catch (err) {
        console.warn(`Could not load starter FAQs: ${err.message}`);
        return [];
    }
}

async function saveStarterFaqs(faqs) {
    if (process.env.NETLIFY) {
        throw new Error("FAQ edits require MongoDB when deployed on Netlify. Set MONGO_URI in Netlify environment variables.");
    }

    const persistedFaqs = faqs.map(({ question, answer, category }) => ({
        question,
        answer,
        category
    }));

    await fs.promises.writeFile(
        FAQ_DATA_PATH,
        `${JSON.stringify(persistedFaqs, null, 2)}\n`,
        "utf8"
    );
}

async function seedMongoFaqs(faqs) {
    for (const faq of faqs) {
        await Faq.updateOne(
            { question: faq.question },
            { $setOnInsert: faq },
            { upsert: true }
        );
    }
}

function seedMemoryFaqs(faqs) {
    const existingQuestions = new Set(memoryFaqs.map((faq) => faq.question.toLowerCase()));

    for (const faq of faqs) {
        if (!existingQuestions.has(faq.question.toLowerCase())) {
            memoryFaqs.push({
                ...faq,
                id: String(nextMemoryFaqId++)
            });
        }
    }
}

function findBestMemoryFaq(question) {
    const keywords = getKeywords(question);

    if (!keywords.length) {
        return null;
    }

    let bestMatch = null;
    let bestScore = 0;

    for (const faq of memoryFaqs) {
        const searchableText = normalizeText(`${faq.question} ${faq.category || ""}`);
        const score = keywords.filter((keyword) => searchableText.includes(keyword)).length;

        if (score > bestScore) {
            bestMatch = faq;
            bestScore = score;
        }
    }

    return bestScore > 0 ? bestMatch : null;
}

async function saveQueryLog({ question, faq, answer }) {
    const log = {
        question,
        answer,
        matched: Boolean(faq),
        category: faq?.category,
        createdAt: new Date()
    };

    if (isMongoConnected) {
        await Query.create({
            ...log,
            matchedFaqId: faq?._id
        });
    } else {
        memoryQueries.unshift(log);
    }
}

async function getQueryLogs({ onlyUnanswered = false, limit = 50 } = {}) {
    if (isMongoConnected) {
        const filter = onlyUnanswered ? { matched: false } : {};
        return Query.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
    }

    const logs = onlyUnanswered
        ? memoryQueries.filter((query) => !query.matched)
        : memoryQueries;

    return logs.slice(0, limit);
}

async function getFaqList({ limit = 100 } = {}) {
    if (isMongoConnected) {
        return Faq.find({})
            .sort({ category: 1, question: 1 })
            .limit(limit)
            .lean();
    }

    return memoryFaqs
        .slice()
        .sort((first, second) => {
            const firstKey = `${first.category || ""} ${first.question}`;
            const secondKey = `${second.category || ""} ${second.question}`;
            return firstKey.localeCompare(secondKey);
        })
        .slice(0, limit);
}

async function updateFaq(id, updates) {
    if (isMongoConnected) {
        return Faq.findByIdAndUpdate(
            id,
            { $set: updates },
            { new: true, runValidators: true }
        ).lean();
    }

    const faq = memoryFaqs.find((item) => item.id === id);

    if (!faq) {
        return null;
    }

    faq.question = updates.question;
    faq.answer = updates.answer;
    faq.category = updates.category;
    await saveStarterFaqs(memoryFaqs);
    return faq;
}

async function getDashboardStats() {
    if (isMongoConnected) {
        const [totalFaqs, totalQueries, unansweredQueries, faqCategories] = await Promise.all([
            Faq.countDocuments(),
            Query.countDocuments(),
            Query.countDocuments({ matched: false }),
            Faq.distinct("category", {
                category: { $nin: [null, ""] }
            })
        ]);

        return {
            totalFaqs,
            totalQueries,
            unansweredQueries,
            categories: faqCategories.length
        };
    }

    const categories = new Set(
        memoryFaqs
            .map((faq) => faq.category)
            .filter(Boolean)
    );

    return {
        totalFaqs: memoryFaqs.length,
        totalQueries: memoryQueries.length,
        unansweredQueries: memoryQueries.filter((query) => !query.matched).length,
        categories: categories.size
    };
}

async function getPublicStats() {
    const stats = await getDashboardStats();

    return {
        totalFaqs: stats.totalFaqs,
        categories: stats.categories
    };
}


// MongoDB Connection
async function connectDatabase() {
    if (databaseReadyPromise) {
        return databaseReadyPromise;
    }

    databaseReadyPromise = initializeDatabase();
    return databaseReadyPromise;
}

async function initializeDatabase() {
    const starterFaqs = loadStarterFaqs();

    if (!MONGO_URI) {
        console.warn("MONGO_URI is missing. Using temporary in-memory FAQ storage.");
        seedMemoryFaqs(starterFaqs);
        return;
    }

    try {
        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 3000
        });
        isMongoConnected = true;
        await seedMongoFaqs(starterFaqs);
        console.log("MongoDB Connected");
    } catch (err) {
        console.warn(`MongoDB connection failed: ${err.message}`);
        console.warn("Using temporary in-memory FAQ storage for this run.");
        seedMemoryFaqs(starterFaqs);
    }
}


// Add FAQ
app.post("/api/add-faq", requireAdmin, async (req, res) => {
    try {
        const question = req.body.question?.trim();
        const answer = req.body.answer?.trim();
        const category = req.body.category?.trim();

        if (!question || !answer) {
            return res.status(400).json({
                error: "Question and answer are required."
            });
        }

        if (isMongoConnected) {
            const faq = new Faq({
                question,
                answer,
                category
            });
            await faq.save();
        } else {
            memoryFaqs.push({
                id: String(nextMemoryFaqId++),
                question,
                answer,
                category
            });
            await saveStarterFaqs(memoryFaqs);
        }

        res.status(201).json({
            message: "FAQ added successfully"
        });

    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

// Update FAQ
app.put("/api/faqs/:id", requireAdmin, async (req, res) => {
    try {
        const question = req.body.question?.trim();
        const answer = req.body.answer?.trim();
        const category = req.body.category?.trim();

        if (!question || !answer) {
            return res.status(400).json({
                error: "Question and answer are required."
            });
        }

        const faq = await updateFaq(req.params.id, {
            question,
            answer,
            category
        });

        if (!faq) {
            return res.status(404).json({
                error: "FAQ not found."
            });
        }

        res.json({
            message: "FAQ updated successfully",
            faq
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

// FAQ List
app.get("/api/faqs", async (req, res) => {
    try {
        const requestedLimit = Number.parseInt(req.query.limit, 10);
        const limit = Number.isNaN(requestedLimit)
            ? 100
            : Math.min(Math.max(requestedLimit, 1), 200);
        const faqs = await getFaqList({ limit });

        res.json({
            faqs
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

// Dashboard Stats
app.get("/api/stats", requireAdmin, async (req, res) => {
    try {
        const stats = await getDashboardStats();

        res.json({
            stats
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

// Student-safe Stats
app.get("/api/public-stats", async (req, res) => {
    try {
        const stats = await getPublicStats();

        res.json({
            stats
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});


// Chat API
app.post("/api/chat", async (req, res) => {

    try {

        const { question } = req.body;

        if (!question) {
            return res.status(400).json({
                error: "Question is required."
            });
        }

        const faq = isMongoConnected
            ? await Faq.findOne({
                question: { $regex: escapeRegex(question), $options: "i" }
            })
            : findBestMemoryFaq(question);

        if (faq) {
            await saveQueryLog({
                question,
                faq,
                answer: faq.answer
            });

            return res.json({
                answer: faq.answer
            });
        }

        const unknownAnswer = "Sorry, I don't know the answer.";
        await saveQueryLog({
            question,
            faq: null,
            answer: unknownAnswer
        });

        res.json({
            answer: unknownAnswer
        });

    } catch (error) {

        res.status(500).json({
            error: error.message
        });

    }

});


// Query Logs
app.get("/api/queries", requireAdmin, async (req, res) => {
    try {
        const onlyUnanswered = req.query.status === "unanswered";
        const requestedLimit = Number.parseInt(req.query.limit, 10);
        const limit = Number.isNaN(requestedLimit)
            ? 50
            : Math.min(Math.max(requestedLimit, 1), 200);
        const queries = await getQueryLogs({ onlyUnanswered, limit });

        res.json({
            queries
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});


// Home Route
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});


connectDatabase().finally(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
});

module.exports = {
    app,
    connectDatabase
};

module.exports = {
    app,
    connectDatabase
};
