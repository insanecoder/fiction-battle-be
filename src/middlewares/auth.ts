// src/middlewares/firebaseAuthMiddleware.ts

import type { Request, Response, NextFunction } from "express";
import { adminAuth } from "../lib/firebase/firebaseAdmin";
import { createUserModel, UserModelType } from "../models/user.model";
import { Connection } from "mongoose";
import { DbConnection } from "../db/database-client";
import { logger } from "../lib/logger/logger";

export async function authMiddleware(
  dbConn: DbConnection<Connection>,
  options: { required?: boolean } = { required: true }
) {
  const required = options.required ?? true;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.header("authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        if (required) {
          return res.status(401).json({
            error: { code: "UNAUTHORIZED", message: "Missing bearer token" },
          });
        }
        return next();
      }

      const idToken = authHeader.slice("Bearer ".length).trim();
      const decoded = await adminAuth.verifyIdToken(idToken);

      const userModel: UserModelType = createUserModel(dbConn);
      const user = await userModel.findOne({ email: decoded.email || "" });

      if (!user) {
        if (required) {
          return res.status(401).json({
            error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
          });
        }
        return next();
      }

      req.authUser = {
        userId:  user._id.toString(),
        email:   user.email,
        name:    user.name,
        picture: user.photo,
      };

      next();
    } catch (error: any) {
      logger.error({ reqId: req.requestId, message: error.message, stackTrace: error.stack });
      if (required) {
        return res.status(401).json({
          error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
        });
      }
      next();
    }
  };
}