import { required, numberEnv } from "./env-utils";

export const dbConfig = {
  mongo: {
    primary: {
      uri: required("MONGO_URI"),
      pool: {
        maxPoolSize: numberEnv("MONGO_MAX_POOL", 20),
        minPoolSize: numberEnv("MONGO_MIN_POOL", 5),
        serverSelectionTimeoutMS: numberEnv("MONGO_SERVER_TIMEOUT", 5000),
        socketTimeoutMS: numberEnv("MONGO_SOCKET_TIMEOUT", 45000),
        waitQueueTimeoutMS: numberEnv("MONGO_WAIT_QUEUE_TIMEOUT", 5000),
      },
    },
  },
};