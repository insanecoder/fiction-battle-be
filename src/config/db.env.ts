import { required, numberEnv } from "./env-utils";

// Fixed db names, not env-driven — both dbs live on the same Mongo instance (MONGO_URI).
export const DB_NAMES = {
  primary:   "twitter-ai",
  analytics: "twitter-ai-analytics",
} as const;

const pool = {
  maxPoolSize: numberEnv("MONGO_MAX_POOL", 20),
  minPoolSize: numberEnv("MONGO_MIN_POOL", 5),
  serverSelectionTimeoutMS: numberEnv("MONGO_SERVER_TIMEOUT", 5000),
  socketTimeoutMS: numberEnv("MONGO_SOCKET_TIMEOUT", 45000),
  waitQueueTimeoutMS: numberEnv("MONGO_WAIT_QUEUE_TIMEOUT", 5000),
};

export const dbConfig = {
  mongo: {
    primary: {
      uri:    required("MONGO_URI"),
      dbName: DB_NAMES.primary,
      pool,
    },
    analytics: {
      uri:    required("MONGO_URI"),
      dbName: DB_NAMES.analytics,
      pool,
    },
  },
};