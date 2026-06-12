const serverless = require("serverless-http");
const { app, connectDatabase } = require("../../server");

const expressHandler = serverless(app);

exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    await connectDatabase();
    return expressHandler(event, context);
};
