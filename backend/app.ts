import express from "express";
import Redis from "ioredis";
import { json } from "body-parser";

const DEFAULT_BALANCE = 100;

interface ChargeResult {
    isAuthorized: boolean;
    remainingBalance: number;
    charges: number;
}

const redisHost = process.env.REDIS_HOST as string || "localhost";
const redisPort = (process.env.REDIS_PORT as string) ? parseInt(process.env.REDIS_PORT as string) : 6379;

const redis = new Redis({
    host: redisHost,
    port: redisPort,
});

async function reset(account: string): Promise<void> {
    await redis.set(`${account}/balance`, DEFAULT_BALANCE.toString());
}

async function charge(account: string, charges: number): Promise<ChargeResult> {
    const accountKey = `${account}/balance`;

    const luaScript = `
        local balance = tonumber(redis.call("get", KEYS[1]))
        local charges = tonumber(ARGV[1])
        
        if balance >= charges then
            redis.call("set", KEYS[1], balance - charges)
            return {1, balance - charges, charges}
        else
            return {0, balance, 0}
        end
    `;

    const result = await redis.eval(luaScript, 1, accountKey, charges.toString());

    const [isAuthorized, remainingBalance, deductedCharges] = result as [number, number, number];

    return { isAuthorized: isAuthorized === 1, remainingBalance, charges: deductedCharges };
}

export function buildApp(): express.Application {
    const app = express();
    app.use(json());
    app.post("/reset", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            await reset(account);
            console.log(`Successfully reset account ${account}`);
            res.sendStatus(204);
        } catch (e) {
            console.error("Error while resetting account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    app.post("/charge", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            const result = await charge(account, req.body.charges ?? 100);
            
            if (result.isAuthorized) {
                console.log(`Successfully charged account ${account}`);
                res.status(200).json(result);
            } else {
                console.error(`Insufficient balance for account ${account}`);
                res.status(403).json({ error: "Insufficient balance" });
            }
        } catch (e) {
            console.error("Error while charging account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    return app;
}
